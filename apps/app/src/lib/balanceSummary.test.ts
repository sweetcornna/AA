import { describe, expect, it } from "vitest";
import { summarizeBalances } from "./balanceSummary";
const circles = [
  { id: "cny-a", default_currency: "CNY" },
  { id: "cny-b", default_currency: "CNY" },
  { id: "usd", default_currency: "USD" },
  { id: "jpy", default_currency: "JPY" },
];
describe("currency summaries", () => {
  it("keeps currencies separate and uses integer minor amounts", () => {
    expect(
      summarizeBalances(circles, [
        { circle_id: "cny-a", net_minor: 1200 },
        { circle_id: "cny-b", net_minor: -300 },
        { circle_id: "usd", net_minor: -100 },
        { circle_id: "jpy", net_minor: 999 },
      ]),
    ).toEqual([
      { currency: "CNY", credit: 1200, debit: 300, net: 900, count: 2 },
      { currency: "JPY", credit: 999, debit: 0, net: 999, count: 1 },
      { currency: "USD", credit: 0, debit: 100, net: -100, count: 1 },
    ]);
  });
  it("does not disguise an incomplete response as zero", () =>
    expect(() => summarizeBalances(circles, [])).toThrow("余额不完整"));
  it("ignores stale rows from circles the viewer has left", () =>
    expect(
      summarizeBalances([], [{ circle_id: "old", net_minor: 100 }]),
    ).toEqual([]));
  it("rejects unsafe integer totals", () =>
    expect(() =>
      summarizeBalances(circles.slice(0, 2), [
        { circle_id: "cny-a", net_minor: Number.MAX_SAFE_INTEGER },
        { circle_id: "cny-b", net_minor: 1 },
      ]),
    ).toThrow("超出"));
});
