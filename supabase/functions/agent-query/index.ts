// agent-query — natural language Q&A over the caller's ledger.
//
// The function builds an AUTHORITATIVE snapshot from the database (every query
// runs under the caller's JWT, so RLS guarantees they only ever see their own
// circles), then hands it to the LLM provider from the registry (_shared/llm),
// falling back to the rule-based provider without a key or on error.
//
// Read tools run automatically; the one WRITE the agent can do — settle_up —
// is only ever PROPOSED: the response carries an `action` referencing a
// server-computed transfer, the client shows a confirmation card, and only the
// user's confirmation performs the insert (client-side, under RLS).
// Runs as a Supabase Edge Function (Deno).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveLLM, ruleProvider } from "../_shared/llm/registry.ts";
import type { AgentReply, Snapshot } from "../_shared/llm/types.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function shanghaiNow(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}
function monthStartISO(): string {
  const d = shanghaiNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// Greedy minimal-transfer settlement over net balances (mirrors
// packages/shared/settle.ts). Positive net = creditor, negative = debtor.
function minimizeTransfers(nets: { id: string; net: number }[]) {
  const creditors = nets.filter((n) => n.net > 0).map((n) => ({ ...n })).sort((a, b) => b.net - a.net);
  const debtors = nets.filter((n) => n.net < 0).map((n) => ({ id: n.id, net: -n.net })).sort((a, b) => b.net - a.net);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].net, creditors[j].net);
    if (pay > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].net -= pay;
    creditors[j].net -= pay;
    if (debtors[i].net === 0) i++;
    if (creditors[j].net === 0) j++;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function buildSnapshot(supabase: any, userId: string): Promise<Snapshot> {
  const { data: circles } = await supabase
    .from("circles")
    .select("id, name, default_currency");
  const circleRows = circles ?? [];
  // deno-lint-ignore no-explicit-any
  const circleIds = circleRows.map((c: any) => c.id);

  const { data: balances } = circleIds.length
    ? await supabase.from("circle_balances").select("circle_id, user_id, net_minor").in("circle_id", circleIds)
    : { data: [] };

  const { data: members } = circleIds.length
    ? await supabase
        .from("circle_members")
        .select("circle_id, user_id, profile:profiles(display_name)")
        .in("circle_id", circleIds)
    : { data: [] };

  const nameOf = new Map<string, string>();
  for (const m of members ?? []) {
    const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
    nameOf.set(m.user_id, p?.display_name ?? "成员");
  }
  const myName = nameOf.get(userId) ?? "我";

  // recent expenses across my circles (covers "who paid" + this-month spend)
  const { data: expenses } = circleIds.length
    ? await supabase
        .from("expenses")
        .select("id, circle_id, description, category, amount_minor, payer_id, spent_at")
        .in("circle_id", circleIds)
        .order("spent_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(80)
    : { data: [] };
  const expRows = expenses ?? [];

  // my share per expense (for spend-by-category)
  // deno-lint-ignore no-explicit-any
  const expIds = expRows.map((e: any) => e.id);
  const { data: splits } = expIds.length
    ? await supabase.from("expense_splits").select("expense_id, owed_minor").eq("user_id", userId).in("expense_id", expIds)
    : { data: [] };
  const myShare = new Map<string, number>();
  for (const s of splits ?? []) myShare.set(s.expense_id, s.owed_minor);

  // deno-lint-ignore no-explicit-any
  const circleNameOf = new Map(circleRows.map((c: any) => [c.id, c.name]));
  const monthStart = monthStartISO();

  const byCat = new Map<string, number>();
  let myMonthTotal = 0;
  for (const e of expRows) {
    if (e.spent_at >= monthStart) {
      const share = myShare.get(e.id) ?? 0;
      if (share > 0) {
        const cat = e.category ?? "其他";
        byCat.set(cat, (byCat.get(cat) ?? 0) + share);
        myMonthTotal += share;
      }
    }
  }

  // deno-lint-ignore no-explicit-any
  const circlesOut = circleRows.map((c: any) => {
    // deno-lint-ignore no-explicit-any
    const rows = (balances ?? []).filter((b: any) => b.circle_id === c.id);
    // deno-lint-ignore no-explicit-any
    const memberNets = rows.map((b: any) => ({ id: b.user_id, name: nameOf.get(b.user_id) ?? "成员", net: b.net_minor }));
    // deno-lint-ignore no-explicit-any
    const mine = memberNets.find((m: any) => m.id === userId)?.net ?? 0;
    // Keep ids alongside names: settle_up proposals are validated against —
    // and executed from — these server-computed transfers.
    // deno-lint-ignore no-explicit-any
    const transfers = minimizeTransfers(memberNets.map((m: any) => ({ id: m.id, net: m.net }))).map((t) => ({
      fromId: t.from,
      fromName: nameOf.get(t.from) ?? "成员",
      toId: t.to,
      toName: nameOf.get(t.to) ?? "成员",
      amount: t.amount,
    }));
    return {
      id: c.id,
      name: c.name,
      currency: c.default_currency ?? "CNY",
      myNet: mine,
      members: memberNets,
      settlements: transfers,
    };
  });

  return {
    me: { id: userId, name: myName },
    today: shanghaiNow().toISOString().slice(0, 10),
    monthStart,
    circles: circlesOut,
    myMonthSpendByCategory: [...byCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    myMonthTotal,
    // deno-lint-ignore no-explicit-any
    recentExpenses: expRows.slice(0, 30).map((e: any) => ({
      circle: circleNameOf.get(e.circle_id) ?? "圈子",
      description: e.description,
      category: e.category,
      amount: e.amount_minor,
      payer: nameOf.get(e.payer_id) ?? "成员",
      spentAt: e.spent_at,
    })),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { question } = await req.json().catch(() => ({}));
    if (!question || typeof question !== "string") return json({ error: "question is required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const snap = await buildSnapshot(supabase, user.id);

    const provider = await resolveLLM(supabase, null);
    let reply: AgentReply;
    let providerName = provider.name;
    try {
      reply = await provider.answerQuestion(question, snap);
    } catch (_e) {
      reply = await ruleProvider.answerQuestion(question, snap);
      providerName = `${ruleProvider.name}(after-${provider.name}-error)`;
    }

    return json({ answer: reply.answer, action: reply.action ?? null, _provider: providerName }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
