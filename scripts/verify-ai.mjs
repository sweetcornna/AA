// Live end-to-end check of the AI layer against the local Supabase stack.
// Exercises parse-expense through the provider registry with
// no API key configured, so the rule provider (the always-available floor)
// parses text into a structured expense.
//
// Run: node scripts/verify-ai.mjs   (requires `supabase start`; the local
// stack serves supabase/functions/* on /functions/v1 automatically)
import { createClient } from "@supabase/supabase-js";

// These are the public Supabase local-development keys. This script uses the
// service role and mutates only test-circle ai_settings, so it is fail-closed to the
// loopback development stack and must never be pointed at a hosted environment.
const LOCAL_URL = "http://127.0.0.1:54321";
const TARGET_URL = process.env.VITE_SUPABASE_URL ?? LOCAL_URL;
if (new URL(TARGET_URL).origin !== LOCAL_URL) {
  throw new Error(
    `verify-ai.mjs is local-only; refusing to run against ${TARGET_URL}`,
  );
}
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(TARGET_URL, SERVICE, {
  auth: { persistSession: false },
});

let failures = 0;
const createdUsers = [];
const createdCircles = [];
function check(label, cond, extra = "") {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const rid = () => Math.random().toString(36).slice(2, 10);

async function makeUser(tag, displayName) {
  const email = `${tag}-${rid()}@test.local`;
  const password = "Password123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  createdUsers.push(data.user.id);
  const client = createClient(TARGET_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn ${tag}: ${signIn.error.message}`);
  await client
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", data.user.id);
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

  const circle = await a.client.rpc("create_circle", {
    p_name: "AI 测试圈",
    p_description: "",
    p_currency: "CNY",
  });
  if (circle.error) throw circle.error;
  const circleId = circle.data.id;
  createdCircles.push(circleId);
  const inv = await a.client.rpc("create_invitation", {
    p_circle_id: circleId,
  });
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
  check(
    "parse-expense responds",
    !parse.error && p && !p.error,
    parse.error?.message ?? p?.error,
  );
  check(
    "parse: provider reported",
    typeof p?._provider === "string",
    `_provider=${p?._provider}`,
  );
  check("parse: amount 300", p?.amount === 300, `got ${p?.amount}`);
  check("parse: category 餐饮", p?.category === "餐饮", `got ${p?.category}`);
  check(
    "parse: 昨天 → yesterday",
    p?.spentAt === isoDaysAgo(1),
    `got ${p?.spentAt} want ${isoDaysAgo(1)}`,
  );
  const pids = (p?.participants ?? []).map((x) => x.matchedMemberId);
  check(
    "parse: matched 我+Bob to member ids",
    pids.includes(a.id) && pids.includes(b.id),
    JSON.stringify(pids),
  );

  // ---- ai_settings kill switch forces the rule provider ----
  await admin
    .from("ai_settings")
    .upsert(
      { circle_id: circleId, ai_enabled: false },
      { onConflict: "circle_id" },
    );
  const q3 = await a.client.functions.invoke("parse-expense", {
    body: { circleId, text: "打车 30" },
  });
  check(
    "kill switch: provider is rule",
    q3.data?._provider === "rule",
    `_provider=${q3.data?._provider}`,
  );
  await admin.from("ai_settings").delete().eq("circle_id", circleId);

  console.log(
    `\n${failures === 0 ? "ALL PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`,
  );
}

try {
  await main();
} catch (error) {
  failures++;
  console.error("AI verification failed:", error.message);
} finally {
  for (const id of createdCircles) {
    const { error } = await admin.from("circles").delete().eq("id", id);
    if (error) {
      failures++;
      console.error("Circle cleanup failed:", error.message);
    }
  }
  for (const id of createdUsers) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      failures++;
      console.error("User cleanup failed:", error.message);
    }
  }
}
process.exitCode = failures ? 1 : 0;
