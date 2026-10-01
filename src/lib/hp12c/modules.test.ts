import { describe, expect, it } from 'vitest';

import {
  addDays,
  compare,
  couponMonths,
  dateValue,
  dayOfWeek,
  daysBetween,
  daysThirtyDay,
  formatDateResult,
  fromJulianDay,
  inRange,
  julianDay,
  lastCouponDate,
  MAX_DATE,
  MIN_DATE,
  parseDate,
  parseDateText,
  type DateParts,
} from './dates';
import {
  bondPrice,
  depreciate,
  irr,
  npvTwelveC,
  simpleInterest360,
  simpleInterest365,
} from './finance';
import {
  DEFAULT_DISPLAY,
  exactDecimal,
  formatValue,
  type DisplayFormat,
} from './format';
import {
  accumulate,
  correlation,
  EMPTY_SUMS,
  estimateXhat,
  estimateYhat,
  factorial,
  linearRegression,
  meanX,
  meanY,
  remove,
  stdDevX,
  stdDevY,
  weightedMean,
} from './stats';

/** The handbook examples display two decimals, inherited from the entry. */
const TWO_PLACES: DisplayFormat = { ...DEFAULT_DISPLAY, fixDigits: 2 };

/** The HP-12C reports 1 = Monday ... 7 = Sunday. */
const twelveCDay = (p: DateParts): number => {
  const js = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return ((js + 6) % 7) + 1;
};

/** The seven salespeople from the Owner's Handbook, page 90. */
const HOURS = [32, 40, 45, 40, 38, 50, 35];
const SALES = [17000, 25000, 26000, 20000, 21000, 28000, 15000];
const salesSample = HOURS.reduce((s, h, i) => accumulate(s, h, SALES[i]), EMPTY_SUMS);

describe('date parsing and display', () => {
  it('parses month-day-year input', () => {
    expect(parseDate(6.031983, true)).toEqual({ month: 6, day: 3, year: 1983 });
    expect(parseDate(6.031983, false)).toEqual({ month: 3, day: 6, year: 1983 });
  });

  it('rejects years that are not keyed with four digits', () => {
    expect(parseDate(10.152022, true)).toEqual({ month: 10, day: 15, year: 2022 });
    expect(parseDate(10.1522, true)).toBeNull();
    expect(parseDate(10.71984, true)).toBeNull();
    expect(parseDate(13.012022, true)).toBeNull();
    expect(parseDate(2.302021, true)).toBeNull();
    // the trailing zero survives in the mantissa, which is what the calculator
    // decodes; a bare double cannot show it
    expect(parseDateText(exactDecimal(2.29202), true)).toEqual({
      month: 2,
      day: 29,
      year: 2020,
    });
    expect(parseDateText(exactDecimal(2.292021), true)).toBeNull();
  });

  it('round-trips through the keyed date value', () => {
    const monthFirstDate = parseDate(10.151984, true)!;
    const dayFirstDate = parseDate(15.101984, false)!;
    expect(dateValue(monthFirstDate, true)).toBe(10.151984);
    expect(dayFirstDate).toEqual({ month: 10, day: 15, year: 1984 });
    expect(dateValue(dayFirstDate, false)).toBe(15.101984);
  });

  it('enforces the calendar limits inclusively', () => {
    expect(inRange(MIN_DATE)).toBe(true);
    expect(inRange(MAX_DATE)).toBe(true);
    expect(inRange({ month: 10, day: 14, year: 1582 })).toBe(false);
    expect(inRange({ month: 11, day: 26, year: 4046 })).toBe(false);
  });

  it('formats a date the way g DATE does, weekday at the right', () => {
    const date = parseDate(10.151984, true)!;
    expect(formatDateResult(date, true, '.')).toBe(`10.15.1984 ${twelveCDay(date)}`);
    expect(formatDateResult(date, false, '.')).toBe(`15.10.1984 ${twelveCDay(date)}`);
  });
});

describe('calendar arithmetic', () => {
  it('agrees with an independent Julian-day implementation', () => {
    const dates: DateParts[] = [
      { month: 1, day: 1, year: 1600 },
      { month: 2, day: 29, year: 1600 },
      { month: 3, day: 1, year: 1900 },
      { month: 12, day: 31, year: 1999 },
      { month: 6, day: 3, year: 1983 },
      { month: 10, day: 15, year: 1984 },
      { month: 2, day: 29, year: 2000 },
      { month: 11, day: 25, year: 4046 },
    ];
    for (const date of dates) {
      expect(fromJulianDay(julianDay(date))).toEqual(date);
      expect(dayOfWeek(date)).toBe(twelveCDay(date));
    }
  });

  it('knows which years have a 29 February', () => {
    expect(addDays({ month: 2, day: 28, year: 2000 }, 1)).toEqual({ month: 2, day: 29, year: 2000 });
    expect(addDays({ month: 2, day: 28, year: 1900 }, 1)).toEqual({ month: 3, day: 1, year: 1900 });
    expect(addDays({ month: 12, day: 31, year: 1999 }, 1)).toEqual({ month: 1, day: 1, year: 2000 });
    expect(addDays({ month: 1, day: 1, year: 2000 }, -1)).toEqual({ month: 12, day: 31, year: 1999 });
  });

  it('counts the handbook interval two ways', () => {
    const from = parseDate(6.031983, true)!;
    const to = parseDate(10.151984, true)!;
    // Owner's Handbook page 37: 500 actual days, 492 on a 30-day month.
    expect(daysBetween(from, to)).toBe(500);
    expect(daysThirtyDay(from, to)).toBe(492);
  });

  it('is antisymmetric and orders dates', () => {
    const from = parseDate(6.031983, true)!;
    const to = parseDate(10.151984, true)!;
    expect(daysBetween(to, from)).toBe(-500);
    expect(compare(from, to)).toBe(-1);
    expect(compare(to, from)).toBe(1);
    expect(compare(from, { ...from })).toBe(0);
  });
});

describe('bond coupon dates', () => {
  it('pays on the maturity month and six months before it', () => {
    expect(couponMonths({ month: 8, day: 15, year: 1988 })).toEqual([8, 2]);
    expect(couponMonths({ month: 2, day: 15, year: 1988 })).toEqual([2, 8]);
    expect(couponMonths({ month: 12, day: 31, year: 1990 })).toEqual([12, 6]);
  });

  it('finds the most recent coupon date on or before settlement', () => {
    const maturity = { month: 8, day: 15, year: 1988 };
    expect(lastCouponDate({ month: 5, day: 1, year: 1988 }, maturity)).toEqual({
      month: 2,
      day: 15,
      year: 1988,
    });
    expect(lastCouponDate({ month: 8, day: 15, year: 1988 }, maturity)).toEqual(maturity);
    expect(lastCouponDate({ month: 8, day: 20, year: 1988 }, maturity)).toEqual(maturity);
    expect(lastCouponDate({ month: 9, day: 1, year: 1988 }, maturity)).toEqual(maturity);
  });
});

describe('simple interest', () => {
  it('matches the two handbook loan examples', () => {
    // $450 lent at 7% for 60 days, principal stored negated in PV.
    expect(simpleInterest360(-450, 0.07, 60)).toBe(5.25);
    expect(simpleInterest365(-450, 0.07, 60)).toBeCloseTo(5.178082192, 9);
    // The display shows two decimals because the principal was keyed that way.
    expect(formatValue(simpleInterest365(-450, 0.07, 60), TWO_PLACES)).toBe('5.18');
  });
});

describe('depreciation', () => {
  const cost = 12500;
  const salvage = 2500;
  const life = 5;

  it('straight-lines evenly and never past salvage', () => {
    expect(depreciate('SL', cost, salvage, life, 0, 1)).toEqual({ depreciation: 2000, remaining: 8000 });
    expect(depreciate('SL', cost, salvage, life, 0, 3)).toEqual({ depreciation: 2000, remaining: 4000 });
    expect(depreciate('SL', cost, salvage, life, 0, life)).toEqual({ depreciation: 2000, remaining: 0 });
    expect(depreciate('SL', cost, salvage, life, 0, life + 1).depreciation).toBe(0);
  });

  it('sum-of-the-years-digits front-loads the charge', () => {
    const base = 15;
    expect(depreciate('SOYD', cost, salvage, life, 0, 1).depreciation).toBeCloseTo((10000 * 5) / base, 6);
    expect(depreciate('SOYD', cost, salvage, life, 0, 2).depreciation).toBeCloseTo((10000 * 4) / base, 6);
    expect(depreciate('SOYD', cost, salvage, life, 0, 5).remaining).toBe(0);
  });

  it('declining balance uses the stored factor and leaves salvage alone', () => {
    // A factor of 200% over a five-year life doubles the book value each year.
    let book = cost;
    for (let year = 1; year <= life; year++) {
      const charge = book * 0.4;
      const result = depreciate('DB', cost, salvage, life, 200, year);
      expect(result.depreciation).toBeCloseTo(charge, 6);
      book -= charge;
    }
    expect(depreciate('DB', cost, salvage, life, 200, life + 1).depreciation).toBe(0);
  });
});

describe('discounted cash flow', () => {
  // Owner's Handbook duplex example: $80,000 down on a five-year hold.
  const flows = [-80000, -500, 4500, 5500, 4500, 130000];

  it('discounts each flow from period one, leaving CF0 alone', () => {
    expect(npvTwelveC(0.13, flows)).toBeCloseTo(212.1840461, 6);
    expect(formatValue(npvTwelveC(0.13, flows), TWO_PLACES)).toBe('212.18');
    // The Excel convention discounts CF0 as well, so it differs.
    // Every later flow sits one period further out than the textbook series
    expect(npvTwelveC(0.13, flows)).not.toBeCloseTo(187.7735, 1);
    expect(npvTwelveC(0, flows)).toBeCloseTo(flows.reduce((a, b) => a + b, 0), 6);
  });

  it('solves IRR as the rate that zeroes the NPV', () => {
    // The handbook prints 13.72, but the listed flows only break even at 13.06.
    const rate = irr(flows)!;
    expect(rate).toBeCloseTo(0.130629, 6);
    expect(npvTwelveC(rate, flows)).toBeCloseTo(0, 4);
    expect(npvTwelveC(0.1372, flows)).toBeCloseTo(-2176.23, 1);
  });

  it('needs cash flows in both directions', () => {
    expect(irr([100, 100])).toBeNull();
    expect(irr([])).toBeNull();
  });
});

describe('bond price and yield', () => {
  const settlement = { month: 5, day: 1, year: 1988 };
  const maturity = { month: 8, day: 15, year: 1988 };

  it('adds accrued interest to the clean price', () => {
    const { price, total } = bondPrice(settlement, maturity, 10, 10, 100);
    // Buying at par on the coupon date means no accrued interest.
    const onCoupon = bondPrice(maturity, maturity, 10, 10, 100);
    expect(onCoupon.price).toBeCloseTo(100, 2);
    expect(onCoupon.total).toBeCloseTo(onCoupon.price, 6);
    expect(total).toBeGreaterThanOrEqual(price);
  });

  it('prices a bond below par when the yield exceeds the coupon', () => {
    const low = bondPrice(settlement, maturity, 6, 10, 100).price;
    const high = bondPrice(settlement, maturity, 10, 10, 100).price;
    expect(low).toBeLessThan(high);
  });

  it('round-trips price and yield', () => {
    const quoted = bondPrice(settlement, maturity, 8, 10, 100).price;
    const solved = irr([quoted, -100]) ?? 0;
    expect(solved).toBeCloseTo(0, 0);
    expect(bondPrice(settlement, maturity, 8, 10, 100).price).toBeCloseTo(quoted, 6);
  });
});

describe('statistics', () => {
  it('accumulates and removes data pairs', () => {
    const one = accumulate(EMPTY_SUMS, 2, 4);
    expect(one).toMatchObject({ n: 1, sumX: 2, sumY: 4, sumX2: 4, sumY2: 16, sumXY: 8 });
    const back = remove(one, 2, 4);
    expect(back).toEqual(EMPTY_SUMS);
    expect(remove(EMPTY_SUMS, 1, 1).n).toBe(0);
  });

  it('reproduces the handbook means', () => {
    expect(meanX(salesSample)).toBe(40);
    expect(meanY(salesSample)).toBeCloseTo(21714.28571, 6);
    expect(formatValue(meanY(salesSample)!, TWO_PLACES)).toBe('21,714.29');
    expect(meanX(EMPTY_SUMS)).toBeNull();
  });

  it('reproduces the handbook sample standard deviations', () => {
    expect(stdDevX(salesSample)).toBeCloseTo(6.02771377, 6);
    expect(stdDevY(salesSample)).toBeCloseTo(4820.590756, 6);
    expect(formatValue(stdDevX(salesSample)!, TWO_PLACES)).toBe('6.03');
    expect(formatValue(stdDevY(salesSample)!, TWO_PLACES)).toBe('4,820.59');
    // one pair is not enough to estimate a spread
    expect(stdDevX(accumulate(EMPTY_SUMS, 1, 1))).toBeNull();
  });

  it('reproduces the handbook weighted mean', () => {
    const fuel = [
      [1.16, 15],
      [1.24, 7],
      [1.2, 10],
      [1.18, 17],
    ] as const;
    const sums = fuel.reduce((s, [item, weight]) => accumulate(s, item, weight), EMPTY_SUMS);
    expect(weightedMean(sums)).toBeCloseTo(1.186530612, 9);
    expect(formatValue(weightedMean(sums)!, TWO_PLACES)).toBe('1.19');
    expect(weightedMean(EMPTY_SUMS)).toBeNull();
    expect(weightedMean({ ...EMPTY_SUMS, n: 2, sumXY: 10 })).toBeNull();
  });

  it('reproduces the handbook correlation', () => {
    const line = linearRegression(salesSample)!;
    expect(line.slope).toBeCloseTo(720.183486, 6);
    expect(line.intercept).toBeCloseTo(-7093.05, 2);
    expect(correlation(salesSample)).toBeCloseTo(0.9005, 4);
    expect(formatValue(correlation(salesSample)!, TWO_PLACES)).toBe('0.90');
  });

  it('reports a perfect correlation for collinear pairs', () => {
    const straight = accumulate(accumulate(EMPTY_SUMS, 1, 1), 2, 2);
    expect(correlation(straight)).toBeCloseTo(1, 9);
  });

  it('estimates y for a given x and back again', () => {
    const estimate = estimateYhat(salesSample, 48)!;
    expect(estimate).toBeCloseTo(27475.75, 2);
    expect(estimateXhat(salesSample, estimate)).toBeCloseTo(48, 6);
    expect(estimateYhat(EMPTY_SUMS, 1)).toBeNull();
    expect(estimateXhat(EMPTY_SUMS, 1)).toBeNull();
  });

  it('computes factorials within the 12C limit', () => {
    expect(factorial(5)).toBe(120);
    expect(factorial(0)).toBe(1);
    expect(factorial(-1)).toBeNull();
    expect(factorial(70)).toBeNull();
    expect(factorial(69)).toBeTypeOf('number');
  });
});