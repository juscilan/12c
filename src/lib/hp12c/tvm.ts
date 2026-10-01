// Time value of money for the HP-12C.
//
// The five financial registers n, i, PV, PMT and FV are related by a single
// equation.  With `beg` true (BEGIN mode, `g BEG`) every payment happens at
// the start of the period rather than the end:
//
//   FV = PV (1+i)^n + PMT (1+i)^[beg] ((1+i)^n - 1) / i
//
// Four registers are known and the fifth is solved.  Solving for n is done
// iteratively, which is what Roy Martin's "simple method" on the real 12C
// amounts to; the result is then rounded to a whole number of periods.

import { round10 } from './format';

export type FinKey = 'n' | 'i' | 'PV' | 'PMT' | 'FV';
export const FIN_KEYS: FinKey[] = ['n', 'i', 'PV', 'PMT', 'FV'];

export interface Tvm {
  n: number;
  i: number;
  PV: number;
  PMT: number;
  FV: number;
  /** BEGIN mode: payments land at the start of the period */
  beg: boolean;
}

/** Total payments in an ordinary annuity, the (1+i)^n - 1 over i part. */
function annuityFactor(i: number, n: number): number {
  if (i === 0) return n;
  return (Math.pow(1 + i, n) - 1) / i;
}

/**
 * The 12C holds one zero-sum equation across the five financial registers:
 *
 *   PV (1+i)^n  +  PMT [BEGIN] (1+i) a(n,i)  +  FV  =  0
 *
 * so a loan received (PV positive) leaves an FV that is money still owed and
 * therefore negative, while money deposited (PV negative) grows positive.
 */
function fvOfN(v: Tvm, n: number): number {
  const shift = v.beg ? 1 + v.i : 1;
  return -(v.PV * Math.pow(1 + v.i, n) + v.PMT * shift * annuityFactor(v.i, n));
}

/** PV as a function of i, the closed form inversion of the equation above. */
function pvOfI(v: Tvm, i: number): number {
  const shift = v.beg ? 1 + i : 1;
  return -(v.FV + v.PMT * shift * annuityFactor(i, v.n)) / Math.pow(1 + i, v.n);
}

/**
 * Solve for the periodic rate.  The residual is the financial equation itself,
 * which is monotone in i for the annuities that arise in practice, so a
 * bracketed bisection is both safe and fast.
 */
function solveI(v: Tvm): number {
  const f = (i: number) =>
    v.PV * Math.pow(1 + i, v.n) + v.PMT * (v.beg ? 1 + i : 1) * annuityFactor(i, v.n) + v.FV;
  let a = -0.9999;
  let b = 1;
  let fa = f(a);
  if (fa === 0) return a;
  let fb = f(b);
  let guard = 0;
  while (fa * fb > 0 && guard++ < 300) {
    b = b * 2 + 1;
    fb = f(b);
  }
  // failing that, widen towards a -100% rate
  guard = 0;
  while (fa * fb > 0 && guard++ < 300) {
    a = (a - 1) / 2;
    fa = f(a);
  }
  if (fa * fb > 0 || !Number.isFinite(fa * fb)) return NaN;

  for (let k = 0; k < 200; k++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (fa * fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
    if (b - a < 1e-14 * Math.max(1, Math.abs(mid))) break;
  }
  return (a + b) / 2;
}

/**
 * Solve for n.  The handbook is explicit that the calculated value is "rounded
 * up to the next higher integer", so a loan needing 327.4 payments is stored
 * as 328 - which is why 12C n disagrees with a spreadsheet on balloon payments.
 */
function solveN(v: Tvm): number {
  const f = (n: number) => fvOfN(v, n) - v.FV;
  let a = 0;
  let b = 1;
  let fa = f(a);
  if (fa === 0) return 0;
  let fb = f(b);
  let guard = 0;
  while (fa * fb > 0 && guard++ < 300) {
    b *= 2;
    fb = f(b);
  }
  // n is negative when the present value falls after the payments
  guard = 0;
  while (fa * fb > 0 && guard++ < 300) {
    a = a / 2 - 1;
    fa = f(a);
  }
  if (fa * fb > 0 || !Number.isFinite(fa * fb)) return NaN;

  for (let k = 0; k < 200; k++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (fa * fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
    if (b - a < 1e-12 * Math.max(1, Math.abs(mid))) break;
  }
  // "the calculator rounds the answer up to the next higher integer ... will
  // round n down to the next lower integer if the fractional portion of n is
  // less than 0.005" - HP-12C handbook, "Calculating the Number of Payments"
  const raw = (a + b) / 2;
  return raw - Math.floor(raw) < 0.005 ? Math.floor(raw) : Math.ceil(raw);
}

/**
 * Solve for the register named by `unknown`, using the zero-sum relation
 * documented above.
 */
export function solveTvm(v: Tvm & { beg: boolean }, unknown: FinKey): number {
  switch (unknown) {
    case 'FV':
      return round10(fvOfN(v, v.n));
    case 'PV':
      return round10(pvOfI(v, v.i));
    case 'PMT': {
      const factor = annuityFactor(v.i, v.n);
      if (factor === 0) return round10(0);
      return round10(-(v.FV + v.PV * Math.pow(1 + v.i, v.n)) / factor);
    }
    case 'i':
      return round10(solveI(v));
    case 'n':
      return round10(solveN(v));
  }
}

/** Total interest and total principal for a run of payments. */
export interface AmortResult {
  interest: number;
  principal: number;
  balance: number;
  count: number;
}

/**
 * Amortization over `count` payments, starting from `v.n` payments already
 * amortized.  Interest accrues first each period and every amount is rounded at
 * the display precision, which is the behaviour the HP-12C handbook calls out
 * ("the amounts calculated ... are automatically rounded to the number of
 * decimal places specified by the display format").
 *
 * Following the cash flow sign convention, interest and principal come back
 * negative for a loan being repaid, matching the handbook's worked example of
 * a $50,000 mortgage: -6,608.89 interest and -271.31 principal over year one.
 */
export function amortize(
  v: Tvm & { beg: boolean },
  count: number,
  round: (x: number) => number,
): AmortResult {
  const shift = v.beg ? 1 + v.i : 1;
  const payment = v.PMT * shift;
  const periods = Math.round(count);
  let balance = v.PV;
  let elapsed = v.n;
  let interest = 0;
  let principal = 0;

  for (let k = 0; k < periods; k++) {
    const accrued = round(-balance * v.i * shift);
    const next = round(balance + payment - accrued);
    const prin = round(next - balance);
    interest = round(interest + accrued);
    principal = round(principal + prin);
    balance = next;
    elapsed = round(elapsed + 1);
  }
  return { interest, principal, balance, count: elapsed };
}