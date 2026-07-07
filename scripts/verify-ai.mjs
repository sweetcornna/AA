// Live end-to-end check of the AI layer against the local Supabase stack.
// Exercises parse-expense and agent-query through the provider registry with
// no API key configured, so the rule provider (the always-available floor)
// answers — including the settle_up action proposal that the client renders as
// a confirmation card.
//
// Run: node scripts/verify-ai.mjs   (requires `supabase start`; the local
// stack serves supabase/functions/* on /functions/v1 automatically)
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

let failures = 0;
function check(label, cond, extra = "") {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const rid = () => Math.random().toString(36).slice(2, 10);

async function makeUser(tag, displayName) {
  const email = `${tag}-${rid()}@test.local`;
  const password = "Password123!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn ${tag}: ${signIn.error.message}`);
  await client.from("profiles").update({ display_name: displayName }).eq("id", data.user.id);
  return { id: data.user.id, client };
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() + 8 * 3600e3); // Asia/Shanghai, same rule the functions use
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const a = await makeUser("alice", "Alice");
  const b = await makeUser("bob", "Bob");

  const circle = await a.client.rpc("create_circle", { p_name: "AI 测试圈", p_description: "", p_currency: "CNY" });
  const circleId = circle.data.id;
  const inv = await a.client.rpc("create_invitation", { p_circle_id: circleId });
  await b.client.rpc("accept_invitation", { p_token: inv.data.token });

  // A pays 100.00 split equally → B owes A 50.00
  await a.client.rpc("create_expense", {
    p_circle_id: circleId,
    p_payer_id: a.id,
    p_amount_minor: 10000,
    p_currency: "CNY",
    p_description: "火锅",
    p_category: "餐饮",
    p_spent_at: isoDaysAgo(1),
    p_split_type: "equal",
    p_splits: [
      { user_id: a.id, owed_minor: 5000 },
      { user_id: b.id, owed_minor: 5000 },
    ],
  });

  // ---- parse-expense (rule provider: no key configured locally) ----
  const parse = await a.client.functions.invoke("parse-expense", {
    body: { circleId, text: "昨天和Bob吃火锅 300 平摊" },
  });
  const p = parse.data;
  check("parse-expense responds", !parse.error && p && !p.error, parse.error?.message ?? p?.error);
  check("parse: provider reported", typeof p?._provider === "string", `_provider=${p?._provider}`);
  check("parse: amount 300", p?.amount === 300, `got ${p?.amount}`);
  check("parse: category 餐饮", p?.category === "餐饮", `got ${p?.category}`);
  check("parse: 昨天 → yesterday", p?.spentAt === isoDaysAgo(1), `got ${p?.spentAt} want ${isoDaysAgo(1)}`);
  const pids = (p?.participants ?? []).map((x) => x.matchedMemberId);
  check("parse: matched 我+Bob to member ids", pids.includes(a.id) && pids.includes(b.id), JSON.stringify(pids));

  // ---- agent-query: read Q&A ----
  const q1 = await b.client.functions.invoke("agent-query", { body: { question: "我现在欠谁钱？" } });
  check("agent-query answers balance question", !q1.error && /应付|欠/.test(q1.data?.answer ?? ""), q1.data?.answer);
  check("agent: read-only question proposes no action", (q1.data?.action ?? null) === null, JSON.stringify(q1.data?.action));

  // ---- agent-query: settle intent → proposed (not executed) action ----
  const q2 = await b.client.functions.invoke("agent-query", { body: { question: "帮我和Alice结一下账" } });
  const act = q2.data?.action;
  check("agent: settle intent proposes settle_up action", act?.type === "settle_up", JSON.stringify(q2.data));
  check(
    "agent: action matches server-computed transfer (B→A ¥50.00)",
    act?.fromUser === b.id && act?.toUser === a.id && act?.amountMinor === 5000 && act?.circleId === circleId,
    JSON.stringify(act),
  );
  const before = await admin.from("settlements").select("id").eq("circle_id", circleId);
  check("agent: nothing written before user confirms", (before.data ?? []).length === 0, `rows=${before.data?.length}`);

  // user confirms → the client records the settlement itself (RLS applies)
  if (act) {
    const ins = await b.client.from("settlements").insert({
      circle_id: act.circleId,
      from_user: act.fromUser,
      to_user: act.toUser,
      amount_minor: act.amountMinor,
      currency: act.currency,
      note: "AI 助手记录",
      created_by: b.id,
    });
    check("confirm: settlement insert succeeds under RLS", !ins.error, ins.error?.message);
    const bal = await b.client.from("circle_balances").select("user_id, net_minor").eq("circle_id", circleId);
    const nets = Object.fromEntries((bal.data ?? []).map((r) => [r.user_id, r.net_minor]));
    check("confirm: balances settle to zero", nets[a.id] === 0 && nets[b.id] === 0, JSON.stringify(nets));
  }

  // ---- ai_settings kill switch forces the rule provider ----
  await admin.from("ai_settings").upsert({ circle_id: null, ai_enabled: false }, { onConflict: "circle_id" });
  const q3 = await a.client.functions.invoke("parse-expense", { body: { circleId, text: "打车 30" } });
  check("kill switch: provider is rule", q3.data?._provider === "rule", `_provider=${q3.data?._provider}`);
  await admin.from("ai_settings").delete().is("circle_id", null); // clean up for reruns

  console.log(`\n${failures === 0 ? "ALL PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
