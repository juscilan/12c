// Calendar functions of the HP-12C: `g DATE`, `g ΔDAYS` and the date formats
// `g M.DY` / `g D.MY`.
//
// Dates are keyed through the display: 4.071984 in month-day-year format means
// the seventh of April 1984, and 7.041984 in day-month-year format means the
// same day.  The 12C covers 15 October 1582 through 25 November 4046.

export interface DateParts {
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  year: number;
}

/** the HP-12C accepts dates only inside this window */
export const MIN_DATE: DateParts = { month: 10, day: 15, year: 1582 };
export const MAX_DATE: DateParts = { month: 11, day: 25, year: 4046 };

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(month: number, year: number): number {
  return month === 2 && isLeap(year) ? 29 : MONTH_DAYS[month - 1];
}

/**
 * Split keyed date digits into their parts using the current format.  `text` is
 * the number as it stands on the display, so `2.292020` still ends in a zero;
 * the year always occupies the last four fraction digits, with the two before it
 * the day in one order or the other.
 */
export function parseDateText(text: string, monthFirst: boolean): DateParts | null {
  const s = text.startsWith('-') ? text.slice(1) : text;
  const dot = s.indexOf('.');
  if (dot < 0) return null;
  const lead = s.slice(0, dot);
  const raw = s.slice(dot + 1);
  // The handbook keys two digits of day followed by four of year, so the
  // fraction always carries six digits; anything shorter is out of range.
  if (raw.length < 6) return null;
  const frac = raw.slice(0, 6);
  const a = Number(lead);
  const b = Number(frac.slice(0, 2));
  const year = Number(frac.slice(2, 6));
  if (!Number.isFinite(year) || year === 0) return null;
  const p = monthFirst
    ? { month: a, day: b, year }
    : { month: b, day: a, year };
  if (p.month < 1 || p.month > 12) return null;
  if (p.day < 1 || p.day > daysInMonth(p.month, p.year)) return null;
  return p;
}

/** Parse a date from a plain number, for callers that hold no keyed digits. */
export function parseDate(value: number, monthFirst: boolean): DateParts | null {
  return parseDateText(Math.abs(value).toString(), monthFirst);
}

/** Pack parts back into the keyed display value for the given format. */
export function dateValue(p: DateParts, monthFirst: boolean): number {
  // the integer part leads and the fraction carries the other field, then the year
  const second = monthFirst ? p.day : p.month;
  const frac = `${String(second).padStart(2, '0')}${String(p.year).padStart(4, '0')}`;
  return Number(`${monthFirst ? p.month : p.day}.${frac}`);
}

export function compare(a: DateParts, b: DateParts): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

export function inRange(p: DateParts): boolean {
  return compare(p, MIN_DATE) >= 0 && compare(p, MAX_DATE) <= 0;
}

/**
 * Julian Day Number for noon, using the standard Gregorian conversion.  The
 * epoch lands on a Monday, which makes JDN mod 7 a direct weekday index.
 */
export function julianDay(p: DateParts): number {
  const a = Math.floor((14 - p.month) / 12);
  const y = p.year + 4800 - a;
  const m = p.month + 12 * a - 3;
  return (
    p.day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

export function fromJulianDay(jdn: number): DateParts {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/** 1 = Monday ... 7 = Sunday, as the 12C reports it */
export function dayOfWeek(p: DateParts): number {
  return (((julianDay(p) % 7) + 7) % 7) + 1;
}

/** Actual days from `from` to `to`; negative when `to` precedes `from`. */
export function daysBetween(from: DateParts, to: DateParts): number {
  return julianDay(to) - julianDay(from);
}

export function addDays(p: DateParts, days: number): DateParts {
  return fromJulianDay(julianDay(p) + days);
}

/**
 * The same interval counted as if every month had 30 days.  `g ΔDAYS` leaves
 * this answer in Y while the actual count appears in X.
 */
export function daysThirtyDay(from: DateParts, to: DateParts): number {
  return (to.year - from.year) * 360 + (to.month - from.month) * 30 + (to.day - from.day);
}

/**
 * Render a date the way `g DATE` does: the components separated by the digit
 * separator, then the weekday digit at the right of the display.
 */
export function formatDateResult(p: DateParts, monthFirst: boolean, sep: string): string {
  const parts = monthFirst
    ? [p.month, p.day, p.year]
    : [p.day, p.month, p.year];
  const body = parts.map((v, i) => (i === 2 ? String(v) : String(v).padStart(2, '0'))).join(sep);
  return `${body} ${dayOfWeek(p)}`;
}

/** The coupon months a bond pays in, given its maturity date. */
export function couponMonths(maturity: DateParts): [number, number] {
  const back = ((maturity.month - 1 + 6) % 12) + 1;
  return [maturity.month, back];
}

/** Most recent coupon date on or before `date`. */
export function lastCouponDate(date: DateParts, maturity: DateParts): DateParts {
  const months = couponMonths(maturity);
  for (let y = date.year; y >= date.year - 2; y--) {
    for (const m of [...months].sort((a, b) => b - a)) {
      const p = { month: m, day: maturity.day, year: y };
      if (compare(p, date) <= 0) return p;
    }
  }
  return { month: maturity.month, day: maturity.day, year: maturity.year - 1 };
}