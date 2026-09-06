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

export interface LLMProvider {
  name: string;
  /** True when the provider's credentials/config are present. */
  available(): boolean;
  /** Parse one sentence into the raw (snake_case) tool output; the caller normalizes. */
  parseExpense(text: string, ctx: ParseCtx): Promise<Record<string, unknown>>;
}
