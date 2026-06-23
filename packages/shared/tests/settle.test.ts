import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { minimizeTransfers } from "../src/settle";
import type { Transfer } from "../src/types";

/** Apply transfers to net balances; everyone should end at zero. */
function applyTransfers(net: Map<string, number>, transfers: Transfer[]): Map<string, number> {
  const result = new Map(net);
  for (const t of transfers) {
    result.set(t.from, (result.get(t.from) ?? 0) + t.amount); // debtor pays -> net up
    result.set(t.to, (result.get(t.to) ?? 0) - t.amount); // creditor receives -> net down
  }
  return result;
}

describe("minimizeTransfers", () => {
  it("settles a classic 3-person case in <= n-1 transfers", () => {
    // a is owed 6000; b and c each owe 3000
    const net = new Map([
      ["a", 6000],
      ["b", -3000],
      ["c", -3000],
    ]);
    const transfers = minimizeTransfers(net);
    expect(transfers.length).toBeLessThanOrEqual(2);
    for (const v of applyTransfers(net, transfers).values()) expect(v).toBe(0);
  });

  it("returns no transfers when everyone is settled", () => {
    expect(minimizeTransfers(new Map([["a", 0], ["b", 0]]))).toEqual([]);
  });

  it("never creates a transfer larger than the debt", () => {
    const net = new Map([
      ["a", 5000],
      ["b", 1000],
      ["c", -6000],
    ]);
    const transfers = minimizeTransfers(net);
    expect(transfers.every((t) => t.amount > 0)).toBe(true);
    for (const v of applyTransfers(net, transfers).values()) expect(v).toBe(0);
  });
});

describe("settle invariants (property-based)", () => {
  it("zeroes every balance with at most n-1 transfers", () => {
    fc.assert(
      fc.property(
        // generate balances that sum to zero
        fc.array(fc.integer({ min: -100000, max: 100000 }), { minLength: 1, maxLength: 25 }),
        (vals) => {
          const sum = vals.reduce((s, v) => s + v, 0);
          const net = new Map<string, number>();
          vals.forEach((v, i) => net.set(`u${i}`, v));
          // absorb the residue into the first user so the set sums to zero
          net.set("u0", (net.get("u0") ?? 0) - sum);

          const nonZero = [...net.values()].filter((v) => v !== 0).length;
          const transfers = minimizeTransfers(net);
          expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
          for (const v of applyTransfers(net, transfers).values()) expect(v).toBe(0);
        },
      ),
    );
  });
});
