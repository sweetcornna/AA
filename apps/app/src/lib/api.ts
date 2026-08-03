import { computeSplit } from "@aa/shared";
import type { ExpenseDraft, ParsedExpense } from "@aa/shared";
import {
  mapActivityRows,
  type ActivityItem,
  type ActivityScope,
} from "./activity";
import { transcribeAudioWithClient } from "./asrClient";
import { supabase } from "./supabase";
import type {
  Circle,
  CircleBalance,
  CircleMember,
  Expense,
  Invitation,
  Profile,
  Settlement,
} from "./types";

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// ---- profile ----
export async function getMyProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const res = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, phone, email")
    .eq("id", auth.user.id)
    .maybeSingle();
  return unwrap<Profile | null>(res);
}

export async function updateMyProfile(input: {
  display_name?: string;
  avatar_url?: string | null;
  phone?: string | null;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("not authenticated");
  const res = await supabase.from("profiles").update(input).eq("id", auth.user.id);
  if (res.error) throw new Error(res.error.message);
}

// ---- circles ----
export async function listMyCircles(): Promise<Circle[]> {
  // RLS limits this to circles the caller belongs to.
  const res = await supabase
    .from("circles")
    .select("id, name, description, default_currency, created_by, created_at")
    .order("created_at", { ascending: false });
  return unwrap<Circle[]>(res) ?? [];
}

export async function getCircle(circleId: string): Promise<Circle> {
  const res = await supabase
    .from("circles")
    .select("id, name, description, default_currency, created_by, created_at")
    .eq("id", circleId)
    .single();
  return unwrap<Circle>(res);
}

export async function createCircle(input: {
  name: string;
  description?: string;
  currency?: string;
}): Promise<Circle> {
  const res = await supabase.rpc("create_circle", {
    p_name: input.name,
    p_description: input.description ?? "",
    p_currency: input.currency ?? "CNY",
  });
  return unwrap<Circle>(res);
}

// ---- members ----
export async function listMembers(circleId: string): Promise<CircleMember[]> {
  const res = await supabase
    .from("circle_members")
    .select("id, circle_id, user_id, role, joined_at, profile:profiles(id, display_name, avatar_url)")
    .eq("circle_id", circleId)
    .order("joined_at", { ascending: true });
  const rows = unwrap<
    (Omit<CircleMember, "profile"> & { profile: Profile | Profile[] | null })[]
  >(res);
  return (rows ?? []).map((r) => ({
    ...r,
    profile: Array.isArray(r.profile) ? (r.profile[0] ?? null) : r.profile,
  }));
}

// ---- expenses ----
export async function listExpenses(circleId: string): Promise<Expense[]> {
  const res = await supabase
    .from("expenses")
    .select(
      "id, circle_id, payer_id, amount_minor, currency, description, category, spent_at, split_type, source, created_by, created_at",
    )
    .eq("circle_id", circleId)
    .order("spent_at", { ascending: false })
    .order("created_at", { ascending: false });
  return unwrap<Expense[]>(res) ?? [];
}

/**
 * Compute the per-person allocation with the shared algorithm and persist the
 * expense + splits atomically via the create_expense RPC (server validates the
 * sum equals the total).
 */
export interface ExpenseAiMeta {
  /** LLM that produced the prefill (parse-expense `_provider`). */
  aiProvider?: string | null;
  /** ASR route the raw text came through: "web-speech" | "cloud:<vendor>". */
  asrProvider?: string | null;
  /** Model's 0..1 confidence for the prefill. */
  aiConfidence?: number | null;
  /** Full ParsedExpense as returned, for auditing / prompt iteration. */
  aiRaw?: unknown;
}

export async function createExpense(
  draft: ExpenseDraft,
  opts?: { source?: "manual" | "voice" | "agent"; rawText?: string | null } & ExpenseAiMeta,
): Promise<{ id: string }> {
  const allocation = computeSplit({
    total: draft.amountMinor,
    splitType: draft.splitType,
    participantIds: draft.participantIds,
    exact: draft.exact,
    weights: draft.weights,
  });

  const weightByUser = new Map(draft.weights?.map((w) => [w.userId, w.weight]));
  const splits = [...allocation.entries()].map(([user_id, owed_minor]) => ({
    user_id,
    owed_minor,
    share_units: weightByUser.get(user_id) ?? null,
  }));

  const res = await supabase.rpc("create_expense", {
    p_circle_id: draft.circleId,
    p_payer_id: draft.payerId,
    p_amount_minor: draft.amountMinor,
    p_currency: draft.currency,
    p_description: draft.description,
    p_category: draft.category ?? null,
    p_spent_at: draft.spentAt,
    p_split_type: draft.splitType,
    p_splits: splits,
    p_source: opts?.source ?? "manual",
    p_raw_text: opts?.rawText ?? null,
    p_ai_provider: opts?.aiProvider ?? null,
    p_asr_provider: opts?.asrProvider ?? null,
    p_ai_confidence: opts?.aiConfidence ?? null,
    p_ai_raw: opts?.aiRaw ?? null,
  });
  return unwrap<{ id: string }>(res);
}

/** Transcribe recorded audio via the asr-transcribe Edge Function (cloud ASR). */
export async function transcribeAudio(
  blob: Blob,
  signal?: AbortSignal,
): Promise<{ text: string; provider: string }> {
  return transcribeAudioWithClient(supabase, blob, signal);
}

/**
 * A settlement the agent proposes but does NOT execute. The user confirms in
 * the UI and the client calls the debtor-authorized settlement RPC.
 */
export interface AgentSettleAction {
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
  action: AgentSettleAction | null;
}

/** Ask the AI assistant a question about your ledger (agent-query Edge Function). */
export async function askAgent(question: string): Promise<AgentReply> {
  const { data, error } = await supabase.functions.invoke("agent-query", {
    body: { question },
  });
  if (error) throw new Error(error.message ?? "助手暂时不可用");
  if (data?.error) throw new Error(data.error);
  return {
    answer: (data?.answer as string) ?? "我没太理解，换个说法再问问？",
    action: (data?.action as AgentSettleAction | null) ?? null,
  };
}

/** Natural language → ParsedExpense via the parse-expense Edge Function. */
export async function parseExpense(
  circleId: string,
  text: string,
): Promise<ParsedExpense & { _provider?: string }> {
  const { data, error } = await supabase.functions.invoke("parse-expense", {
    body: { circleId, text },
  });
  if (error) throw new Error(error.message ?? "解析失败");
  if (data?.error) throw new Error(data.error);
  return data as ParsedExpense & { _provider?: string };
}

// ---- balances & settlements ----
export async function getBalances(circleId: string): Promise<CircleBalance[]> {
  const res = await supabase
    .from("circle_balances")
    .select("circle_id, user_id, net_minor")
    .eq("circle_id", circleId);
  return unwrap<CircleBalance[]>(res) ?? [];
}

/** My net balance in every circle I belong to (one row per circle). */
export async function getMyBalances(): Promise<{ circle_id: string; net_minor: number }[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const res = await supabase
    .from("circle_balances")
    .select("circle_id, net_minor")
    .eq("user_id", auth.user.id);
  return unwrap<{ circle_id: string; net_minor: number }[]>(res) ?? [];
}

export type { ActivityItem, ActivityScope } from "./activity";

interface FallbackExpenseEvent {
  kind: "expense";
  id: string;
  circle_id: string;
  occurred_at: string;
  amount_minor: number;
  currency: string;
  description: string;
  category: string | null;
  creator_id: string;
  payer_id: string;
}

interface FallbackSettlementEvent {
  kind: "settlement";
  id: string;
  circle_id: string;
  occurred_at: string;
  amount_minor: number;
  currency: string;
  creator_id: string;
  from_user: string;
  to_user: string;
}

type FallbackActivityEvent =
  | FallbackExpenseEvent
  | FallbackSettlementEvent;

const FALLBACK_EXPENSE_COLUMNS =
  "id, circle_id, payer_id, amount_minor, currency, description, category, created_by, created_at";
const FALLBACK_SETTLEMENT_COLUMNS =
  "id, circle_id, from_user, to_user, amount_minor, currency, created_by, settled_at";

function fallbackExpense(row: Record<string, unknown>): FallbackExpenseEvent {
  return {
    kind: "expense",
    id: row.id as string,
    circle_id: row.circle_id as string,
    occurred_at: row.created_at as string,
    amount_minor: row.amount_minor as number,
    currency: row.currency as string,
    description: row.description as string,
    category: row.category as string | null,
    creator_id: row.created_by as string,
    payer_id: row.payer_id as string,
  };
}

function fallbackSettlement(
  row: Record<string, unknown>,
): FallbackSettlementEvent {
  return {
    kind: "settlement",
    id: row.id as string,
    circle_id: row.circle_id as string,
    occurred_at: row.settled_at as string,
    amount_minor: row.amount_minor as number,
    currency: row.currency as string,
    creator_id: row.created_by as string,
    from_user: row.from_user as string,
    to_user: row.to_user as string,
  };
}

function fallbackActivityOrder(
  left: FallbackActivityEvent,
  right: FallbackActivityEvent,
): number {
  const byTime = right.occurred_at.localeCompare(left.occurred_at);
  if (byTime !== 0) return byTime;
  const byKind = left.kind.localeCompare(right.kind);
  if (byKind !== 0) return byKind;
  return left.id.localeCompare(right.id);
}

async function listFallbackSplitExpenses(
  viewerId: string,
  limit: number,
): Promise<FallbackExpenseEvent[]> {
  const res = await supabase
    .from("expense_splits")
    .select(
      `expense:expenses!expense_splits_expense_circle_fkey!inner(${FALLBACK_EXPENSE_COLUMNS})`,
    )
    .eq("user_id", viewerId)
    .order("expense(created_at)", { ascending: false })
    .order("expense(id)", { ascending: true })
    .limit(limit);
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as unknown as {
    expense: Record<string, unknown> | Record<string, unknown>[];
  }[]).map((row) =>
    fallbackExpense(Array.isArray(row.expense) ? row.expense[0] : row.expense),
  );
}

async function listActivityFallback(
  scope: ActivityScope,
  limit: number,
): Promise<ActivityItem[]> {
  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data.user) {
    throw new Error(auth.error?.message ?? "not authenticated");
  }
  const viewerId = auth.data.user.id;
  const expenseQuery = supabase
    .from("expenses")
    .select(FALLBACK_EXPENSE_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  const settlementQuery = supabase
    .from("settlements")
    .select(FALLBACK_SETTLEMENT_COLUMNS)
    .order("settled_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);

  if (scope === "mine") {
    expenseQuery.or(`payer_id.eq.${viewerId},created_by.eq.${viewerId}`);
    settlementQuery.or(
      `from_user.eq.${viewerId},to_user.eq.${viewerId},created_by.eq.${viewerId}`,
    );
  }

  const [expenseRes, settlementRes, splitExpenses] = await Promise.all([
    expenseQuery,
    settlementQuery,
    scope === "mine"
      ? listFallbackSplitExpenses(viewerId, limit)
      : Promise.resolve([]),
  ]);
  if (expenseRes.error) throw new Error(expenseRes.error.message);
  if (settlementRes.error) throw new Error(settlementRes.error.message);

  const candidates: FallbackActivityEvent[] = [
    ...((expenseRes.data ?? []) as Record<string, unknown>[]).map(
      fallbackExpense,
    ),
    ...splitExpenses,
    ...((settlementRes.data ?? []) as Record<string, unknown>[]).map(
      fallbackSettlement,
    ),
  ];
  const unique = new Map<string, FallbackActivityEvent>();
  for (const event of candidates) unique.set(`${event.kind}:${event.id}`, event);
  const events = [...unique.values()].sort(fallbackActivityOrder).slice(0, limit);
  if (events.length === 0) return [];

  const circleIds = [...new Set(events.map((event) => event.circle_id))];
  const profileIds = new Set<string>();
  const expenseIds: string[] = [];
  for (const event of events) {
    profileIds.add(event.creator_id);
    if (event.kind === "expense") {
      profileIds.add(event.payer_id);
      expenseIds.push(event.id);
    } else {
      profileIds.add(event.from_user);
      profileIds.add(event.to_user);
    }
  }

  const [circleRes, profileRes, splitRes] = await Promise.all([
    supabase.from("circles").select("id, name").in("id", circleIds),
    supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", [...profileIds]),
    expenseIds.length > 0
      ? supabase
          .from("expense_splits")
          .select("expense_id, owed_minor")
          .eq("user_id", viewerId)
          .in("expense_id", expenseIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (circleRes.error) throw new Error(circleRes.error.message);
  if (profileRes.error) throw new Error(profileRes.error.message);
  if (splitRes.error) throw new Error(splitRes.error.message);

  const circleNames = new Map(
    ((circleRes.data ?? []) as { id: string; name: string }[]).map((row) => [
      row.id,
      row.name,
    ]),
  );
  const profileNames = new Map(
    ((profileRes.data ?? []) as { id: string; display_name: string }[]).map(
      (row) => [row.id, row.display_name],
    ),
  );
  const owedByExpense = new Map(
    ((splitRes.data ?? []) as { expense_id: string; owed_minor: number }[]).map(
      (row) => [row.expense_id, row.owed_minor],
    ),
  );

  const rows = events.map((event) => {
    const common = {
      kind: event.kind,
      id: event.id,
      circle_id: event.circle_id,
      circle_name: circleNames.get(event.circle_id),
      occurred_at: event.occurred_at,
      amount_minor: event.amount_minor,
      currency: event.currency,
      creator_id: event.creator_id,
      creator_name: profileNames.get(event.creator_id) ?? null,
    };
    if (event.kind === "expense") {
      return {
        ...common,
        description: event.description,
        category: event.category,
        payer_id: event.payer_id,
        payer_name: profileNames.get(event.payer_id) ?? null,
        my_owed_minor: owedByExpense.get(event.id) ?? null,
        from_user: null,
        from_name: null,
        to_user: null,
        to_name: null,
      };
    }
    return {
      ...common,
      description: null,
      category: null,
      payer_id: null,
      payer_name: null,
      my_owed_minor: null,
      from_user: event.from_user,
      from_name: profileNames.get(event.from_user) ?? null,
      to_user: event.to_user,
      to_name: profileNames.get(event.to_user) ?? null,
    };
  });
  return mapActivityRows(rows, viewerId);
}

/** Recent scoped activity across all circles visible to the caller. */
export async function listActivity(
  scope: ActivityScope,
  viewerId: string,
  limit = 25,
): Promise<ActivityItem[]> {
  const effectiveLimit = Math.min(Math.max(limit, 1), 100);
  const res = await supabase.rpc("list_activity", {
    p_scope: scope,
    p_limit: effectiveLimit,
  });
  if (!res.error) {
    return mapActivityRows(res.data as unknown[] | null, viewerId);
  }
  if (res.error.code !== "PGRST202") throw new Error(res.error.message);
  if (scope !== "all" && scope !== "mine") {
    throw new Error("Invalid activity scope");
  }
  return listActivityFallback(scope, effectiveLimit);
}

export async function listSettlements(circleId: string): Promise<Settlement[]> {
  const res = await supabase
    .from("settlements")
    .select("id, circle_id, from_user, to_user, amount_minor, currency, note, settled_at")
    .eq("circle_id", circleId)
    .order("settled_at", { ascending: false });
  return unwrap<Settlement[]>(res) ?? [];
}

export async function createSettlement(input: {
  circleId: string;
  fromUser: string;
  toUser: string;
  amountMinor: number;
  currency: string;
  note?: string;
}): Promise<void> {
  const res = await supabase.rpc("create_settlement", {
    p_circle_id: input.circleId,
    p_from_user: input.fromUser,
    p_to_user: input.toUser,
    p_amount_minor: input.amountMinor,
    p_currency: input.currency,
    p_note: input.note ?? null,
  });
  if (res.error) throw new Error(res.error.message);
}

// ---- invitations ----
export async function createInvitation(input: {
  circleId: string;
  role?: "admin" | "member";
  maxUses?: number | null;
  expiresAt?: string | null;
}): Promise<Invitation> {
  const res = await supabase.rpc("create_invitation", {
    p_circle_id: input.circleId,
    p_role: input.role ?? "member",
    p_max_uses: input.maxUses ?? null,
    p_expires_at: input.expiresAt ?? null,
  });
  return unwrap<Invitation>(res);
}

export async function acceptInvitation(token: string): Promise<string> {
  const res = await supabase.rpc("accept_invitation", { p_token: token });
  return unwrap<string>(res);
}
