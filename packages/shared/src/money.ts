/**
 * Money is represented as an integer count of the smallest currency unit
 * (e.g. 分 for CNY, cents for USD). NEVER use floating point to store or
 * accumulate money — all arithmetic in this codebase is integer-minor.
 */

export type Minor = number;

/** Number of fractional digits for a currency. Most currencies use 2. */
export function fractionDigitsFor(currency: string): number {
  // Zero-decimal currencies (subset). Extend as needed.
  const zeroDecimal = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);
  return zeroDecimal.has(currency.toUpperCase()) ? 0 : 2;
}

export function assertInteger(n: number, label = "value"): void {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${label} must be an integer minor amount, got ${n}`);
  }
}

/** Convert a major-unit amount (e.g. 12.34 元) to minor units (1234 分). */
export function toMinor(major: number, fractionDigits = 2): Minor {
  if (!Number.isFinite(major)) throw new Error(`invalid amount: ${major}`);
  const factor = 10 ** fractionDigits;
  // Round to avoid binary float drift (e.g. 12.34 * 100 === 1233.9999...).
  return Math.round(major * factor);
}

/** Convert minor units back to a major-unit number for display. */
export function toMajor(minor: Minor, fractionDigits = 2): number {
  assertInteger(minor, "minor");
  return minor / 10 ** fractionDigits;
}

export function sumMinor(values: Iterable<Minor>): Minor {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Format minor units as a localized currency string (display only). */
export function formatMoney(
  minor: Minor,
  currency = "CNY",
  locale = "zh-CN",
): string {
  const digits = fractionDigitsFor(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toMajor(minor, digits));
}
