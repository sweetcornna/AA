import type { Minor } from "./money";
import type { UserId } from "./types";

/** One expense with its already-computed per-participant allocation. */
export interface ExpenseRecord {
  payerId: UserId;
  amountMinor: Minor;
  splits: { userId: UserId; owedMinor: Minor }[];
}

/** A recorded repayment: `fromUser` (debtor) paid `toUser` (creditor). */
export interface SettlementRecord {
  fromUser: UserId;
  toUser: UserId;
  amountMinor: Minor;
}

/**
 * Net balance per user for a circle (minor units):
 *   net = paid (as payer) - owed (across all splits)
 *         + settlements paid out - settlements received
 *
 * net > 0  => others owe this user (creditor)
 * net < 0  => this user owes others (debtor)
 *
 * Invariant: when every expense's splits sum to its amount, sum(net) === 0.
 */
export function computeBalances(
  expenses: ExpenseRecord[],
  settlements: SettlementRecord[] = [],
): Map<UserId, Minor> {
  const net = new Map<UserId, Minor>();
  const add = (uid: UserId, delta: Minor) =>
    net.set(uid, (net.get(uid) ?? 0) + delta);

  for (const e of expenses) {
    add(e.payerId, e.amountMinor);
    for (const s of e.splits) add(s.userId, -s.owedMinor);
  }
  for (const s of settlements) {
    add(s.fromUser, s.amountMinor); // paying back reduces your debt
    add(s.toUser, -s.amountMinor); // receiving reduces what you're owed
  }
  return net;
}
