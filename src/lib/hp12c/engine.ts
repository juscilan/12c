// The HP-12C state machine.
//
// One mutable object holds the whole calculator: the four level RPN stack, LAST
// X, the twenty data registers (R0-R9 and R.0-R.9), the six financial
// registers, the display format, program memory and the annunciators.  Nothing
// here knows about Svelte; the UI calls `press()` and then reads `version` to
// know that something changed.
//
// Behaviour that is easy to get wrong follows Appendix A of the owner's
// handbook, "The Automatic Memory Stack":

//   * digit entry lifts the stack unless ENTER or a financial-register store was
//     the previous key
//   * a two-number function drops the stack, a percentage function does not,
//     and a one-number function leaves Y, Z and T alone
//   * LAST X takes the old X for every function except the stack shuffles
//   * the financial keys store on the first press and solve on the second

import {
  DEFAULT_DISPLAY,
  exactDecimal,
  formatMantissa,
  formatValue,
  isOverflow,
  round10,
  roundToDisplay,
  type DisplayFormat,
} from './format';
import { DIGIT_KEYS, KEYS } from './keys';
import { FIN_KEYS, amortize, solveTvm, type FinKey } from './tvm';
import * as calendar from './dates';
import * as finance from './finance';
import * as statistics from './stats';

export type Prefix = 'f' | 'g' | 'sto' | 'rcl' | 'clear' | 'goto' | 'f-goto' | null;

export interface Annunciators {
  f: boolean;
  g: boolean;
  begin: boolean;
  dmy: boolean;
  c: boolean;
  prgm: boolean;
}

export interface View {
  /** the 10 character LCD field */
  text: string;
  /** the six annunciators, in display order */
  annunciators: Annunciators;
  /** shown instead of a number while a program is being stepped */
  programLine: string | null;
  /** true while a program is executing */
  running: boolean;
}

interface Financials {
  n: number;
  i: number;
  PV: number;
  PMT: number;
  FV: number;
  /** Nj, the cash flow repeat counter */
  Nj: number;
}

interface Entry {
  /** typed digits and radix mark, verbatim */
  text: string;
  /** exponent typed after EEX, with its own sign */
  exponent: number | null;
  negative: boolean;
  /** CHS pressed after EEX flips the exponent instead of the mantissa */
  chsOnExponent: boolean;
}

const REGISTERS = 20;

/** What running one recorded line asks the program counter to do next. */
interface LineResult {
  jump: number | null;
  /** the line ended in a conditional test, so a false one skips a line */
  conditional: boolean;
}

export class Hp12c {
  x = 0;
  y = 0;
  z = 0;
  t = 0;
  lastX = 0;

  /** R0-R9 then R.0-R.9; R1-R6 double as the statistical accumulators */
  regs = new Array<number>(REGISTERS).fill(0);
  fin: Financials = { n: 0, i: 0, PV: 0, PMT: 0, FV: 0, Nj: 1 };

  display: DisplayFormat = { ...DEFAULT_DISPLAY };
  begin = false;
  /** date format: true for month-day-year, false for day-month-year */
  monthFirst = true;

  prefix: Prefix = null;
  entry: Entry | null = null;
  /** false right after ENTER and after a financial store, disabling the lift */
  lift = true;
  /** the financial key that was stored by the previous key press */
  finJustStored: FinKey | null = null;
  /** `g INT` leaves the 365 day figure waiting for the next x-y */
  intAlt: number | null = null;
  /** `f PREFIX` + ENTER shows the mantissa until the next key press */
  mantissaView = false;
  /** a date result the LCD must render in the 12C's own layout */
  dateResult: string | null = null;
  /** a register or program label the LCD shows in place of a number */
  private displayOverride: string | null = null;

  program = false;
  /** program lines, each a list of keycodes */
  lines: string[][] = [];
  lineIndex = 0;
  private pendingLine: string[] = [];
  // the next commit overwrites the line instead of adding to it
  private lineReplace = false;
  private running = false;
  private executing = false;
  private stepLimit = 0;

  error = false;
  /** bumped after every state change so Svelte can react */
  version = 0;

  constructor() {
    this.lines = [[]];
  }

  // ---------------------------------------------------------------- helpers

  private touch(): void {
    this.version++;
  }

  private commit(value: number): number {
    const rounded = round10(value);
    if (isOverflow(rounded)) this.fail();
    return rounded;
  }

  /** `f`+`1/x` and friends report a math error rather than an overflow. */
  private fail(): void {
    this.error = true;
    this.x = 0;
    this.entry = null;
    this.dateResult = null;
    this.mantissaView = false;
    this.displayOverride = null;
  }

  /** Copy X into Y, discarding T, as the stack lift does. */
  liftStack(): void {
    this.t = this.z;
    this.z = this.y;
    this.y = this.x;
  }

  /** After a two-number function: Z drops into Y and T holds Z as well. */
  dropStack(): void {
    this.y = this.z;
    this.z = this.t;
  }

  /** The number in X, with any pending digit entry folded in. */
  private xValue(): number {
    return this.entry ? this.entryValue() : this.x;
  }

  private entryValue(): number {
    const e = this.entry!;
    let mantissa = Number(e.text === '' ? '0' : e.text);
    if (e.negative) mantissa = -mantissa;
    const value = e.exponent === null ? mantissa : mantissa * Math.pow(10, e.exponent);
    return isOverflow(value) ? 0 : value;
  }

  /** Terminate digit entry, leaving its value in X. */
  private endEntry(): void {
    if (!this.entry) return;
    this.x = this.commit(this.entryValue());
    this.entry = null;
  }

  /** Prepare the X register for a fresh key press. */
  private beginX(shouldLift: boolean): void {
    if (shouldLift) this.liftStack();
    this.x = 0;
    this.entry = null;
    this.lift = true;
  }

  private get sums(): statistics.Sums {
    return {
      n: this.regs[1],
      sumX: this.regs[2],
      sumX2: this.regs[3],
      sumY: this.regs[4],
      sumY2: this.regs[5],
      sumXY: this.regs[6],
    };
  }

  private set sums(s: statistics.Sums) {
    this.regs[1] = s.n;
    this.regs[2] = s.sumX;
    this.regs[3] = s.sumX2;
    this.regs[4] = s.sumY;
    this.regs[5] = s.sumY2;
    this.regs[6] = s.sumXY;
  }

  // ----------------------------------------------------------------- display

  view(): View {
    return {
      text: this.displayText(),
      annunciators: {
        f: this.prefix === 'f',
        g: this.prefix === 'g',
        begin: this.begin,
        dmy: !this.monthFirst,
        c: this.compoundReady(),
        prgm: this.program,
      },
      programLine: this.program ? this.programLabel() : null,
      running: this.running,
    };
  }

  private displayText(): string {
    if (this.displayOverride) return this.displayOverride;
    if (this.dateResult) return this.dateResult;
    if (this.mantissaView) return formatMantissa(this.x).padStart(10, ' ');
    const value = this.entry ? this.entryValue() : this.x;
    if (this.program && !this.running) {
      const label = this.programLabel();
      if (label) return label;
    }
    return formatValue(value, this.display);
  }

  /** `00-23,34` style listing of the current program line. */
  private programLabel(): string {
    const codes = this.lines[this.lineIndex] ?? [];
    const list = codes.length ? codes.join(',') : '—';
    const num = String(this.lineIndex).padStart(2, '0');
    const body = `${num}- ${list}`;
    return body.slice(0, 10).padEnd(10, ' ');
  }

  /**
   * The C annunciator lights when the five financial registers hold enough to
   * run a compound interest calculation.
   */
  private compoundReady(): boolean {
    if (this.cashFlowActive) return false;
    const { n, i, PV, PMT, FV } = this.fin;
    const known = [n, i, PV, PMT, FV].filter((v) => v !== 0).length;
    if (known < 4) return false;
    // n alone cannot start a compound calculation: the rate still has to come
    if (i === 0 && PV === 0 && PMT === 0 && FV === 0) return false;
    return true;
  }

  /** true once CFo or CFj has opened a cash flow problem */
  private cashFlowActive = false;
  // Nj for each stored cash flow amount, slot 0 being the initial investment.
  // Slot 20 lives in FV, so the counts run one longer than the R registers.
  private cfCounts: number[] = new Array(REGISTERS + 1).fill(1);
  // which cash flow slot the next `g CFj` will write to
  private cfSlot = 0;
  get cashFlow(): boolean {
    return this.cashFlowActive;
  }

  // ------------------------------------------------------------- entry logic

  private pressDigit(digit: string): void {
    const lift = this.lift && !this.entry;
    if (lift) {
      this.liftStack();
      this.displayOverride = null;
      this.dateResult = null;
    }
    if (!this.entry) {
      this.entry = { text: digit, exponent: null, negative: false, chsOnExponent: false };
    } else if (this.entry.exponent !== null) {
      this.entry.exponent = Number(`${this.entry.exponent}${digit}`);
    } else if (this.entry.text === '0') {
      this.entry.text = digit;
    } else if (this.entry.text.length < 10) {
      this.entry.text += digit;
    }
    this.lift = false;
  }

  private pressDot(): void {
    const lift = this.lift && !this.entry;
    if (lift) {
      this.liftStack();
      this.displayOverride = null;
      this.dateResult = null;
    }
    if (!this.entry) {
      this.entry = { text: '0.', exponent: null, negative: false, chsOnExponent: false };
    } else if (this.entry.exponent === null && !this.entry.text.includes(this.display.radix)) {
      this.entry.text += this.display.radix;
    }
    this.lift = false;
  }

  private pressEex(): void {
    if (!this.entry) {
      this.entry = { text: '0.', exponent: 0, negative: false, chsOnExponent: false };
    } else {
      this.entry.exponent = this.entry.exponent === null ? 0 : this.entry.exponent;
    }
    this.lift = false;
  }

  private pressChs(): void {
    if (this.entry) {
      if (this.entry.exponent !== null && !this.entry.chsOnExponent) {
        this.entry.chsOnExponent = true;
      } else {
        this.entry.negative = !this.entry.negative;
      }
      return;
    }
    this.lastX = this.x;
    this.x = this.commit(-this.x);
    this.lift = true;
    this.intAlt = null;
  }

  // ------------------------------------------------------------------ press

  /** Feed one physical key press into the machine. */
  press(id: string): void {
    this.mantissaView = false;
    this.displayOverride = null;
    if (this.error) {
      // only ON and a prefix clear escape an error state
      if (id === 'ON') this.powerOn();
      return;
    }
    const wasPrefix = this.consumePrefix(id);
    if (wasPrefix) {
      this.touch();
      return;
    }
    if (this.program && !this.executing) {
      // A digit moves the pointer to that line, which also files whatever
      // instruction had been keyed so far.  Digits typed inside an instruction
      // never get here because their prefix consumes them first.
      const line = DIGIT_KEYS[id];
      if (line !== undefined && this.prefix === null) {
        if (this.pendingLine.length > 0) this.commitLine();
        this.lineIndex = Number(line);
        this.lineReplace = true;
        this.lift = false;
        this.touch();
        return;
      }
      this.record(id);
      this.touch();
      return;
    }
    this.executing = false;
    this.dispatch(id);
    this.touch();
  }

  /** Handle the second key of a pending prefix.  Returns true if consumed. */
  private consumePrefix(id: string): boolean {
    const prefix = this.prefix;
    if (!prefix) return false;
    this.prefix = null;

    const recording = this.program && !this.executing;
    if (recording) {
      const code = KEYS[id]?.code;
      if (code) this.pendingLine.push(code);
    }

    const consumed = this.applyPrefix(prefix, id);
    // a GTO keeps its prefix alive while the two target digits arrive
    if (recording && this.prefix === null) this.commitLine();
    return consumed;
  }

  private applyPrefix(prefix: Prefix, id: string): boolean {
    if (prefix === 'sto') return this.storeRegister(id);
    if (prefix === 'rcl') return this.recallRegister(id);
    if (prefix === 'goto') return this.gotoLine(id, 'run');
    if (prefix === 'f-goto') return this.gotoLine(id, 'skip');
    if (prefix === 'clear') return this.clearArea(id);
    if (prefix === 'g' || prefix === 'f') {
      const action = this.shifted(id, prefix);
      if (action) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- dispatching

  private dispatch(id: string): void {
    const digit = DIGIT_KEYS[id];
    if (digit) {
      this.pressDigit(digit);
      return;
    }
    switch (id) {
      case 'dot':
        this.pressDot();
        return;
      case 'EEX':
        this.pressEex();
        return;
      case 'CHS':
        this.pressChs();
        return;
      case 'ENTER':
        this.endEntry();
        this.liftStack();
        this.lift = false;
        this.displayOverride = null;
        this.dateResult = null;
        return;
      case 'add':
        this.binary((a, b) => a + b);
        return;
      case 'sub':
        this.binary((a, b) => a - b);
        return;
      case 'mul':
        this.binary((a, b) => a * b);
        return;
      case 'div':
        this.binary((a, b) => {
          if (b === 0) {
            this.fail();
            return 0;
          }
          return a / b;
        });
        return;
      case 'xy':
        this.swapXY();
        return;
      case 'Rv':
        this.rollDown();
        return;
      case 'CLx':
        this.clearX();
        return;
      case 'pctT':
        this.percentTotal();
        return;
      case 'pctD':
        this.percentDelta();
        return;
      case 'pct':
        this.percent();
        return;
      case 'yx':
        this.power();
        return;
      case 'inv':
        this.reciprocal();
        return;
      case 'sigPlus':
        this.sigmaPlus();
        return;
      case 'n':
      case 'i':
      case 'PV':
      case 'PMT':
      case 'FV':
        this.financial(id);
        return;
      case 'RS':
        this.runStop();
        return;
      case 'SST':
        this.step();
        return;
      case 'ON':
        this.powerOn();
        return;
      case 'f':
        this.prefix = 'f';
        return;
      case 'g':
        this.prefix = 'g';
        return;
      case 'STO':
        this.prefix = 'sto';
        return;
      case 'RCL':
        this.prefix = 'rcl';
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------------------ stack moves

  private binary(fn: (y: number, x: number) => number): void {
    const value = this.xValue();
    const left = this.y;
    this.lastX = value;
    this.endEntry();
    const result = fn(left, value);
    this.x = this.commit(result);
    this.dropStack();
    this.intAlt = null;
    this.lift = true;
  }

  /** One-number function: X is replaced, Y/Z/T are untouched. */
  private unary(fn: (x: number) => number | null): void {
    const value = this.xValue();
    this.lastX = value;
    this.endEntry();
    const result = fn(value);
    if (result === null) {
      this.fail();
      return;
    }
    this.x = this.commit(result);
    this.intAlt = null;
    this.lift = true;
  }

  /** A function that returns two numbers, both X and Y as the 12C does. */
  private dual(yValue: number, xValue: number): void {
    const value = this.xValue();
    this.lastX = value;
    this.endEntry();
    this.y = yValue;
    this.x = xValue;
    this.intAlt = null;
    this.lift = true;
  }

  private swapXY(): void {
    this.endEntry();
    if (this.intAlt !== null) {
      this.x = this.intAlt;
      this.intAlt = null;
    } else {
      const tmp = this.x;
      this.x = this.y;
      this.y = tmp;
    }
    this.lift = true;
  }

  private rollDown(): void {
    this.endEntry();
    // "the number in each stack register is copied into the register below, and
    // the number formerly in the X-register is copied into the T-register"
    const x = this.x;
    const y = this.y;
    const z = this.z;
    this.x = this.t;
    this.y = z;
    this.z = y;
    this.t = x;
    this.lift = false;
  }

  private clearX(): void {
    this.endEntry();
    this.x = 0;
    this.lastX = 0;
    this.intAlt = null;
    this.lift = false;
  }

  // ------------------------------------------------------------ percentages

  /** `y % x`: the stack does not drop for a percentage function. */
  private percent(): void {
    const value = this.xValue();
    this.lastX = value;
    this.endEntry();
    this.x = this.commit((this.y * value) / 100);
    this.lift = true;
  }

  /** `%T`: what percent of Y is X. */
  private percentTotal(): void {
    const value = this.xValue();
    this.lastX = value;
    this.endEntry();
    if (this.y === 0) {
      this.fail();
      return;
    }
    this.x = this.commit((value / this.y) * 100);
    this.lift = true;
  }

  /** `Δ%`: the percent change from Y to X, sign of the change. */
  private percentDelta(): void {
    const value = this.xValue();
    this.lastX = value;
    this.endEntry();
    if (this.y === 0) {
      this.fail();
      return;
    }
    this.x = this.commit(((value - this.y) / this.y) * 100);
    this.lift = true;
  }

  // ------------------------------------------------------------ mathematics

  private power(): void {
    const value = this.xValue();
    this.lastX = value;
    this.endEntry();
    const result = Math.pow(this.y, value);
    if (Number.isNaN(result) && !Number.isNaN(this.y) && !Number.isNaN(value)) {
      this.fail();
      return;
    }
    this.x = this.commit(result);
    this.dropStack();
    this.lift = true;
  }

  private reciprocal(): void {
    this.unary((x) => {
      if (x === 0) return null;
      return 1 / x;
    });
  }

  // ------------------------------------------------------------------- math

  private shifted(id: string, shift: 'f' | 'g'): boolean {
    const key = KEYS[id];
    if (!key) return false;
    const label = shift === 'f' ? key.gold : key.blue;
    if (label === undefined) {
      // a prefixed display format, a prefix clear, or an unlabelled key
      if (shift === 'f') {
        if (DIGIT_KEYS[id] !== undefined) return this.setFix(Number(DIGIT_KEYS[id]));
        if (id === 'dot') return this.setSci();
        if (id === 'ENTER') {
          this.endEntry();
          this.mantissaView = true;
          return true;
        }
      }
      this.lift = true;
      return true;
    }
    return this.runShifted(label, shift);
  }

  private runShifted(label: string, shift: 'f' | 'g'): boolean {
    return shift === 'f' ? this.gold(label) : this.blue(label);
  }

  // ------------------------------------------------------------- blue labels

  private blue(label: string): boolean {
    switch (label) {
      case '12x':
        this.endEntry();
        this.fin.n = this.commit(this.xValue() * 12);
        this.finJustStored = null;
        this.lift = true;
        return true;
      case '12÷':
        this.endEntry();
        this.fin.i = this.commit(this.xValue() / 12);
        this.finJustStored = null;
        this.lift = true;
        return true;
      case 'CFo':
        return this.cashFlowZero();
      case 'CFj':
        return this.cashFlowNext();
      case 'Nj':
        return this.cashFlowCount();
      case 'DATE':
        return this.addDaysDate();
      case 'ΔDAYS':
        return this.deltaDays();
      case 'BEG':
        this.begin = true;
        this.lift = true;
        return true;
      case 'END':
        this.begin = false;
        this.lift = true;
        return true;
      case 'MEM':
        return this.showMemory();
      case '√x':
        this.unary((x) => (x < 0 ? null : Math.sqrt(x)));
        return true;
      case 'eˣ':
        this.unary(Math.exp);
        return true;
      case 'LN':
        this.unary((x) => (x <= 0 ? null : Math.log(x)));
        return true;
      case 'FRAC':
        this.unary((x) => x - Math.trunc(x));
        return true;
      case 'INTG':
        this.unary(Math.trunc);
        return true;
      case 'n!':
        this.unary((x) => statistics.factorial(x));
        return true;
      case 'D.MY':
        this.monthFirst = false;
        return true;
      case 'M.DY':
        this.monthFirst = true;
        return true;
      case 'x̄':
        this.showMean();
        return true;
      case 's':
        this.showStdDev();
        return true;
      case 'x̄,w':
        this.showWeighted();
        return true;
      case 'x̂,r':
        this.showEstimateX();
        return true;
      case 'ŷ,r':
        this.showEstimateY();
        return true;
      case 'PSE':
        return this.pause();
      case 'BST':
        this.backStep();
        return true;
      case 'GTO':
        this.prefix = 'goto';
        return true;
      case 'LSTx':
        this.lastXRecall();
        return true;
      case 'x≤y':
        this.testCompare();
        return true;
      case 'x=0':
        this.testZero();
        return true;
      case 'Σ−':
        this.sigmaMinus();
        return true;
      default:
        return false;
    }
  }

  // ------------------------------------------------------------- gold labels

  private gold(label: string): boolean {
    switch (label) {
      case 'AMORT':
        return this.amort();
      case 'INT':
        return this.simpleInterest();
      case 'NPV':
        return this.netPresentValue();
      case 'RND':
        this.unary((x) => roundToDisplay(x, this.display));
        return true;
      case 'IRR':
        return this.internalRate();
      case 'PRICE':
        return this.bond('PRICE');
      case 'YTM':
        return this.bond('YTM');
      case 'SL':
        return this.depreciation('SL');
      case 'SOYD':
        return this.depreciation('SOYD');
      case 'DB':
        return this.depreciation('DB');
      case 'P/R':
        this.program = !this.program;
        this.pendingLine = [];
        this.prefix = null;
        this.lineReplace = this.program;
        // the shift that switches modes is not part of any program line
        this.lift = false;
        // leaving Program mode parks the line pointer back on 00
        if (!this.program) this.lineIndex = 0;
        return true;
      case 'Σ':
        this.sums = statistics.EMPTY_SUMS;
        this.x = this.y = this.z = this.t = 0;
        this.lift = false;
        return true;
      case 'PRGM':
        this.displayOverride = this.programLabel();
        this.lift = false;
        return true;
      case 'FIN':
        this.clearArea('xy');
        return true;
      case 'REG':
        return this.showRegister();
      case 'PREFIX':
        this.endEntry();
        this.mantissaView = true;
        this.lift = false;
        return true;
      case 'x=r':
        return this.showCorrelation();
      default:
        return false;
    }
  }

  // ------------------------------------------------------------- registers

  /** Index of R0-R9 / R.0-R.9 for a digit or `.`+digit pair. */
  private registerIndex(id: string, second: string | null): number | null {
    const digit = DIGIT_KEYS[id];
    if (digit !== undefined) return Number(digit);
    if (id === 'dot' && second !== null) {
      const d = DIGIT_KEYS[second];
      if (d !== undefined) return 10 + Number(d);
    }
    return null;
  }

  private storeRegister(id: string): boolean {
    const fin = FIN_KEYS.includes(id as FinKey) ? (id as FinKey) : null;
    if (fin) {
      this.endEntry();
      this.fin[fin] = this.x;
      this.finJustStored = fin;
      this.lift = false;
      return true;
    }
    const index = this.registerIndex(id, null);
    if (index === null) {
      this.lift = true;
      return true;
    }
    this.endEntry();
    this.regs[index] = this.x;
    this.lift = false;
    return true;
  }

  private recallRegister(id: string): boolean {
    const fin = FIN_KEYS.includes(id as FinKey) ? (id as FinKey) : null;
    this.endEntry();
    if (fin) {
      this.x = fin === 'i' ? this.fin.i * 100 : this.fin[fin];
      this.lift = true;
      return true;
    }
    const index = this.registerIndex(id, null);
    if (index === null) {
      this.lift = true;
      return true;
    }
    this.x = this.regs[index];
    this.lift = true;
    return true;
  }

  /** `f REG` shows R0 through R7, wrapping around. */
  private regCursor = 0;
  private showRegister(): boolean {
    this.endEntry();
    this.displayOverride = `R${this.regCursor}`.padEnd(10, ' ');
    this.regCursor = (this.regCursor + 1) % 8;
    this.lift = false;
    return true;
  }

  private lastXRecall(): void {
    this.endEntry();
    if (this.lift) this.liftStack();
    this.x = this.lastX;
    this.lift = true;
  }

  // -------------------------------------------------------------- clearing

  private clearArea(id: string): boolean {
    switch (id) {
      case 'REG':
        this.x = this.y = this.z = this.t = 0;
        this.regs.fill(0);
        this.sums = statistics.EMPTY_SUMS;
        this.fin = { n: 0, i: 0, PV: 0, PMT: 0, FV: 0, Nj: 1 };
        this.lift = false;
        return true;
      case 'FIN':
        this.fin = { ...this.fin, n: 0, i: 0, PV: 0, PMT: 0, FV: 0, Nj: 1 };
        this.cashFlowActive = false;
        this.cfCounts.fill(1);
        this.cfSlot = 0;
        this.begin = false;
        this.lift = false;
        return true;
      case 'SST':
        this.sums = statistics.EMPTY_SUMS;
        this.lift = false;
        return true;
      case 'RS':
        this.lines = [[]];
        this.lineIndex = 0;
        this.pendingLine = [];
        return true;
      case 'Rv':
        this.program = false;
        return true;
      case 'ENTER':
        this.displayOverride = null;
        return true;
      default:
        this.lift = true;
        return true;
    }
  }

  // -------------------------------------------------------------- financial

  /**
   * A financial key stores into its register, unless a value was just stored
   * into one of the other four *and* those four already describe a solvable
   * compound interest problem - then the key solves instead.  That is what
   * lets the handbook key `60 n`, `7 i`, `450 CHS PV` for simple interest,
   * where nothing is solvable, yet still compute n from PV, i and PMT.
   */
  private financial(id: string): void {
    const key = id as FinKey;
    this.endEntry();
    if (this.finJustStored !== null && this.finJustStored !== key && this.canSolve(key)) {
      const solved = solveTvm({ ...this.fin, beg: this.begin }, key);
      if (Number.isNaN(solved)) {
        this.finJustStored = null;
        this.fail();
        return;
      }
      // the register just computed stays the one that was "just stored", so the
      // next different financial key solves again
      this.fin[key] = solved;
      this.x = solved;
      this.lift = false;
      return;
    }
    this.fin[key] = key === 'i' ? this.x / 100 : this.x;
    this.finJustStored = key;
    this.lift = false;
  }

  /** True when the four registers other than `key` already pin it down. */
  private canSolve(key: FinKey): boolean {
    const { n, i, PV, PMT, FV } = this.fin;
    switch (key) {
      case 'n':
        // i, PV and PMT drive n; FV is normally left at zero
        return i !== 0 && PV !== 0 && PMT !== 0;
      case 'i':
        return n !== 0 && PV !== 0 && PMT !== 0 && FV !== 0;
      case 'PV':
        return n !== 0 && PMT !== 0 && FV !== 0;
      case 'PMT':
        return n !== 0 && (PV !== 0 || FV !== 0);
      case 'FV':
        return (n !== 0 && PV !== 0) || (n !== 0 && PMT !== 0) || (PV !== 0 && PMT !== 0);
    }
  }

  private setSci(): boolean {
    this.display.sci = true;
    this.lift = true;
    return true;
  }

  private setFix(digits: number): boolean {
    this.display.sci = false;
    this.display.fixDigits = digits;
    this.lift = true;
    return true;
  }

  // -------------------------------------------------------------- cash flow

  /** `g CFo`: X goes to R0 and the count of later cash flows restarts at zero. */
  private cashFlowZero(): boolean {
    this.endEntry();
    this.regs[0] = this.x;
    this.cfCounts[0] = 1;
    this.cfSlot = 0;
    this.fin.n = 0;
    this.fin.Nj = 1;
    this.cashFlowActive = true;
    this.lift = false;
    return true;
  }

  /** `g CFj`: X goes to the next register slot and n counts up. */
  private cashFlowNext(): boolean {
    this.endEntry();
    const slot = this.cfSlot + 1;
    if (slot > REGISTERS) {
      this.fail();
      return true;
    }
    if (slot === REGISTERS) this.fin.FV = this.x;
    else this.regs[slot] = this.x;
    this.cfCounts[slot] = 1;
    this.cfSlot = slot;
    this.fin.n += 1;
    this.fin.Nj = 1;
    this.cashFlowActive = true;
    this.lift = false;
    return true;
  }

  /**
   * `g Nj`: X becomes how many times the cash flow just stored repeats, which
   * is how grouped cash flows are entered.  n grows by the difference.
   */
  private cashFlowCount(): boolean {
    const count = Math.round(this.xValue());
    this.endEntry();
    if (count < 1 || count > 99 || !this.cashFlowActive) {
      this.fail();
      return true;
    }
    const previous = this.cfCounts[this.cfSlot];
    this.cfCounts[this.cfSlot] = count;
    this.fin.Nj = count;
    if (this.cfSlot === 0) this.fin.n = 0;
    else this.fin.n += count - previous;
    this.lift = false;
    return true;
  }

  /** One amount per stored slot, in order: R0..R9, R.0..R.9, then FV. */
  private cashFlowAmounts(): number[] {
    return [...this.regs, this.fin.FV];
  }

  /** The cash flows expanded, so equal consecutive amounts each occupy a period. */
  private cashFlowSeries(): number[] {
    const amounts = this.cashFlowAmounts();
    const series: number[] = [];
    for (let slot = 0; slot <= this.cfSlot; slot++) {
      for (let k = 0; k < this.cfCounts[slot]; k++) series.push(amounts[slot]);
    }
    return series;
  }

  private netPresentValue(): boolean {
    if (!this.cashFlow) {
      this.fail();
      return true;
    }
    const value = finance.npvTwelveC(this.fin.i, this.cashFlowSeries());
    // the manual also drops NPV into the PV register
    this.fin.PV = value;
    this.x = this.commit(value);
    this.lastX = 0;
    this.lift = false;
    return true;
  }

  private internalRate(): boolean {
    if (!this.cashFlow) {
      this.fail();
      return true;
    }
    const rate = finance.irr(this.cashFlowSeries(), 0.1);
    if (rate === null) {
      this.fail();
      return true;
    }
    this.fin.i = rate;
    // IRR is shown as a percent even though the register holds a decimal
    this.x = this.commit(rate * 100);
    this.lastX = 0;
    this.lift = false;
    return true;
  }

  // ------------------------------------------------------------------- AMORT

  private amort(): boolean {
    const periods = this.xValue();
    this.endEntry();
    const result = amortize(
      { ...this.fin, beg: this.begin },
      Math.round(periods),
      (v) => roundToDisplay(v, this.display),
    );
    this.fin.PV = result.balance;
    this.fin.n = result.count;
    this.dual(result.interest, result.principal);
    return true;
  }

  // -------------------------------------------------------- simple interest

  private simpleInterest(): boolean {
    const principal = this.fin.PV;
    const rate = this.fin.i;
    const days = this.fin.n;
    this.dual(-principal, finance.simpleInterest360(principal, rate, days));
    // dual() clears the pending figure, so arm it afterwards
    this.intAlt = finance.simpleInterest365(principal, rate, days);
    return true;
  }

  // ------------------------------------------------------------------- dates

  /**
   * Dates are decoded from the ten mantissa digits the register holds, so a
   * keyed `2.292020` keeps its trailing zero the way the real calculator does.
   */
  private parseOperand(value: number): calendar.DateParts | null {
    return calendar.parseDateText(exactDecimal(value), this.monthFirst);
  }


  private addDaysDate(): boolean {
    const days = this.xValue();
    const start = this.parseOperand(this.y);
    if (!start) {
      this.fail();
      return true;
    }
    const result = calendar.addDays(start, Math.trunc(days));
    this.dateResult = calendar.formatDateResult(result, this.monthFirst, this.display.sep);
    this.x = calendar.dateValue(result, this.monthFirst);
    this.lift = false;
    return true;
  }

  private deltaDays(): boolean {
    this.endEntry();
    const later = this.parseOperand(this.x);
    const earlier = this.parseOperand(this.y);
    if (!later || !earlier) {
      this.fail();
      return true;
    }
    const actual = calendar.daysBetween(earlier, later);
    const thirty = calendar.daysThirtyDay(earlier, later);
    this.x = actual;
    this.y = thirty;
    this.lift = false;
    return true;
  }

  // ------------------------------------------------------------ depreciation

  private depreciation(method: finance.DepreciationMethod): boolean {
    const year = this.xValue();
    this.endEntry();
    const result = finance.depreciate(
      method,
      this.fin.PV,
      this.fin.FV,
      this.fin.n,
      this.fin.i,
      year,
    );
    const r = (v: number) => roundToDisplay(v, this.display);
    this.y = r(result.remaining);
    this.x = r(result.depreciation);
    return true;
  }

  // ------------------------------------------------------------------- bonds

  private bond(which: 'PRICE' | 'YTM'): boolean {
    this.endEntry();
    const maturity = this.parseOperand(this.x);
    const settlement = this.parseOperand(this.y);
    if (!maturity || !settlement) {
      this.fail();
      return true;
    }
    const redemption = this.fin.FV === 0 ? 100 : this.fin.FV;
    if (which === 'PRICE') {
      const result = finance.bondPrice(
        settlement,
        maturity,
        this.fin.PMT,
        this.fin.i,
        redemption,
      );
      this.y = roundToDisplay(result.total - result.price, this.display);
      this.x = roundToDisplay(result.price, this.display);
      return true;
    }
    const rate = finance.bondYtm(
      settlement,
      maturity,
      this.fin.PMT,
      this.fin.PV,
      redemption,
      this.fin.i || 4,
    );
    if (rate === null) {
      this.fail();
      return true;
    }
    this.fin.i = rate;
    this.x = rate;
    this.lastX = 0;
    this.lift = false;
    return true;
  }

  // ------------------------------------------------------------- statistics

  /** `Σ+`: X is the x-value and Y the y-value; the new count lands in X. */
  private sigmaPlus(): boolean {
    const value = this.xValue();
    this.endEntry();
    this.sums = statistics.accumulate(this.sums, value, this.y);
    this.x = this.sums.n;
    this.lift = false;
    return true;
  }

  /** `g Σ−`: cancels the observation held in X and Y. */
  private sigmaMinus(): boolean {
    const value = this.xValue();
    this.endEntry();
    this.sums = statistics.remove(this.sums, value, this.y);
    this.x = this.sums.n;
    this.lift = false;
    return true;
  }

  private showMean(): boolean {
    const s = this.sums;
    const mx = statistics.meanX(s);
    const my = statistics.meanY(s);
    if (mx === null) return this.fail2();
    this.y = my ?? 0;
    this.x = mx;
    this.lift = false;
    return true;
  }

  private showStdDev(): boolean {
    const s = this.sums;
    const sx = statistics.stdDevX(s);
    const sy = statistics.stdDevY(s);
    if (sx === null) return this.fail2();
    this.y = sy ?? 0;
    this.x = sx;
    this.lift = false;
    return true;
  }

  private showWeighted(): boolean {
    const mean = statistics.weightedMean(this.sums);
    if (mean === null) return this.fail2();
    this.x = mean;
    this.lift = false;
    return true;
  }

  private showEstimateX(): boolean {
    this.endEntry();
    const estimate = statistics.estimateXhat(this.sums, this.x);
    const r = statistics.correlation(this.sums);
    if (estimate === null || r === null) return this.fail2();
    this.y = r;
    this.x = estimate;
    this.lift = false;
    return true;
  }

  private showEstimateY(): boolean {
    this.endEntry();
    const estimate = statistics.estimateYhat(this.sums, this.x);
    const r = statistics.correlation(this.sums);
    if (estimate === null || r === null) return this.fail2();
    this.y = r;
    this.x = estimate;
    this.lift = false;
    return true;
  }

  private showCorrelation(): boolean {
    const r = statistics.correlation(this.sums);
    if (r === null) return this.fail2();
    this.x = r;
    this.lift = false;
    return true;
  }

  private fail2(): boolean {
    this.fail();
    return true;
  }

  // ------------------------------------------------------------------- misc

  private showMemory(): boolean {
    const used = this.lines.slice(1).filter((l) => l.length > 0).length;
    this.displayOverride = `${used}`.padEnd(10, ' ');
    this.lift = false;
    return true;
  }

  private pause(): boolean {
    this.displayOverride = formatValue(this.x, this.display);
    return true;
  }

  // ---------------------------------------------------------------- program
  //
  // A program line is the list of keycodes recorded while it was being keyed.
  // `f P/R` toggles the PRGM annunciator, digits choose the line, and `g GTO`
  // or `f GTO` are stored as the keycode pair plus the target line's digits.

  /** Record a key into the current program line. */
  private record(id: string): void {
    const code = KEYS[id]?.code;
    if (!code) return;
    if (id === 'f' || id === 'g') {
      this.pendingLine.push(code);
      this.prefix = id;
      return;
    }
    if (id === 'STO' || id === 'RCL') {
      this.pendingLine.push(code);
      this.prefix = id === 'STO' ? 'sto' : 'rcl';
      return;
    }
    this.pendingLine.push(code);
    this.commitLine();
  }

  private commitLine(): void {
    if (this.pendingLine.length === 0) return;
    while (this.lines.length <= this.lineIndex) this.lines.push([]);
    // The first instruction keyed into a line replaces what was stored there,
    // as the manual says; the rest of that line is appended.
    const existing = this.lineReplace ? [] : (this.lines[this.lineIndex] ?? []);
    this.lines[this.lineIndex] = [...existing, ...this.pendingLine];
    this.pendingLine = [];
    this.lineReplace = false;
  }

  /** `g GTO` and `f GTO` both take the target line as two digit key presses. */
  private gotoLine(id: string, kind: 'run' | 'skip'): boolean {
    const digit = DIGIT_KEYS[id];
    if (digit === undefined) return true;
    this.gotoDigits.push(digit);
    if (this.gotoDigits.length === 2) {
      const target = Number(this.gotoDigits.join(''));
      this.gotoDigits = [];
      this.gotoKind = kind;
      this.gotoTarget = target;
      this.lineReplace = true;
      this.lift = false;
    } else {
      this.prefix = kind === 'skip' ? 'f-goto' : 'goto';
    }
    return true;
  }

  private gotoDigits: string[] = [];
  private gotoKind: 'run' | 'skip' = 'run';
  private gotoTarget = 0;
  private lastTestResult = false;

  private runStop(): void {
    if (this.running) {
      this.running = false;
      return;
    }
    // line 00 holds the hidden halt, so R/S from there begins at line 01
    if (this.lineIndex === 0) this.lineIndex = 1;
    this.execute();
  }

  /**
   * Interpret a recorded line and report where execution continues.  `tested` is
   * the outcome of a conditional test on the previous line, or null when the
   * previous line was not one.
   */
  private executeLine(line: string[], tested: boolean | null): LineResult {
    // a GTO line is the g GTO keycode pair followed by the target digits
    if (line.length >= 4 && line[0] === '43' && line[1] === '33') {
      const target = Number(line.slice(2).join(''));
      // Straight after a conditional test a GTO is the "do if true" arm, so a
      // failed test steps over it; anywhere else GTO is unconditional.
      if (tested !== null && !tested) return { jump: null, conditional: true };
      return { jump: target, conditional: false };
    }
    let conditional = false;
    for (let k = 0; k < line.length; k++) {
      const code = line[k];
      const id = KEYS_ID_BY_CODE[code];
      if (!id) continue;
      // `g x<=y` (34) and `g x=0` (35) are conditional tests rather than
      // ordinary shifted keys, so they are read straight off the stack
      if (this.prefix === 'g' && (code === '34' || code === '35')) {
        this.prefix = null;
        this.lastTestResult = code === '34' ? this.x <= this.y : this.x === 0;
        conditional = true;
        continue;
      }
      if (this.consumePrefix(id)) continue;
      this.executing = true;
      this.dispatch(id);
      this.executing = false;
    }
    return { jump: null, conditional };
  }

  /** Run program memory starting at the current line. */
  private execute(): void {
    this.executing = true;
    this.running = true;
    let guard = 0;
    // outcome of a conditional test on the line just executed
    let tested: boolean | null = null;
    while (this.running && guard++ < 20000) {
      const line = this.lines[this.lineIndex];
      if (!line || line.length === 0) break;
      const { jump, conditional } = this.executeLine(line, tested);
      if (!this.running) break;
      if (jump !== null) this.lineIndex = jump;
      // "do if true": a failed test steps over the following line
      else this.lineIndex += conditional && !this.lastTestResult ? 2 : 1;
      tested = conditional ? this.lastTestResult : null;
    }
    this.running = false;
    this.executing = false;
    // the manual parks the line pointer back on 00 once a program finishes
    this.lineIndex = 0;
    if (guard >= 20000) this.fail();
  }

  private testCompare(): boolean {
    this.lastTestResult = this.x <= this.y;
    return true;
  }

  private testZero(): boolean {
    this.lastTestResult = this.x === 0;
    return true;
  }

  /** `SST`: run one line and show the next line number. */
  private step(): void {
    const line = this.lines[this.lineIndex];
    if (!line || line.length === 0) {
      this.lineIndex++;
      return;
    }
    this.executing = true;
    const { jump, conditional } = this.executeLine(line, null);
    this.executing = false;
    this.lineIndex =
      jump ?? this.lineIndex + (conditional && !this.lastTestResult ? 2 : 1);
  }

  /** `g BST`: step one line back. */
  private backStep(): boolean {
    if (this.lineIndex > 0) this.lineIndex--;
    this.lift = false;
    return true;
  }

  private powerOn(): void {
    this.error = false;
    this.prefix = null;
    this.entry = null;
    this.displayOverride = null;
    this.lift = false;
  }
}

const KEYS_ID_BY_CODE: Record<string, string> = {};
for (const key of Object.values(KEYS)) KEYS_ID_BY_CODE[key.code] = key.id;


/** Full reset, as `ON` + `f CLEAR REG` does on a real 12C. */
export function createHp12c(): Hp12c {
  return new Hp12c();
}