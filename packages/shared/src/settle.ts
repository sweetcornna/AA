import type { Minor } from "./money";
import type { Transfer, UserId } from "./types";

interface Party {
  userId: UserId;
  amount: Minor; // always positive
}

const byAmountDescThenId = (a: Party, b: Party): number =>
  b.amount - a.amount || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

/**
 * Greedy debt simplification: repeatedly match the largest creditor with the
 * largest debtor and transfer the smaller of the two. Produces a valid
 * settlement (everyone ends at zero) in <= n-1 transfers.
 *
 * This is the same heuristic Splitwise-style apps use. It is not guaranteed to
 * be the theoretical minimum (that's NP-hard) but is excellent for real circles.
 *
 * `net` is the output of {@link computeBalances}.
 */
export function minimizeTransfers(net: Map<UserId, Minor>): Transfer[] {
  const creditors: Party[] = [];
  const debtors: Party[] = [];
  for (const [userId, amount] of net) {
    if (amount > 0) creditors.push({ userId, amount });
    else if (amount < 0) debtors.push({ userId, amount: -amount });
  }
  creditors.sort(byAmountDescThenId);
  debtors.sort(byAmountDescThenId);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const c = creditors[i];
    const d = debtors[j];
    const pay = Math.min(c.amount, d.amount);
    if (pay > 0) {
      transfers.push({ from: d.userId, to: c.userId, amount: pay });
    }
    c.amount -= pay;
    d.amount -= pay;
    if (c.amount === 0) i++;
    if (d.amount === 0) j++;
  }
  return transfers;
}
