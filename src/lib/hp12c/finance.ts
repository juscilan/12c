// The non-TVM financial functions of the HP-12C: cash flows, simple interest,
// depreciation and bonds.  Each entry point works the way the printed
// keystrokes do, including which register feeds which operand.

import { round10 } from './format';
import { addDays, daysBetween, lastCouponDate, parseDate } from './dates';
import type { DateParts } from './dates';

/**
 * Net present value on the 12C.  CF0 is the initial investment at time zero and
 * is never discounted; CFn sits n periods out, and n is the count in the n
 * register.
 */
export function npvTwelveC(rate: number, cashflows: readonly number[]): number {
  if (cashflows.length === 0) return 0;
  return round10(cashflows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + rate, i), 0));
}

/**
 * Bisection on NPV = 0.  The 12C brackets the root starting from `guess` and
 * widening until the sign changes, then returns the 10-digit midpoint.
 */
export function irr(cashflows: readonly number[], guess = 0.1): number | null {
  const f = (r: number) => npvTwelveC(r, cashflows);
  let lo = guess;
  let hi = guess;
  let flo = f(lo);
  let fhi = f(hi);
  for (let i = 0; i < 200 && flo > 0 === fhi > 0; i++) {
    lo = lo / 2 - 0.1;
    hi = hi * 2 + 0.1;
    flo = f(lo);
    fhi = f(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  }
  if (flo > 0 === fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm > 0 === flo > 0) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
      fhi = fm;
    }
  }
  return round10((lo + hi) / 2);
}

/**
 * `f INT`: simple interest on the n days in n at the annual rate i (held as a
 * decimal, keyed as a percent) against the principal held negated in PV.  X
 * receives the 360-day result and Y the principal, so `[+]` totals the loan;
 * the 365-day figure is waiting for the next `x-y`.
 */
export function simpleInterest360(principal: number, rate: number, days: number): number {
  return round10((-principal * rate * days) / 360);
}

export function simpleInterest365(principal: number, rate: number, days: number): number {
  return round10((-principal * rate * days) / 365);
}

export type DepreciationMethod = 'SL' | 'SOYD' | 'DB';

/**
 * Depreciation for one year.  PV holds the original cost, FV the salvage
 * value and n the useful life; X receives the depreciation and Y the
 * remaining depreciable value (book value less salvage), as on the 12C.
 * `year` is the year number desired, counted from 1.
 */
export function depreciate(
  method: DepreciationMethod,
  cost: number,
  salvage: number,
  life: number,
  dbFactorPercent: number,
  year: number,
): { depreciation: number; remaining: number } {
  const depreciable = cost - salvage;
  const lifeR = Math.round(life);
  const y = Math.round(year);
  const soydBase = (lifeR * (lifeR + 1)) / 2;
  const rate = dbFactorPercent / 100 / lifeR;

  const charge = (yearNumber: number): number => {
    if (yearNumber < 1 || yearNumber > lifeR) return 0;
    switch (method) {
      case 'SL':
        return depreciable / lifeR;
      case 'SOYD':
        return (depreciable * (lifeR - yearNumber + 1)) / soydBase;
      case 'DB': {
        let book = cost;
        for (let k = 1; k < yearNumber; k++) book -= book * rate;
        return book * rate;
      }
    }
  };

  let charged = 0;
  for (let k = 1; k <= y; k++) charged += charge(k);
  const depreciation = round10(charge(y));
  const remaining = round10(Math.max(0, depreciable - Math.min(charged, depreciable)));
  return { depreciation, remaining };
}

/** Book value charged off through year `y`, never past the salvage value. */
function accumulated(
  method: DepreciationMethod,
  cost: number,
  salvage: number,
  life: number,
  dbFactorPercent: number,
  y: number,
): number {
  const depreciable = cost - salvage;
  const lifeR = Math.round(life);
  let total = 0;
  if (method === 'SL') {
    total = (depreciable / lifeR) * y;
  } else if (method === 'SOYD') {
    const base = (lifeR * (lifeR + 1)) / 2;
    let remainingNumerator = 0;
    for (let k = 0; k < y; k++) remainingNumerator += lifeR - k;
    total = (depreciable * remainingNumerator) / base;
  } else {
    const rate = dbFactorPercent / 100 / lifeR;
    let book = cost;
    for (let k = 0; k < y; k++) {
      const charge = k < lifeR ? book * rate : 0;
      book -= charge;
      total += charge;
    }
  }
  return Math.min(total, depreciable);
}

/** semi-annual coupon period length used by the bond routines */
const SEMI_ANNUAL_DAYS = 182.25;

/**
 * Bond price from a yield.  Coupons are paid semi-annually on the maturity
 * month and six months before it, and both the discount exponent and the
 * accrued interest run off 182.25-day periods.
 */
export function bondPrice(
  settlement: DateParts,
  maturity: DateParts,
  couponPercent: number,
  yieldPercent: number,
  redemptionPercent: number,
): { price: number; total: number } {
  const coupon = couponPercent / 2;
  const d = yieldPercent / 2 / 100;
  const periods = daysBetween(settlement, maturity) / SEMI_ANNUAL_DAYS;
  const growth = Math.pow(1 + d, -periods);
  const price = round10((d === 0 ? periods * coupon : (coupon * (1 - growth)) / d) + redemptionPercent * growth);
  const couponDate = lastCouponDate(settlement, maturity);
  const accrued = round10((coupon * daysBetween(couponDate, settlement)) / SEMI_ANNUAL_DAYS);
  return { price, total: round10(price + accrued) };
}

/** Bond yield to maturity, solved from the quoted clean price. */
export function bondYtm(
  settlement: DateParts,
  maturity: DateParts,
  couponPercent: number,
  pricePercent: number,
  redemptionPercent: number,
  guess = 4,
): number | null {
  const f = (y: number) =>
    bondPrice(settlement, maturity, couponPercent, y, redemptionPercent).price - pricePercent;
  let lo = guess;
  let hi = guess;
  let flo = f(lo);
  let fhi = f(hi);
  for (let i = 0; i < 200 && !(flo > 0 !== fhi > 0); i++) {
    lo = lo / 2 - 0.5;
    hi = hi * 2 + 0.5;
    flo = f(lo);
    fhi = f(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  }
  if (flo > 0 === fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm > 0 === flo > 0) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
      fhi = fm;
    }
  }
  return round10((lo + hi) / 2);
}

/** Convenience wrapper taking keyed display dates. */
export function bondPriceFromValues(
  settlement: number,
  maturity: number,
  monthFirst: boolean,
  couponPercent: number,
  yieldPercent: number,
  redemptionPercent: number,
) {
  const s = parseDate(settlement, monthFirst);
  const m = parseDate(maturity, monthFirst);
  if (!s || !m) return null;
  return bondPrice(s, m, couponPercent, yieldPercent, redemptionPercent);
}

/** `g ΔDAYS` and `g DATE` share the keyed-date parsing above. */
export { addDays, daysBetween };