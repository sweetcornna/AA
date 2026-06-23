// Live end-to-end backend check against the local Supabase stack.
// Verifies: profile auto-provisioning, create_circle / create_invitation /
// accept_invitation / create_expense RPCs, the circle_balances view, the
// split-sum guard, and RLS isolation for a non-member.
//
// Run: node scripts/verify-backend.mjs   (requires `supabase start`)
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
function rid() {
  return Math.random().toString(36).slice(2, 10);
}

async function makeUser(tag) {
  const email = `${tag}-${rid()}@test.local`;
  const password = "Password123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn ${tag}: ${signIn.error.message}`);
  return { id: data.user.id, email, client };
}

async function main() {
  const a = await makeUser("alice");
  const b = await makeUser("bob");
  const c = await makeUser("carol");

  // profile auto-provisioned by trigger (check via admin to isolate from RLS)
  const adminProf = await admin.from("profiles").select("id").eq("id", a.id).maybeSingle();
  check("profile auto-created on signup (admin view)", adminProf.data?.id === a.id, adminProf.error?.message);
  const prof = await a.client.from("profiles").select("id").eq("id", a.id).maybeSingle();
  check("A can read own profile (RLS)", prof.data?.id === a.id, prof.error?.message ?? `data=${JSON.stringify(prof.data)}`);

  // A creates a circle
  const circleRes = await a.client.rpc("create_circle", {
    p_name: "测试圈",
    p_description: "verify",
    p_currency: "CNY",
  });
  check("create_circle RPC", !circleRes.error && circleRes.data?.id, circleRes.error?.message);
  const circleId = circleRes.data.id;

  // A is owner member
  const mem = await a.client.from("circle_members").select("role").eq("circle_id", circleId);
  check("creator is owner member", mem.data?.some((m) => m.role === "owner"), mem.error?.message ?? `rows=${mem.data?.length}`);

  // A invites, B accepts
  const inv = await a.client.rpc("create_invitation", { p_circle_id: circleId });
  check("create_invitation RPC", !inv.error && inv.data?.token, inv.error?.message);
  const join = await b.client.rpc("accept_invitation", { p_token: inv.data.token });
  check("accept_invitation joins circle", !join.error && join.data === circleId, join.error?.message);

  // B is now a member (RLS lets B read the circle)
  const bCircle = await b.client.from("circles").select("id").eq("id", circleId).maybeSingle();
  check("B can read circle after joining", bCircle.data?.id === circleId);

  // A records a 100.00 expense split equally between A and B
  const exp = await a.client.rpc("create_expense", {
    p_circle_id: circleId,
    p_payer_id: a.id,
    p_amount_minor: 10000,
    p_currency: "CNY",
    p_description: "火锅",
    p_category: "餐饮",
    p_spent_at: "2026-06-22",
    p_split_type: "equal",
    p_splits: [
      { user_id: a.id, owed_minor: 5000 },
      { user_id: b.id, owed_minor: 5000 },
    ],
    p_source: "manual",
    p_raw_text: null,
  });
  check("create_expense RPC", !exp.error && exp.data?.id, exp.error?.message);

  // split-sum guard: wrong sum must be rejected
  const bad = await a.client.rpc("create_expense", {
    p_circle_id: circleId,
    p_payer_id: a.id,
    p_amount_minor: 10000,
    p_currency: "CNY",
    p_description: "bad",
    p_category: null,
    p_spent_at: "2026-06-22",
    p_split_type: "equal",
    p_splits: [
      { user_id: a.id, owed_minor: 5000 },
      { user_id: b.id, owed_minor: 4999 },
    ],
  });
  check("create_expense rejects mismatched split sum", !!bad.error, bad.error?.message ?? "no error!");

  // balances: A +5000, B -5000
  const bal = await a.client.from("circle_balances").select("user_id, net_minor").eq("circle_id", circleId);
  const byUser = Object.fromEntries((bal.data ?? []).map((r) => [r.user_id, r.net_minor]));
  check("balance: payer A is +5000", byUser[a.id] === 5000, `got ${byUser[a.id]}`);
  check("balance: B is -5000", byUser[b.id] === -5000, `got ${byUser[b.id]}`);
  check("balances sum to zero", Object.values(byUser).reduce((s, v) => s + v, 0) === 0);

  // RLS: non-member C sees nothing
  const cExp = await c.client.from("expenses").select("id").eq("circle_id", circleId);
  check("RLS: non-member C sees 0 expenses", (cExp.data ?? []).length === 0, `saw ${cExp.data?.length}`);
  const cCircle = await c.client.from("circles").select("id").eq("id", circleId);
  check("RLS: non-member C cannot read the circle", (cCircle.data ?? []).length === 0);

  console.log(`\n${failures === 0 ? "ALL PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
