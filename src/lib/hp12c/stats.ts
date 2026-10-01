// Σ register arithmetic of the HP-12C.
//
// The six accumulators are held in R1 through R6: n count, Σx, Σx², Σy, Σy²,
// Σxy.  Because the HP-12C can pair either value first, the registers are
// stored under two names that the engine keeps in sync.

import { round10 } from './format';

export interface Sums {
  /** R1: how many observations */
  n: number;
  /** R2: Σx */
  sumX: number;
  /** R3: Σx² */
  sumX2: number;
  /** R4: Σy */
  sumY: number;
  /** R5: Σy² */
  sumY2: number;
  /** R6: Σxy */
  sumXY: number;
}

export const EMPTY_SUMS: Sums = { n: 0, sumX: 0, sumX2: 0, sumY: 0, sumY2: 0, sumXY: 0 };

/** `Σ+`: X contributes the first value and Y the second. */
export function accumulate(s: Sums, x: number, y: number): Sums {
  return {
    n: s.n + 1,
    sumX: round10(s.sumX + x),
    sumX2: round10(s.sumX2 + x * x),
    sumY: round10(s.sumY + y),
    sumY2: round10(s.sumY2 + y * y),
    sumXY: round10(s.sumXY + x * y),
  };
}

/** `g Σ−`: remove the observation X, Y.  Extra or missing data is ignored. */
export function remove(s: Sums, x: number, y: number): Sums {
  if (s.n < 1) return s;
  return {
    n: s.n - 1,
    sumX: round10(s.sumX - x),
    sumX2: round10(s.sumX2 - x * x),
    sumY: round10(s.sumY - y),
    sumY2: round10(s.sumY2 - y * y),
    sumXY: round10(s.sumXY - x * y),
  };
}

/** `g 0`: the arithmetic mean of the first value. */
export function meanX(s: Sums): number | null {
  return s.n > 0 ? round10(s.sumX / s.n) : null;
}

export function meanY(s: Sums): number | null {
  return s.n > 0 ? round10(s.sumY / s.n) : null;
}

/** `g .`: sample standard deviation of the first value; `x≷y` reveals the second. */
export function stdDevX(s: Sums): number | null {
  if (s.n < 2) return null;
  const variance = (s.sumX2 - (s.sumX * s.sumX) / s.n) / (s.n - 1);
  return round10(Math.sqrt(Math.max(0, variance)));
}

export function stdDevY(s: Sums): number | null {
  if (s.n < 2) return null;
  const variance = (s.sumY2 - (s.sumY * s.sumY) / s.n) / (s.n - 1);
  return round10(Math.sqrt(Math.max(0, variance)));
}

/**
 * `g x̄,w`: the weighted mean of the first value, where the second value holds
 * the weight of each item ("item weight [+]" is the entry order).  Only the mean
 * is displayed, in X.
 */
export function weightedMean(s: Sums): number | null {
  if (s.n < 1 || s.sumY === 0) return null;
  return round10(s.sumXY / s.sumY);
}

/**
 * The least-squares line through the accumulated pairs, `y = intercept + slope*x`.
 * X is the first value and Y the second.
 */
export function linearRegression(s: Sums): { slope: number; intercept: number } | null {
  if (s.n < 2) return null;
  const denominator = s.n * s.sumX2 - s.sumX * s.sumX;
  if (denominator === 0) return null;
  const slope = (s.n * s.sumXY - s.sumX * s.sumY) / denominator;
  const intercept = (s.sumY - slope * s.sumX) / s.n;
  return { slope: round10(slope), intercept: round10(intercept) };
}

/** `g ŷ,r`: the y-value estimated for the x-value in X. */
export function estimateYhat(s: Sums, x: number): number | null {
  const line = linearRegression(s);
  if (!line) return null;
  return round10(line.intercept + line.slope * x);
}

/** `g x̂,r`: the x-value estimated for the y-value in X. */
export function estimateXhat(s: Sums, y: number): number | null {
  const line = linearRegression(s);
  if (!line || line.slope === 0) return null;
  return round10((y - line.intercept) / line.slope);
}

/** The correlation coefficient, reached through Σr or a stored program. */
export function correlation(s: Sums): number | null {
  if (s.n < 2) return null;
  const denominator = Math.sqrt(
    (s.n * s.sumX2 - s.sumX * s.sumX) * (s.n * s.sumY2 - s.sumY * s.sumY),
  );
  if (denominator === 0) return null;
  return round10((s.n * s.sumXY - s.sumX * s.sumY) / denominator);
}

/** `g 3`: factorial, needed by several of the Σ programs. */
export function factorial(n: number): number | null {
  if (!Number.isInteger(n) || n < 0 || n > 69) return null;
  let result = 1;
  for (let k = 2; k <= n; k++) result *= k;
  return result;
}