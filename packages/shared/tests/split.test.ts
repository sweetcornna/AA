import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sumMinor } from "../src/money";
import {
  computeSplit,
  splitEqual,
  splitExact,
  splitShares,
} from "../src/split";

const total = (a: Map<string, number>) => sumMinor(a.values());

describe("splitEqual", () => {
  it("distributes the remainder deterministically by sorted id", () => {
    const a = splitEqual(10000, ["c", "a", "b"]);
    expect(a.get("a")).toBe(3334);
    expect(a.get("b")).toBe(3333);
    expect(a.get("c")).toBe(3333);
    expect(total(a)).toBe(10000);
  });

  it("handles exact division", () => {
    const a = splitEqual(9000, ["a", "b", "c"]);
    expect([...a.values()]).toEqual([3000, 3000, 3000]);
  });

  it("handles a single participant", () => {
    expect(splitEqual(777, ["a"]).get("a")).toBe(777);
  });

  it("rejects empty / duplicate / non-integer / negative", () => {
    expect(() => splitEqual(100, [])).toThrow();
    expect(() => splitEqual(100, ["a", "a"])).toThrow();
    expect(() => splitEqual(1.5, ["a"])).toThrow();
    expect(() => splitEqual(-1, ["a"])).toThrow();
  });
});

describe("splitExact", () => {
  it("accepts amounts that sum to total", () => {
    const a = splitExact(10000, [
      { userId: "a", amountMinor: 6000 },
      { userId: "b", amountMinor: 4000 },
    ]);
    expect(total(a)).toBe(10000);
  });

  it("throws when amounts do not sum to total", () => {
    expect(() =>
      splitExact(10000, [
        { userId: "a", amountMinor: 6000 },
        { userId: "b", amountMinor: 3999 },
      ]),
    ).toThrow();
  });
});

describe("splitShares", () => {
  it("splits by weight with largest-remainder rounding", () => {
    const a = splitShares(10000, [
      { userId: "a", weight: 1 },
      { userId: "b", weight: 2 },
      { userId: "c", weight: 1 },
    ]);
    expect(total(a)).toBe(10000);
    expect(a.get("b")).toBe(5000);
    // 1/4 of 10000 = 2500 each for a and c
    expect(a.get("a")).toBe(2500);
    expect(a.get("c")).toBe(2500);
  });

  it("treats weights as percentages", () => {
    const a = splitShares(10000, [
      { userId: "a", weight: 33 },
      { userId: "b", weight: 33 },
      { userId: "c", weight: 34 },
    ]);
    expect(total(a)).toBe(10000);
  });

  it("rejects all-zero weights", () => {
    expect(() =>
      splitShares(100, [{ userId: "a", weight: 0 }]),
    ).toThrow();
  });
});

describe("computeSplit dispatch", () => {
  it("routes to the correct strategy", () => {
    expect(
      total(computeSplit({ total: 100, splitType: "equal", participantIds: ["a", "b"] })),
    ).toBe(100);
  });
});

describe("split invariants (property-based)", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

  it("equal split always sums to total and is non-negative", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 50 }),
        (t, n) => {
          const a = splitEqual(t, ids(n));
          expect(total(a)).toBe(t);
          for (const v of a.values()) expect(v).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it("shares split always sums to total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 20 }),
        (t, weights) => {
          const a = splitShares(
            t,
            weights.map((weight, i) => ({ userId: `u${i}`, weight })),
          );
          expect(total(a)).toBe(t);
          for (const v of a.values()) expect(v).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
