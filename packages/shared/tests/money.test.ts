import { describe, expect, it } from "vitest";
import {
  assertInteger,
  fractionDigitsFor,
  sumMinor,
  toMajor,
  toMinor,
} from "../src/money";

describe("money", () => {
  it("converts major to minor without float drift", () => {
    expect(toMinor(12.34)).toBe(1234);
    expect(toMinor(0.1 + 0.2)).toBe(30); // 0.30000000000000004 -> 30
    expect(toMinor(100)).toBe(10000);
    expect(toMinor(1990, 0)).toBe(1990); // zero-decimal currency
  });

  it("round-trips minor to major", () => {
    expect(toMajor(1234)).toBeCloseTo(12.34, 10);
    expect(toMajor(1990, 0)).toBe(1990);
  });

  it("knows zero-decimal currencies", () => {
    expect(fractionDigitsFor("CNY")).toBe(2);
    expect(fractionDigitsFor("jpy")).toBe(0);
  });

  it("sums minor amounts", () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(sumMinor([])).toBe(0);
  });

  it("rejects non-integer minor amounts", () => {
    expect(() => assertInteger(1.5)).toThrow();
    expect(() => assertInteger(Number.NaN)).toThrow();
    expect(() => assertInteger(7)).not.toThrow();
  });
});
