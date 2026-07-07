// Vendor-agnostic LLM provider abstraction for the AI Edge Functions.
// Adding a vendor = one implementation file + one line in registry.ts.

export interface Member {
  id: string;
  name: string;
}

/** Context injected server-side when parsing a natural-language expense. */
export interface ParseCtx {
  members: Member[];
  currentUserId: string;
  currency: string;
  today: string;
  categories: string[];
}

/** One suggested transfer inside a circle (amounts in minor units, 分). */
export interface Transfer {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
}

/** Authoritative ledger snapshot agent-query builds under the caller's RLS. */
export interface Snapshot {
  me: { id: string; name: string };
  today: string;
  monthStart: string;
  circles: {
    id: string;
    name: string;
    currency: string;
    myNet: number;
    members: { id: string; name: string; net: number }[];
    settlements: Transfer[];
  }[];
  myMonthSpendByCategory: { category: string; amount: number }[];
  myMonthTotal: number;
  recentExpenses: {
    circle: string;
    description: string;
    category: string | null;
    amount: number;
    payer: string;
    spentAt: string;
  }[];
}

/**
 * A write the agent PROPOSES but never executes. The client shows a
 * confirmation card; only after the user confirms does the client perform the
 * insert itself (under RLS). Amounts always come from the server-computed
 * snapshot, never from model output.
 */
export interface SettleUpAction {
  type: "settle_up";
  circleId: string;
  circleName: string;
  fromUser: string;
  fromName: string;
  toUser: string;
  toName: string;
  amountMinor: number;
  currency: string;
}

export interface AgentReply {
  answer: string;
  action?: SettleUpAction | null;
}

export interface LLMProvider {
  name: string;
  /** True when the provider's credentials/config are present. */
  available(): boolean;
  /** Parse one sentence into the raw (snake_case) tool output; the caller normalizes. */
  parseExpense(text: string, ctx: ParseCtx): Promise<Record<string, unknown>>;
  /** Answer a ledger question over the snapshot; may propose a settle_up action. */
  answerQuestion(question: string, snap: Snapshot): Promise<AgentReply>;
}
