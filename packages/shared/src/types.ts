import type { Minor } from "./money";

export type UserId = string;

export type SplitType = "equal" | "exact" | "shares";

/** Computed allocation: how much each user owes for a single expense (minor units). */
export type Allocation = Map<UserId, Minor>;

/** A suggested settlement transfer: `from` (debtor) pays `to` (creditor). */
export interface Transfer {
  from: UserId;
  to: UserId;
  amount: Minor;
}

/** Per-participant exact amount (used by split_type = 'exact'). */
export interface ExactShare {
  userId: UserId;
  amountMinor: Minor;
}

/** Per-participant weight (used by split_type = 'shares'; also covers percentages). */
export interface WeightShare {
  userId: UserId;
  weight: number;
}
