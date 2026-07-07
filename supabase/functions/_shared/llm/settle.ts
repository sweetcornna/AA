// settle_up proposal helpers. An action is only ever constructed from the
// server-computed snapshot — a proposal is a (circleId, index) reference into
// snapshot.circles[].settlements, so a model can never invent amounts/parties.
import type { SettleUpAction, Snapshot } from "./types.ts";

export function actionFromProposal(
  snap: Snapshot,
  circleId: unknown,
  transferIndex: unknown,
): SettleUpAction | null {
  if (typeof circleId !== "string" || typeof transferIndex !== "number") return null;
  const circle = snap.circles.find((c) => c.id === circleId);
  const t = circle?.settlements[transferIndex];
  if (!circle || !t) return null;
  // Only propose transfers the asking user is a party to.
  if (t.fromId !== snap.me.id && t.toId !== snap.me.id) return null;
  return {
    type: "settle_up",
    circleId: circle.id,
    circleName: circle.name,
    fromUser: t.fromId,
    fromName: t.fromName,
    toUser: t.toId,
    toName: t.toName,
    amountMinor: t.amount,
    currency: circle.currency,
  };
}

/**
 * Rule-based settle intent: "帮我和小明结一下账" → the first suggested transfer
 * that involves me (and the named counterparty, when one is mentioned).
 */
export function findSettleProposal(question: string, snap: Snapshot): SettleUpAction | null {
  if (!/结账|结一下|结算|还钱|还款|把账结/.test(question)) return null;
  for (const c of snap.circles) {
    for (let i = 0; i < c.settlements.length; i++) {
      const t = c.settlements[i];
      if (t.fromId !== snap.me.id && t.toId !== snap.me.id) continue;
      const counterparty = t.fromId === snap.me.id ? t.toName : t.fromName;
      // If the question names some member, require that member to be this
      // transfer's counterparty (so "和小明结账" doesn't propose 小红's transfer).
      const namesMentioned = snap.circles
        .flatMap((x) => x.members.map((m) => m.name))
        .filter((n) => n !== snap.me.name)
        .some((n) => question.includes(n));
      if (namesMentioned && !question.includes(counterparty)) continue;
      return actionFromProposal(snap, c.id, i);
    }
  }
  return null;
}
