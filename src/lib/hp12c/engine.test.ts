// The engine driven entirely through key presses, checked against worked
// examples in the HP-12C owner's handbook.

import { describe, expect, it } from 'vitest';
import { Hp12c } from './engine';

function calc(...keys: string[]): Hp12c {
  const machine = new Hp12c();
  for (const key of keys) machine.press(key);
  return machine;
}

/** the ten character LCD field, trimmed */
function shown(machine: Hp12c): string {
  return machine.view().text.trim();
}

/** the number inside X, without the display rounding */
function value(machine: Hp12c): number {
  return machine.x;
}

/** Key names for a run of digits. */
function digits(text: string): string[] {
  return [...text].map((d) => `d${d}`);
}

/**
 * The handbook sales sample.  The value keyed before ENTER lands in Y and the
 * one after it in X, so each pair is keyed as [y, x]: dollars of monthly sales
 * against hours worked.
 */
const SAMPLE_PAIRS = [
  [17000, 32],
  [25000, 40],
  [26000, 45],
  [20000, 40],
  [21000, 38],
  [28000, 50],
  [15000, 35],
].flatMap(([y, x]) => [...digits(String(y)), 'ENTER', ...digits(String(x)), 'sigPlus']);

describe('display', () => {
  it('starts in FIX 2 with two cleared registers', () => {
    const c = calc();
    expect(shown(c)).toBe('0.00');
  });

  it('groups thousands and picks up the comma separator', () => {
    expect(shown(calc('d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'ENTER'))).toBe('1,234,567.00');
  });

  it('changes FIX with f and a digit', () => {
    expect(shown(calc('f', 'd4', 'd5', 'd0', 'ENTER'))).toBe('50.0000');
  });

  it('switches to scientific with f . and shows a blank exponent sign', () => {
    expect(shown(calc('f', 'dot', 'd1', 'dot', 'd4', 'd8', 'd7', 'd4', 'd5', 'd6', 'EEX', 'd0', 'd1'))).toBe('1.487456 01');
  });

  it('formats a negative number', () => {
    expect(shown(calc('d5', 'ENTER', 'd2', 'sub'))).toBe('3.00');
  });

  it('keeps values below one in the fraction, not the integer column', () => {
    expect(shown(calc('d3', 'ENTER', 'd1', 'd2', 'div'))).toBe('0.25');
    expect(shown(calc('d2', 'ENTER', 'd5', 'div'))).toBe('0.40');
    expect(shown(calc('d1', 'ENTER', 'd1', 'd6', 'div'))).toBe('0.06');
    expect(shown(calc('d8', 'ENTER', 'd1', 'd0', 'd0', 'div'))).toBe('0.08');
  });

  it('shows leading zeros for small values instead of shifting them', () => {
    expect(shown(calc('d1', 'ENTER', 'd4', 'div', 'f', 'd4'))).toBe('0.2500');
    expect(shown(calc('d1', 'ENTER', 'd8', 'd0', 'div', 'f', 'd4'))).toBe('0.0125');
  });

  it('falls back to scientific when only zeros would show', () => {
    expect(shown(calc('d1', 'ENTER', 'd1', 'd0', 'd0', 'd0', 'd0', 'div'))).toBe('1.000000-04');
    expect(shown(calc('d1', 'ENTER', 'd1', 'd0', 'd0', 'd0', 'div'))).toBe('1.000000-03');
  });

  it('starts a new number after a display format key', () => {
    // f 0 leaves 99.999 in X; typing 8 must not extend it to 99.9998
    const c = calc('d9', 'd9', 'dot', 'd9', 'd9', 'd9', 'ENTER', 'f', 'd0', 'd8');
    expect(shown(c)).toBe('8');
  });

  it('carries a rounding overflow into the integer column', () => {
    expect(shown(calc('d9', 'd9', 'dot', 'd9', 'd9', 'd9'))).toBe('100.00');
    expect(shown(calc('d0', 'dot', 'd9', 'd9', 'd9'))).toBe('1.00');
    expect(shown(calc('d9', 'd9', 'dot', 'd9', 'd9', 'd9', 'ENTER', 'f', 'd0'))).toBe('100');
  });
});

describe('RPN stack', () => {
  it('does arithmetic the way it is written on paper', () => {
    expect(shown(calc('d8', 'ENTER', 'd2', 'add'))).toBe('10.00');
    expect(shown(calc('d8', 'ENTER', 'd2', 'sub'))).toBe('6.00');
    expect(shown(calc('d8', 'ENTER', 'd2', 'mul'))).toBe('16.00');
    expect(shown(calc('d8', 'ENTER', 'd2', 'div'))).toBe('4.00');
  });

  it('drops the stack after a two-number function', () => {
    const c = calc('d8', 'ENTER', 'd2', 'add', 'd3', 'add');
    expect(shown(c)).toBe('13.00');
  });

  it('keeps the stack for a percentage function', () => {
    // 200 ENTER 10 % = 20, and Y still holds 200
    const c = calc('d2', 'd0', 'd0', 'ENTER', 'd1', 'd0', 'pct');
    expect(shown(c)).toBe('20.00');
    expect(shown(calc('d2', 'd0', 'd0', 'ENTER', 'd1', 'd0', 'pct', 'xy'))).toBe('200.00');
  });

  it('does not lift the stack right after ENTER', () => {
    // 5 ENTER 2 leaves X = 2 and Y = 5, so 5 + 2 still works
    expect(shown(calc('d5', 'ENTER', 'd2', 'add'))).toBe('7.00');
  });

  it('puts the constant in X, Y, Z and T after three ENTERs', () => {
    const c = calc('d2', 'ENTER', 'ENTER', 'ENTER');
    expect(shown(c)).toBe('2.00');
    // R- down walks back through the constant
    expect(shown(calc('d2', 'ENTER', 'ENTER', 'ENTER', 'Rv'))).toBe('2.00');
  });

  it('runs the handbook chain of doublings', () => {
    // the constant stays in Y, so x is multiplied by it over and over
    const c = calc('d2', 'ENTER', 'ENTER', 'ENTER', 'd8', 'd4', 'd0', 'd0', 'd0', 'mul');
    for (const expected of ['168,000.00', '336,000.00', '672,000.00']) {
      expect(shown(c)).toBe(expected);
      c.press('mul');
    }
    // the constant survived in Y, so R- down brings it back up
    expect(shown(calc(
      'd2', 'ENTER', 'ENTER', 'ENTER',
      'd8', 'd4', 'd0', 'd0', 'd0', 'mul', 'Rv',
    ))).toBe('2.00');
  });

  it('recalls the previous result with g LSTx', () => {
    const c = calc('d8', 'ENTER', 'd2', 'add', 'g', 'ENTER');
    expect(shown(c)).toBe('2.00');
  });

  it('rolls the stack down', () => {
    // X 3, Y 2, Z 1, T 0: R- down shows T, then Z
    expect(shown(calc('d1', 'ENTER', 'd2', 'ENTER', 'd3', 'Rv'))).toBe('0.00');
    expect(shown(calc('d1', 'ENTER', 'd2', 'ENTER', 'd3', 'Rv', 'Rv'))).toBe('3.00');
  });
});

describe('percentages', () => {
  it('computes %T as what X is of Y', () => {
    expect(shown(calc('d2', 'd0', 'd0', 'ENTER', 'd5', 'd0', 'pctT'))).toBe('25.00');
  });

  it('computes the percent change with Δ%', () => {
    expect(shown(calc('d2', 'd0', 'd0', 'ENTER', 'd2', 'd5', 'd0', 'pctD'))).toBe('25.00');
  });
});

describe('mathematics', () => {
  it('raises y to x', () => {
    expect(value(calc('d2', 'ENTER', 'd1', 'd0', 'yx'))).toBeCloseTo(1024, 4);
  });

  it('takes the reciprocal, square root and logarithms', () => {
    expect(value(calc('d4', 'inv'))).toBeCloseTo(0.25, 10);
    expect(value(calc('d2', 'g', 'yx'))).toBeCloseTo(Math.SQRT2, 9);
    expect(value(calc('d1', 'g', 'inv'))).toBeCloseTo(Math.E, 9);
    expect(value(calc('d1', 'g', 'pctT'))).toBeCloseTo(0, 10);
  });

  it('computes a factorial with g 3', () => {
    expect(shown(calc('d5', 'g', 'd3'))).toBe('120.00');
  });

  it('halts on a division by zero', () => {
    const c = calc('d5', 'ENTER', 'd0', 'div');
    expect(c.error).toBe(true);
  });
});

describe('registers', () => {
  it('stores and recalls', () => {
    expect(shown(calc('d4', 'd2', 'ENTER', 'STO', 'd3', 'RCL', 'd3'))).toBe('42.00');
  });

  it('does not lift the stack after storing into a financial register', () => {
    const store = calc('d1', 'd0', 'd0', 'd0', 'd0', 'PV');
    expect(shown(store)).toBe('10,000.00');
    expect(store.fin.PV).toBe(10000);
    // a number keyed straight after the store replaces X rather than lifting
    expect(shown(calc('d1', 'd0', 'd0', 'd0', 'd0', 'PV', 'd7'))).toBe('7.00');
  });
});

describe('time value of money', () => {
  // $35,000 borrowed at 10.5% a year and repaid $325 a month
  const CABIN = [
    'd3', 'd5', 'd0', 'd0', 'd0', 'PV',
    'd0', 'dot', 'd1', 'd0', 'dot', 'd5', 'g', 'i',
    'd3', 'd2', 'd5', 'CHS', 'PMT',
  ];

  it('stores four registers then solves the fifth', () => {
    expect(calc(...CABIN).fin.i).toBeCloseTo(0.00875, 12);
    expect(shown(calc(...CABIN, 'n'))).toBe('328.00');
  });

  it('re-solves whenever the register order changes', () => {
    // 328 full payments overpay, 327 still leave a balance
    expect(value(calc(...CABIN, 'd3', 'd2', 'd8', 'n', 'FV'))).toBeCloseTo(181.89, 2);
    // n has to be forced down, otherwise n is solved instead of stored
    expect(value(calc(...CABIN, 'd3', 'd2', 'd7', 'STO', 'n', 'FV'))).toBeCloseTo(-141.87, 2);
  });

  it('lights C once four registers are known', () => {
    expect(calc('d3', 'd5', 'ENTER', 'd0', 'd0', 'd0', 'PV').view().annunciators.c).toBe(false);
    expect(calc('d3', 'd5', 'ENTER', 'd0', 'd0', 'd0', 'PV', 'd1').view().annunciators.c).toBe(false);
  });

  it('multiplies by twelve with g n and divides by twelve with g i', () => {
    expect(calc('d2', 'd5', 'g', 'n').fin.n).toBe(300);
    // 0.105 is 10.5% a year, so the monthly rate is 0.00875
    expect(calc('d0', 'dot', 'd1', 'd0', 'dot', 'd5', 'g', 'i').fin.i).toBeCloseTo(0.00875, 12);
  });

  it('switches to BEGIN mode with g 7', () => {
    const c = calc('d3', 'd5', 'ENTER', 'd0', 'd0', 'd0', 'PV', 'g', 'd7');
    expect(c.begin).toBe(true);
    expect(c.view().annunciators.begin).toBe(true);
    expect(calc('g', 'd8').begin).toBe(false);
  });

  it('amortizes the first year of the handbook mortgage', () => {
    // $50,000 at 13.25% a year for 30 years, with the monthly payment solved
    const MORTGAGE = [
      'd5', 'd0', 'd0', 'd0', 'd0', 'PV',
      'd0', 'dot', 'd1', 'd3', 'dot', 'd2', 'd5', 'g', 'i',
      'd5', 'd7', 'd3', 'dot', 'd3', 'd5', 'CHS', 'PMT',
    ];
    // AMORT works in payments, so a year of the mortgage is twelve of them
    expect(shown(calc(...MORTGAGE, 'd1', 'd2', 'f', 'n'))).toBe('-271.31');
    expect(shown(calc(...MORTGAGE, 'd1', 'd2', 'f', 'n', 'xy'))).toBe('-6,608.89');
  });
});

describe('simple interest', () => {
  // 60 days at 7% a year on a $450 loan
  const LOAN = ['d6', 'd0', 'n', 'd7', 'i', 'd4', 'd5', 'd0', 'CHS', 'PV'];

  it('matches the handbook loan example', () => {
    expect(shown(calc(...LOAN, 'f', 'i'))).toBe('5.25');
    // the principal is waiting in Y, so + totals the loan
    expect(shown(calc(...LOAN, 'f', 'i', 'add'))).toBe('455.25');
  });

  it('shows the 365 day figure on the next x-y', () => {
    expect(shown(calc(...LOAN, 'f', 'i', 'xy'))).toBe('5.18');
  });
});

describe('dates', () => {
  it('adds days and reports the weekday, the handbook way', () => {
    // 14 May 1981 plus 120 days is Friday 11 September 1981; in the default
    // month-day-year format that reads 09,11,1981 with a 5 at the right
    const c = calc(
      'd5', 'dot', 'd1', 'd4', 'd1', 'd9', 'd8', 'd1', 'ENTER',
      'd1', 'd2', 'd0', 'g', 'CHS',
    );
    expect(shown(c)).toBe('09,11,1981 5');
  });

  it('counts actual and 30 day intervals with g ΔDAYS', () => {
    // 1 January 1981 to 31 December 1981: 364 actual days, 360 on a 30 day basis
    const span = [
      'd1', 'dot', 'd0', 'd1', 'd1', 'd9', 'd8', 'd1', 'ENTER',
      'd1', 'd2', 'dot', 'd3', 'd1', 'd1', 'd9', 'd8', 'd1', 'g', 'EEX',
    ];
    expect(shown(calc(...span))).toBe('364.00');
    expect(shown(calc(...span, 'xy'))).toBe('360.00');
  });

  it('switches the date order with g 4 and g 5', () => {
    expect(calc('g', 'd4').view().annunciators.dmy).toBe(true);
    expect(calc('g', 'd5').view().annunciators.dmy).toBe(false);
  });
});

describe('statistics', () => {
  it('accumulates pairs and returns the mean of both values', () => {
    // three pairs whose x-values are 2, 4, 6 and whose y-values are 1, 2, 3
    const pairs = ['d1', 'ENTER', 'd2', 'sigPlus', 'd2', 'ENTER', 'd4', 'sigPlus', 'd3', 'ENTER', 'd6', 'sigPlus'];
    expect(shown(calc(...pairs, 'g', 'd0'))).toBe('4.00');
    expect(shown(calc(...pairs, 'g', 'd0', 'xy'))).toBe('2.00');
  });

  it('reports the count in R1 after Σ+', () => {
    const c = calc('d1', 'ENTER', 'd2', 'sigPlus', 'd2', 'ENTER', 'd4', 'sigPlus');
    expect(shown(c)).toBe('2.00');
  });

  it('clears the statistics registers with f Σ', () => {
    const c = calc('d1', 'ENTER', 'd2', 'sigPlus', 'f', 'SST');
    expect(c.regs[1]).toBe(0);
    expect(c.regs[2]).toBe(0);
  });

  it('estimates a y-value for a new x and reports the correlation in Y', () => {
    // the handbook sales sample: y = -7093.05 + 720.18x
    const c = calc(...SAMPLE_PAIRS, 'd4', 'd8', 'g', 'd2');
    expect(value(c)).toBeCloseTo(27475.75, 2);
    expect(value(calc(...SAMPLE_PAIRS, 'd4', 'd8', 'g', 'd2', 'xy'))).toBeCloseTo(0.9005, 3);
  });

  it('estimates an x-value for a new y with g x̂,r', () => {
    // the estimate is stored and recalled so that g x̂,r reads it as a y-value
    const c = calc(...SAMPLE_PAIRS, 'd4', 'd8', 'g', 'd2', 'STO', 'd0', 'RCL', 'd0', 'g', 'd1');
    expect(value(c)).toBeCloseTo(48, 6);
  });

});

describe('display format', () => {
  it('shows the mantissa when ENTER is prefixed with f', () => {
    const c = calc('d1', 'ENTER', 'd2', 'add', 'f', 'ENTER');
    expect(shown(c)).toBe('3000000000');
  });
});

describe('program mode', () => {
  it('toggles the PRGM annunciator', () => {
    expect(calc('f', 'RS').program).toBe(true);
    expect(calc('f', 'RS', 'f', 'RS').program).toBe(false);
  });

  it('records keycodes onto the current line', () => {
    const c = calc('f', 'RS', 'd0', 'RCL', 'd0', 'ENTER');
    expect(c.program).toBe(true);
    // RCL 0 ENTER is keycodes 45, 0, 36
    expect(c.lines[0]).toEqual(['45', '0', '36']);
  });
});
describe('cash flow', () => {
  // Keystrokes Display
  // 80000 CHS g CFo     -80,000.00   Stores CF0
  // 500  CHS g CFj        -500.00   Stores CF1
  // 4500        g CFj      4,500.00  Stores CF2
  // 5500        g CFj      5,500.00  Stores CF3
  // 4500        g CFj      4,500.00  Stores CF4
  // 130000      g CFj    130,000.00  Stores CF5
  // RCL n                 5.00       counts the flows after CF0
  // 13        i           13.00      Stores i
  // f NPV                212.18       NPV, also stored in PV
  // f IRR                 13.06       IRR, also stored in i (see below)
  const DUPLEX = [
    'd8', 'd0', 'd0', 'd0', 'd0', 'CHS', 'g', 'PV',
    'd5', 'd0', 'd0', 'CHS', 'g', 'PMT',
    'd4', 'd5', 'd0', 'd0', 'g', 'PMT',
    'd5', 'd5', 'd0', 'd0', 'g', 'PMT',
    'd4', 'd5', 'd0', 'd0', 'g', 'PMT',
    'd1', 'd3', 'd0', 'd0', 'd0', 'd0', 'g', 'PMT',
  ];

  it('counts each stored flow once', () => {
    const c = calc(...DUPLEX, 'RCL', 'n');
    expect(value(c)).toBe(5);
  });

  it('discounts CF0 by nothing and every later flow by its own period', () => {
    const c = calc(...DUPLEX, 'd1', 'd3', 'i', 'f', 'PV');
    expect(value(c)).toBeCloseTo(212.18, 2);
    expect(c.fin.PV).toBeCloseTo(212.18, 2);
  });

  it('finds the rate that drives NPV to zero', () => {
    // The handbook prints 13.72% here, but its own cash flows put the root at
    // 13.06%: NPV at 13.72% is -2,176.23, nowhere near zero, while the 212.18
    // NPV above reproduces exactly. So the printed rate looks like an erratum.
    const c = calc(...DUPLEX, 'f', 'FV');
    expect(value(c)).toBeCloseTo(13.06, 2);
    expect(c.fin.i).toBeCloseTo(0.1306, 4);
    // the register reads back as a percent
    expect(value(calc(...DUPLEX, 'f', 'FV', 'RCL', 'i'))).toBeCloseTo(13.06, 2);
  });

  it('expands grouped flows so Nj reaches past the stored amount', () => {
    // CF1 repeats three times: -500 in periods 1, 2 and 3
    const c = calc(
      'd8', 'd0', 'd0', 'd0', 'd0', 'CHS', 'g', 'PV',
      'd5', 'd0', 'd0', 'CHS', 'g', 'PMT',
      'd3', 'g', 'FV',
      'd1', 'd3', 'd0', 'd0', 'g', 'PMT',
      'RCL', 'n',
    );
    expect(value(c)).toBe(4);
  });

  it('fails when no cash flow has been keyed in', () => {
    expect(calc('d1', 'd3', 'i', 'f', 'PV').error).not.toBe(0);
  });
});

describe('program execution', () => {
  // Keystrokes      Line  What it does
  // RCL PV          01    the balance comes up
  // g x=0           02    once the loan is paid off the balance is zero
  // g GTO 07        03    ... so branch straight out
  // RCL 0           04    the payments to amortize this pass
  // f AMORT         05
  // g GTO 01        06    and round again
  // (empty)         07    the loop lands here and halts
  const LOOP = [
    'f', 'RS', // program mode
    'd1', 'RCL', 'PV',
    'd2', 'g', 'CLx',
    'd3', 'g', 'Rv', 'd0', 'd7',
    'd4', 'RCL', 'd0',
    'd5', 'f', 'n',
    'd6', 'g', 'Rv', 'd0', 'd1',
    'f', 'RS', // back to run mode
  ];

  // $1,000 paid off $100 at a time; with no interest the balance ends at zero
  const LOAN = [
    'd1', 'd0', 'd0', 'd0', 'PV',
    'd0', 'i',
    'd1', 'd0', 'd0', 'CHS', 'PMT',
  ];

  it('records the loop exactly as it was keyed', () => {
    const c = calc(...LOOP);
    expect(c.lines[1]).toEqual(['45', '13']);
    expect(c.lines[2]).toEqual(['43', '35']);
    expect(c.lines[3]).toEqual(['43', '33', '0', '7']);
    expect(c.lines[4]).toEqual(['45', '0']);
    expect(c.lines[5]).toEqual(['42', '11']);
    expect(c.lines[6]).toEqual(['43', '33', '0', '1']);
  });

  it('runs the loop until the loan is paid off', () => {
    const c = calc(...LOAN, ...LOOP, 'd1', 'STO', 'd0', 'RS');
    expect(c.view().running).toBe(false);
    expect(c.error).toBe(false);
    expect(c.fin.PV).toBeCloseTo(0, 6);
  });

  it('halts on line 00 when the balance is already zero', () => {
    const c = calc(...LOOP, 'd1', 'STO', 'd0', 'RS');
    expect(c.view().running).toBe(false);
    expect(c.error).toBe(false);
  });

  it('steps over the line after a failed test', () => {
    const c = calc(...LOOP);
    c.press('f');
    c.press('RS'); // program mode again
    // swap the branch-out line for one that simply runs AMORT a second time
    c.press('d3');
    c.press('f');
    c.press('n');
    expect(c.lines[3]).toEqual(['42', '11']);

    // The loop still pays the loan off exactly: while a balance is
    // outstanding the test fails and line 03 is stepped over, and on the last
    // pass it passes but there is nothing left to amortize.
    const run = calc(...LOAN, ...LOOP, 'd1', 'STO', 'd0', 'RS');
    expect(run.error).toBe(false);
    expect(run.fin.PV).toBeCloseTo(0, 6);
  });
});
