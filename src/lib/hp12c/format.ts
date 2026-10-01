// HP-12C display formatting.
//
// The HP-12C keeps 10 significant decimal digits internally and displays
// either a fixed-point or a scientific representation.  All rules here come
// from the HP-12C User's Guide, "Number Display Formats":
//
//   * factory / post-reset default is FIX 2
//   * FIX 0-9 is selected with `f` + digit; `f .` selects scientific
//   * at most 10 digits may be shown at once, so FIX n silently drops
//     decimals when the integer part needs the room
//   * anything that will not fit in the fixed format is displayed
//     scientifically without changing the stored format
//   * scientific shows the first seven digits plus a two digit exponent,
//     with a blank in place of a positive exponent sign
//   * digits left of the radix mark are grouped in threes

/** significant decimal digits held internally */
export const DIGITS = 10;
/** largest representable magnitude is 9.999999999e99 */
export const MAX_MAGNITUDE = 9.999999999e99;
/** below 1e-99 the 12C substitutes zero (it does not halt) */
export const MIN_MAGNITUDE = 1e-99;
/** exponent range of the display */
export const EXP_MAX = 99;

export interface DisplayFormat {
  /** true => scientific notation (`f .`) */
  sci: boolean;
  /** decimals shown in fixed mode, 0-9 (`f` + digit) */
  fixDigits: number;
  /** the radix (decimal) mark */
  radix: '.' | ',';
  /** the thousands separator */
  sep: ',' | '.';
}

export const DEFAULT_DISPLAY: DisplayFormat = {
  sci: false,
  fixDigits: 2,
  radix: '.',
  sep: ',',
};

export const OVERFLOW_POSITIVE = '9.999999 99';
export const OVERFLOW_NEGATIVE = '-9.999999 99';

/** Decompose a finite non-zero value into its 10 significant digits. */
function digitsOf(x: number): { digits: string; exp: number } {
  const [m, e] = Math.abs(x).toExponential(DIGITS - 1).split('e');
  return { digits: m.replace('.', ''), exp: Number(e) };
}

/** Add one to a string of decimal digits, returning the new string. */
function increment(head: string): string {
  const a = head.split('');
  let i = a.length - 1;
  while (i >= 0 && a[i] === '9') {
    a[i] = '0';
    i--;
  }
  if (i < 0) return '1' + a.join('');
  a[i] = String(Number(a[i]) + 1);
  return a.join('');
}

/**
 * Round the 10 significant `digits` so that only `keep` of them survive.
 * Half away from zero, matching the 12C (third digit 5-9 rounds up).
 */
function roundDigits(digits: string, keep: number): { head: string; grew: boolean } {
  if (keep >= digits.length) {
    return { head: digits + '0'.repeat(keep - digits.length), grew: false };
  }
  let head = digits.slice(0, Math.max(keep, 0));
  const roundUp = keep >= 0 && Number(digits.charAt(keep)) >= 5;
  if (roundUp) head = increment(head);
  return { head, grew: head.length > keep };
}

function group(intPart: string, sep: string): string {
  let out = '';
  for (let i = 0; i < intPart.length; i++) {
    const fromEnd = intPart.length - i;
    out += intPart[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += sep;
  }
  return out;
}

/**
 * Fractional rendering for a value below one, where the zeros between the radix
 * and the first significant digit occupy display positions of their own.  The
 * radix is the first position, so `0.005` needs two places to reach its digits.
 * `carried` reports rounding that pushed the value up to one, which the callers
 * render as an integer instead.
 */
function fractionPart(
  digits: string,
  exp: number,
  f: DisplayFormat,
): { carried: true; digits: string } | { carried: false; text: string } {
  const lead = -exp - 1;
  const places = Math.min(f.fixDigits, DIGITS);
  const { head, grew } = roundDigits('0'.repeat(lead) + digits, places);
  if (grew) return { carried: true, digits: head };
  return { carried: false, text: head.slice(0, places).padEnd(places, '0') };
}

/** True when a value cannot be shown in the current fixed-point format. */
export function needsScientific(x: number, f: DisplayFormat): boolean {
  if (x === 0) return false;
  const { digits, exp } = digitsOf(x);
  if (exp < 0) {
    const part = fractionPart(digits, exp, f);
    if (part.carried) return false;
    // nothing but zeros would reach the display
    return /^0*$/.test(part.text);
  }
  const intDigits = exp + 1;
  if (intDigits > DIGITS) return true;
  const decimals = Math.min(f.fixDigits, DIGITS - intDigits);
  if (decimals < 0) return true;
  const { head } = roundDigits(digits, intDigits + decimals);
  return /^0*$/.test(head.slice(0, intDigits));
}

/** Fixed-point rendering, e.g. `-6,608.89`.  Caller must check needsScientific. */
export function formatFixed(x: number, f: DisplayFormat): string {
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  if (x === 0) {
    const d = Math.min(f.fixDigits, DIGITS - 1);
    return `${sign}0${f.fixDigits > 0 ? f.radix + '0'.repeat(d) : ''}`;
  }
  const { digits, exp } = digitsOf(x);
  if (exp < 0) {
    const part = fractionPart(digits, exp, f);
    if (part.carried) {
      const whole = group(part.digits.slice(0, 1), f.sep);
      const rest = part.digits.slice(1);
      return f.fixDigits > 0 ? `${sign}${whole}${f.radix}${rest}` : `${sign}${whole}`;
    }
    return f.fixDigits > 0 ? `${sign}0${f.radix}${part.text}` : `${sign}0`;
  }
  let intDigits = exp + 1;
  let decimals = Math.min(f.fixDigits, DIGITS - intDigits);
  if (decimals < 0) decimals = 0;
  let { head, grew } = roundDigits(digits, intDigits + decimals);
  if (grew) {
    // The rounding carried, so the value is now 1 followed by zeros.
    intDigits++;
    decimals = Math.max(0, Math.min(f.fixDigits, DIGITS - intDigits));
    head = '1' + '0'.repeat(intDigits + decimals - 1);
  }
  const intPart = head.slice(0, intDigits).padStart(intDigits, '0');
  const fracPartText = head.slice(intDigits).padEnd(decimals, '0');
  return sign + group(intPart, f.sep) + (decimals > 0 ? f.radix + fracPartText : '');
}

/** Scientific rendering, e.g. `1.487456 01` or `-1.487456-05`. */
export function formatSci(x: number): string {
  const sign = x < 0 ? '-' : '';
  if (x === 0) return `${sign}0.000000 00`;
  let { digits, exp } = digitsOf(x);
  // seven significant digits, renormalising if rounding carries (9.9999999 -> 10.00000)
  let seven = roundDigits(digits, 7);
  if (seven.head.length > 7) {
    exp += seven.head.length - 7;
    seven = { head: seven.head, grew: false };
  }
  const mant = seven.head.padStart(7, '0');
  const out = `${mant[0]}.${mant.slice(1)}`;
  const marker = exp < 0 ? '-' : ' ';
  const e = String(Math.min(Math.abs(exp), EXP_MAX)).padStart(2, '0');
  return sign + out + marker + e;
}

/**
 * Render a value for the LCD, honouring the current format.  `overflow` is
 * returned separately because the 12C halts the calculation.
 */
export function formatValue(x: number, f: DisplayFormat): string {
  if (!Number.isFinite(x)) return OVERFLOW_POSITIVE;
  if (Math.abs(x) > MAX_MAGNITUDE) return x < 0 ? OVERFLOW_NEGATIVE : OVERFLOW_POSITIVE;
  if (f.sci || needsScientific(x, f)) return formatSci(x);
  return formatFixed(x, f);
}

/** All ten digits of the mantissa, as shown while ENTER is held. */
export function formatMantissa(x: number): string {
  if (x === 0) return '0'.repeat(DIGITS);
  return (x < 0 ? '-' : '') + digitsOf(x).digits;
}

/**
 * Decimal text carrying every one of the ten mantissa digits, so a keyed
 * `2.292020` keeps its trailing zero the way the register does.  The radix mark
 * is always `.` and there are no group separators.
 */
export function exactDecimal(x: number): string {
  if (!Number.isFinite(x) || x === 0) return '0';
  const { digits, exp } = digitsOf(x);
  const sign = x < 0 ? '-' : '';
  const point = exp + 1;
  if (point > 0) return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${sign}0.${'0'.repeat(-point)}${digits}`;
}

/** Round to the ten significant digits the hardware keeps. */
export function round10(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  if (Math.abs(x) >= MAX_MAGNITUDE || Math.abs(x) < MIN_MAGNITUDE) return x;
  return Number(x.toPrecision(DIGITS));
}

/** Round to the displayed precision, which is what AMORT/depreciation do. */
export function roundToDisplay(x: number, f: DisplayFormat): number {
  if (!Number.isFinite(x)) return x;
  const decimals = f.sci ? 6 : Math.max(0, Math.min(f.fixDigits, 9));
  return round10(Number(x.toFixed(decimals)));
}

/** True when a value is outside the range the 12C can represent. */
export function isOverflow(x: number): boolean {
  return !Number.isFinite(x) || Math.abs(x) > MAX_MAGNITUDE;
}