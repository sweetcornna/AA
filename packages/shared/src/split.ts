import { assertInteger } from "./money";
import type { Minor } from "./money";
import type {
  Allocation,
  ExactShare,
  SplitType,
  UserId,
  WeightShare,
} from "./types";

function assertUnique(userIds: UserId[]): void {
  if (new Set(userIds).size !== userIds.length) {
    throw new Error("participant ids must be unique");
  }
}

/**
 * Equal split with deterministic remainder distribution (largest-remainder by
 * sorted id): the leftover 分 are given +1 each to the first `remainder`
 * participants in sorted order. Guarantees sum === total.
 *
 * e.g. splitEqual(10000, [a,b,c]) -> a:3334, b:3333, c:3333
 */
export function splitEqual(total: Minor, userIds: UserId[]): Allocation {
  assertInteger(total, "total");
  if (total < 0) throw new Error("total must be >= 0");
  const n = userIds.length;
  if (n === 0) throw new Error("splitEqual requires at least one participant");
  assertUnique(userIds);

  const base = Math.trunc(total / n);
  let remainder = total - base * n; // 0 .. n-1
  const result: Allocation = new Map();
  for (const uid of [...userIds].sort()) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    result.set(uid, base + extra);
  }
  return result;
}

/**
 * Exact split: each participant's amount is given explicitly. Validates that
 * the amounts sum exactly to `total`, otherwise throws (caller should surface
 * a validation error in the form).
 */
export function splitExact(total: Minor, shares: ExactShare[]): Allocation {
  assertInteger(total, "total");
  if (shares.length === 0) {
    throw new Error("splitExact requires at least one participant");
  }
  assertUnique(shares.map((s) => s.userId));

  const result: Allocation = new Map();
  let acc = 0;
  for (const { userId, amountMinor } of shares) {
    assertInteger(amountMinor, `amount for ${userId}`);
    if (amountMinor < 0) throw new Error(`amount for ${userId} must be >= 0`);
    result.set(userId, amountMinor);
    acc += amountMinor;
  }
  if (acc !== total) {
    throw new Error(`exact split sum (${acc}) must equal total (${total})`);
  }
  return result;
}

/**
 * Weighted / percentage split using the largest-remainder method: floor each
 * participant's exact share, then hand the leftover 分 to the participants with
 * the biggest fractional parts (tie-break by id). Guarantees sum === total.
 *
 * Percentages are just weights (e.g. [33, 33, 34]); the divisor is the total
 * weight, so they need not sum to 100.
 */
export function splitShares(total: Minor, shares: WeightShare[]): Allocation {
  assertInteger(total, "total");
  if (total < 0) throw new Error("total must be >= 0");
  if (shares.length === 0) {
    throw new Error("splitShares requires at least one participant");
  }
  assertUnique(shares.map((s) => s.userId));

  let totalWeight = 0;
  for (const { userId, weight } of shares) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`weight for ${userId} must be a finite number >= 0`);
    }
    totalWeight += weight;
  }
  if (totalWeight <= 0) throw new Error("total weight must be > 0");

  const result: Allocation = new Map();
  const fractions: { userId: UserId; frac: number }[] = [];
  let allocated = 0;
  for (const { userId, weight } of shares) {
    const exact = (total * weight) / totalWeight;
    const floored = Math.floor(exact);
    result.set(userId, floored);
    allocated += floored;
    fractions.push({ userId, frac: exact - floored });
  }

  let remainder = total - allocated; // 0 .. shares.length-1
  fractions.sort(
    (a, b) => b.frac - a.frac || (a.userId < b.userId ? -1 : 1),
  );
  for (let i = 0; i < remainder; i++) {
    const uid = fractions[i].userId;
    result.set(uid, (result.get(uid) ?? 0) + 1);
  }
  return result;
}

export interface SplitInput {
  total: Minor;
  splitType: SplitType;
  participantIds: UserId[];
  /** Required when splitType === 'exact'. */
  exact?: ExactShare[];
  /** Required when splitType === 'shares'. */
  weights?: WeightShare[];
}

/** Dispatch to the right split strategy. Used by the expense form. */
export function computeSplit(input: SplitInput): Allocation {
  switch (input.splitType) {
    case "equal":
      return splitEqual(input.total, input.participantIds);
    case "exact":
      if (!input.exact) throw new Error("exact split requires `exact` amounts");
      return splitExact(input.total, input.exact);
    case "shares":
      if (!input.weights) throw new Error("shares split requires `weights`");
      return splitShares(input.total, input.weights);
  }
}
