import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeBalances } from "../src/balances";
import type { ExpenseRecord } from "../src/balances";
import { sumMinor } from "../src/money";
import { splitEqual } from "../src/split";

function equalExpense(payerId: string, amount: number, participants: string[]): ExpenseRecord {
  const a = splitEqual(amount, participants);
  return {
    payerId,
    amountMinor: amount,
    splits: [...a.entries()].map(([userId, owedMinor]) => ({ userId, owedMinor })),
  };
}

describe("computeBalances", () => {
  it("a paid 9000 split 3 ways -> a is +6000, b and c are -3000", () => {
    const net = computeBalances([equalExpense("a", 9000, ["a", "b", "c"])]);
    expect(net.get("a")).toBe(6000);
    expect(net.get("b")).toBe(-3000);
    expect(net.get("c")).toBe(-3000);
    expect(sumMinor(net.values())).toBe(0);
  });

  it("settlements reduce debt", () => {
    const net = computeBalances(
      [equalExpense("a", 9000, ["a", "b", "c"])],
      [{ fromUser: "b", toUser: "a", amountMinor: 3000 }],
    );
    expect(net.get("b")).toBe(0); // b paid off their share
    expect(net.get("a")).toBe(3000); // a still owed by c
    expect(sumMinor(net.values())).toBe(0);
  });
});

describe("balances invariant (property-based)", () => {
  it("sum of net balances is always zero", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            payer: fc.integer({ min: 0, max: 5 }),
            amount: fc.integer({ min: 1, max: 1_000_000 }),
            n: fc.integer({ min: 1, max: 6 }),
          }),
          { minLength: 0, maxLength: 30 },
        ),
        (raw) => {
          const expenses = raw.map((r) =>
            equalExpense(
              `u${r.payer}`,
              r.amount,
              Array.from({ length: r.n }, (_, i) => `u${i}`),
            ),
          );
          expect(sumMinor(computeBalances(expenses).values())).toBe(0);
        },
      ),
    );
  });
});
