import { describe, expect, it } from 'vitest';
import { solveTvm, amortize } from './tvm';
import { roundToDisplay, DEFAULT_DISPLAY, round10 } from './format';

const end = false;
const r = (x: number) => roundToDisplay(x, DEFAULT_DISPLAY);

/**
 * Expectations are quoted from the HP-12C Owner's Handbook and User's Guide so
 * the solver is checked against the machine rather than against itself.
 */
describe('TVM solver', () => {
  it('solves PMT for the handbook 25-year mortgage', () => {
    const pmt = solveTvm({ n: 300, i: 0.1325 / 12, PV: 50000, PMT: 0, FV: 0, beg: end }, 'PMT');
    expect(pmt).toBeCloseTo(-573.35, 2);
  });

  it('solves PMT for the handbook 30-year mortgage', () => {
    const pmt = solveTvm({ n: 360, i: 0.1325 / 12, PV: 50000, PMT: 0, FV: 0, beg: end }, 'PMT');
    expect(pmt).toBeCloseTo(-562.89, 2);
  });

  it('solves n back out', () => {
    const n = solveTvm({ n: 0, i: 0.1325 / 12, PV: 50000, PMT: -573.35, FV: 0, beg: end }, 'n');
    expect(n).toBe(300);
  });

  it('grows a deposit into a positive FV', () => {
    // savings plan: $10,000 paid out today at 10% a year for 5 years
    const fv = solveTvm({ n: 5, i: 0.1, PV: -10000, PMT: 0, FV: 0, beg: end }, 'FV');
    expect(fv).toBeCloseTo(16105.1, 6);
  });

  it('leaves an unpaid loan balance as a negative FV', () => {
    // $25,000 received, nothing paid for two years at 12%
    const fv = solveTvm({ n: 2, i: 0.12, PV: 25000, PMT: 0, FV: 0, beg: end }, 'FV');
    expect(fv).toBeCloseTo(-31360, 2);
  });

  it('matches the handbook cabin loan example', () => {
    // $35,000 at 10.5% a year paid $325 a month (handbook page 46)
    const v = { i: 0.105 / 12, PV: 35000, PMT: -325, FV: 0, beg: end };
    expect(solveTvm({ ...v, n: 0 }, 'n')).toBe(328);
    // overpayment if all 328 full payments are made
    expect(solveTvm({ ...v, n: 328 }, 'FV')).toBeCloseTo(181.89, 2);
    // balance still owed after only 327 of them
    expect(solveTvm({ ...v, n: 327 }, 'FV')).toBeCloseTo(-141.87, 2);
  });

  it('rounds n down when the fraction is below 0.005', () => {
    // the 25-year mortgage's own payment puts the answer a hair above 300
    const pmt = solveTvm({ n: 300, i: 0.1325 / 12, PV: 50000, PMT: 0, FV: 0, beg: end }, 'PMT');
    expect(solveTvm({ n: 0, i: 0.1325 / 12, PV: 50000, PMT: pmt, FV: 0, beg: end }, 'n')).toBe(300);
  });

  it('rounds n up to the next whole payment', () => {
    // 20,000 at 15% for 9 months: the exact answer is well short of 10
    const n = solveTvm({ n: 0, i: 0.015, PV: 20000, PMT: -2345.24, FV: 0, beg: end }, 'n');
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBe(10);
  });

  it('recovers the periodic rate from a payment', () => {
    const i = solveTvm({ n: 360, i: 0, PV: 50000, PMT: -562.89, FV: 0, beg: end }, 'i');
    expect(round10(i * 12)).toBeCloseTo(0.1325, 4);
  });

  it('shifts an annuity due by one period', () => {
    const base = { n: 10, i: 0.1, PV: 0, PMT: -100, FV: 0 };
    expect(solveTvm({ ...base, beg: true }, 'FV')).toBeCloseTo(1753.1167, 4);
    expect(solveTvm({ ...base, beg: false }, 'FV')).toBeCloseTo(1593.7424601, 6);
  });

  it('handles a single beginning-of-period payment', () => {
    expect(solveTvm({ n: 1, i: 0.1, PV: 0, PMT: -100, FV: 0, beg: true }, 'FV')).toBeCloseTo(110, 9);
    expect(solveTvm({ n: 1, i: 0.1, PV: 0, PMT: -100, FV: 0, beg: end }, 'FV')).toBeCloseTo(100, 9);
  });

  it('handles zero interest and zero periods', () => {
    // n = 0 means no payment is ever made, so FV simply offsets PV
    expect(solveTvm({ n: 0, i: 0.05, PV: 100, PMT: -10, FV: 0, beg: end }, 'FV')).toBe(-100);
    expect(solveTvm({ n: 12, i: 0, PV: 100, PMT: -10, FV: 0, beg: end }, 'FV')).toBe(20);
  });

  it('supports odd period n', () => {
    // 8% a year compounded monthly, money left for 3.5 years
    const fv = solveTvm({ n: 42, i: 0.08 / 12, PV: -1000, PMT: 0, FV: 0, beg: end }, 'FV');
    expect(fv).toBeCloseTo(1321.900923, 6);
  });
});

describe('amortization', () => {
  const loan = { n: 0, i: 0.1325 / 12, PV: 50000, PMT: -573.35, FV: 0, beg: end };

  it('matches the handbook first year', () => {
    const a = amortize(loan, 12, r);
    expect(a.interest).toBeCloseTo(-6608.89, 2);
    expect(a.principal).toBeCloseTo(-271.31, 2);
    expect(a.balance).toBeCloseTo(49728.69, 2);
    expect(a.count).toBe(12);
  });

  it('matches the handbook second year, resuming from the updated balance', () => {
    // the 12C leaves PV holding the balance remaining after year one
    const a = amortize({ ...loan, n: 12, PV: 49728.69 }, 12, r);
    expect(a.interest).toBeCloseTo(-6570.72, 2);
    expect(a.principal).toBeCloseTo(-309.48, 2);
    expect(a.balance).toBeCloseTo(49419.21, 2);
  });

  it('matches the handbook single month example', () => {
    const a = amortize(loan, 1, r);
    expect(a.interest).toBeCloseTo(-552.08, 2);
    expect(a.principal).toBeCloseTo(-21.27, 2);
    const b = amortize({ ...loan, n: 1, PV: 49978.73 }, 1, r);
    expect(b.interest).toBeCloseTo(-551.85, 2);
    expect(b.principal).toBeCloseTo(-21.5, 2);
  });

  it('pays a 30 year mortgage down to (nearly) zero', () => {
    const pmt = solveTvm({ n: 360, i: loan.i, PV: 50000, PMT: 0, FV: 0, beg: end }, 'PMT');
    const a = amortize({ ...loan, PMT: pmt }, 360, r);
    // cent level rounding on every one of 360 periods accumulates a residual
    expect(Math.abs(a.balance)).toBeLessThan(Math.abs(pmt));
  });

  it('produces a balloon when the payment cannot cover the interest', () => {
    // $10,000 borrowed but only $100 a month against 24% a year
    const a = amortize({ n: 0, i: 0.24 / 12, PV: 10000, PMT: -100, FV: 0, beg: end }, 12, r);
    expect(a.interest).toBeLessThan(0);
    expect(a.principal).toBeGreaterThan(0);
    expect(a.balance).toBeGreaterThan(10000);
  });
});