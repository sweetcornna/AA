import { computeSplit } from "@aa/shared";
import type { ExpenseDraft, ParsedExpense } from "@aa/shared";
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
export async function createExpense(
  draft: ExpenseDraft,
  opts?: { source?: "manual" | "voice" | "agent"; rawText?: string | null },
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
  });
  return unwrap<{ id: string }>(res);
}

/** Natural language → ParsedExpense via the parse-expense Edge Function. */
export async function parseExpense(circleId: string, text: string): Promise<ParsedExpense> {
  const { data, error } = await supabase.functions.invoke("parse-expense", {
    body: { circleId, text },
  });
  if (error) throw new Error(error.message ?? "解析失败");
  if (data?.error) throw new Error(data.error);
  return data as ParsedExpense;
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

export interface ActivityItem {
  kind: "expense" | "settlement";
  id: string;
  circleId: string;
  circleName: string;
  at: string;
  amountMinor: number;
  currency: string;
  description?: string;
  category?: string | null;
  payerName?: string;
  fromName?: string;
  toName?: string;
}

/** Recent expenses + settlements across all my circles, newest first. */
export async function listActivity(limit = 25): Promise<ActivityItem[]> {
  const circles = await listMyCircles();
  if (circles.length === 0) return [];
  const circleMap = new Map(circles.map((c) => [c.id, c]));
  const ids = circles.map((c) => c.id);

  const [expRes, setRes] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, circle_id, description, amount_minor, currency, category, created_at, payer_id")
      .in("circle_id", ids)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("settlements")
      .select("id, circle_id, amount_minor, currency, settled_at, from_user, to_user")
      .in("circle_id", ids)
      .order("settled_at", { ascending: false })
      .limit(limit),
  ]);
  if (expRes.error) throw new Error(expRes.error.message);
  if (setRes.error) throw new Error(setRes.error.message);
  const expenses = expRes.data ?? [];
  const settlements = setRes.data ?? [];

  // resolve display names in one query
  const userIds = new Set<string>();
  for (const e of expenses) userIds.add(e.payer_id);
  for (const s of settlements) {
    userIds.add(s.from_user);
    userIds.add(s.to_user);
  }
  const nameMap = new Map<string, string>();
  if (userIds.size > 0) {
    const profRes = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", [...userIds]);
    for (const p of profRes.data ?? []) nameMap.set(p.id, p.display_name);
  }
  const nm = (id: string) => nameMap.get(id) ?? "成员";

  const items: ActivityItem[] = [
    ...expenses.map((e): ActivityItem => ({
      kind: "expense",
      id: e.id,
      circleId: e.circle_id,
      circleName: circleMap.get(e.circle_id)?.name ?? "圈子",
      at: e.created_at,
      amountMinor: e.amount_minor,
      currency: e.currency,
      description: e.description,
      category: e.category,
      payerName: nm(e.payer_id),
    })),
    ...settlements.map((s): ActivityItem => ({
      kind: "settlement",
      id: s.id,
      circleId: s.circle_id,
      circleName: circleMap.get(s.circle_id)?.name ?? "圈子",
      at: s.settled_at,
      amountMinor: s.amount_minor,
      currency: s.currency,
      fromName: nm(s.from_user),
      toName: nm(s.to_user),
    })),
  ];
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return items.slice(0, limit);
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
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("not authenticated");
  const res = await supabase.from("settlements").insert({
    circle_id: input.circleId,
    from_user: input.fromUser,
    to_user: input.toUser,
    amount_minor: input.amountMinor,
    currency: input.currency,
    note: input.note ?? null,
    created_by: auth.user.id,
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
