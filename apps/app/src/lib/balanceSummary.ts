import type { Circle } from "./types";
export interface CurrencySummary {
  currency: string;
  credit: number;
  debit: number;
  net: number;
  count: number;
}
/** Never add balances in different currencies or turn a missing row into zero. */
export function summarizeBalances(
  circles: Pick<Circle, "id" | "default_currency">[],
  balances: { circle_id: string; net_minor: number }[],
): CurrencySummary[] {
  const byCircle = new Map(balances.map((b) => [b.circle_id, b.net_minor]));
  const byCurrency = new Map<string, CurrencySummary>();
  for (const circle of circles) {
    const amount = byCircle.get(circle.id);
    if (amount === undefined || !Number.isSafeInteger(amount))
      throw new Error("圈子余额不完整，请刷新后重试。");
    const currency = circle.default_currency;
    const group = byCurrency.get(currency) ?? {
      currency,
      credit: 0,
      debit: 0,
      net: 0,
      count: 0,
    };
    group.credit += Math.max(0, amount);
    group.debit += Math.max(0, -amount);
    group.net += amount;
    group.count++;
    if (![group.credit, group.debit, group.net].every(Number.isSafeInteger))
      throw new Error("汇总金额超出显示范围，请查看各圈子余额。");
    byCurrency.set(currency, group);
  }
  return [...byCurrency.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
}
