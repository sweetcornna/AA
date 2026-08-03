// Destructive end-to-end authorization check for the Supabase backend.
// Local mode uses the standard development keys. Hosted mode is staging-only,
// requires runtime credentials, and must be explicitly enabled.
//
// Local:  node scripts/verify-backend.mjs
// Staging: create an ignored schema-v3 dual-stack supabase/hosted-targets.json,
//          verify the two approved targets, then run:
//          AA_BACKEND_TEST_MODE=staging \
//          AA_SUPABASE_URL=https://aa-staging-api.cornna.xyz \
//          AA_SUPABASE_PUBLIC_KEY=<public-key> \
//          AA_SUPABASE_SERVICE_ROLE_KEY=<runtime-secret> \
//          node scripts/verify-backend.mjs
import { createClient } from "@supabase/supabase-js";
import { readApprovedTargets } from "./hosted-deployment.mjs";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXB" +
  "hYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SUPABASE_URL = process.env.AA_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? LOCAL_URL;
const MODE = process.env.AA_BACKEND_TEST_MODE ?? (SUPABASE_URL === LOCAL_URL ? "local" : "");
const ANON = process.env.AA_SUPABASE_PUBLIC_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? (MODE === "local" ? LOCAL_ANON : "");
const SERVICE = process.env.AA_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? (MODE === "local" ? LOCAL_SERVICE : "");

function assertSafeTarget() {
  const parsed = new URL(SUPABASE_URL);
  if (MODE === "local") {
    if (parsed.origin !== LOCAL_URL) throw new Error("local mode only permits the standard loopback Supabase URL");
    return;
  }
  if (MODE !== "staging") throw new Error("remote destructive tests require AA_BACKEND_TEST_MODE=staging");
  const { deploymentMode, staging, production } = readApprovedTargets();
  if (deploymentMode !== "dual-stack") throw new Error("remote destructive tests require an approved dual-stack target manifest");
  if (parsed.href !== `${staging.apiOrigin}/`) throw new Error("Supabase URL does not match the approved staging API origin");
  if (parsed.href === `${production.apiOrigin}/`) throw new Error("destructive tests must never target production");
  if (!ANON || !SERVICE) throw new Error("staging tests require public and service-role keys from the runtime environment");
}

assertSafeTarget();

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const createdUsers = [];
const createdCircles = [];
let failures = 0;

function check(label, condition, extra = "") {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}

function errorText(result) {
  return result.error?.message ?? "no error";
}

async function verifyPublicSignup() {
  const email = `aa-${runId}-signup@example.invalid`;
  const password = `Aa-${runId}-Signup!`;
  const client = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signup = await client.auth.signUp({
    email,
    password,
    options: { data: { display_name: "verify-signup" } },
  });
  if (signup.data.user?.id) createdUsers.push(signup.data.user.id);
  check(
    "public signup returns an immediate session",
    !signup.error && signup.data.user?.id === signup.data.session?.user?.id,
    signup.error?.message,
  );
  if (signup.error || !signup.data.user || !signup.data.session) {
    throw new Error(`public signup: ${signup.error?.message ?? "missing user or session"}`);
  }

  const userId = signup.data.user.id;
  const profile = await client.from("profiles").select("id").eq("id", userId).maybeSingle();
  check("public signup creates a profile", profile.data?.id === userId, profile.error?.message);
  const signOut = await client.auth.signOut();
  check("public signup session signs out", !signOut.error, signOut.error?.message);
  const signIn = await client.auth.signInWithPassword({ email, password });
  check(
    "public signup account signs in with password",
    !signIn.error && signIn.data.session?.user?.id === userId,
    signIn.error?.message,
  );
  if (signIn.error || signIn.data.session?.user?.id !== userId) {
    throw new Error(`public signup password sign-in: ${signIn.error?.message ?? "wrong user"}`);
  }
  await client.auth.signOut();
}

async function makeUser(tag) {
  const email = `aa-${runId}-${tag}@example.invalid`;
  const password = `Aa-${runId}-Password!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `verify-${tag}` },
  });
  if (error || !data.user) throw new Error(`createUser ${tag}: ${error?.message ?? "missing user"}`);
  createdUsers.push(data.user.id);

  const client = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn ${tag}: ${signIn.error.message}`);
  return { id: data.user.id, client };
}

async function expectRejected(label, promise) {
  const result = await promise;
  check(label, Boolean(result.error), errorText(result));
  return result;
}

function expenseArgs(circleId, payerId, splits, overrides = {}) {
  return {
    p_circle_id: circleId,
    p_payer_id: payerId,
    p_amount_minor: 10000,
    p_currency: "CNY",
    p_description: "verify expense",
    p_category: "测试",
    p_spent_at: "2026-07-29",
    p_split_type: "equal",
    p_splits: splits,
    p_source: "manual",
    p_raw_text: null,
    p_ai_provider: null,
    p_asr_provider: null,
    p_ai_confidence: null,
    p_ai_raw: null,
    ...overrides,
  };
}

async function cleanup() {
  for (const circleId of [...createdCircles].reverse()) {
    const result = await admin.from("circles").delete().eq("id", circleId);
    check(`cleanup deletes circle ${circleId}`, !result.error, result.error?.message);
  }
  for (const userId of [...createdUsers].reverse()) {
    const result = await admin.auth.admin.deleteUser(userId);
    check(`cleanup deletes auth user ${userId}`, !result.error, result.error?.message);
  }

  if (createdCircles.length) {
    const rows = await admin.from("circles").select("id").in("id", createdCircles);
    check("cleanup leaves no test circles", !rows.error && (rows.data ?? []).length === 0, rows.error?.message);
  }
  if (createdUsers.length) {
    const rows = await admin.from("profiles").select("id").in("id", createdUsers);
    check("cleanup leaves no test profiles", !rows.error && (rows.data ?? []).length === 0, rows.error?.message);
    for (const userId of createdUsers) {
      const authUser = await admin.auth.admin.getUserById(userId);
      check(
        `cleanup leaves no auth user ${userId}`,
        Boolean(authUser.error) || !authUser.data?.user,
        authUser.error?.message,
      );
    }
  }
}

async function main() {
  await verifyPublicSignup();
  const owner = await makeUser("owner");
  const debtor = await makeUser("debtor");
  const outsider = await makeUser("outsider");
  const contender = await makeUser("contender");

  const profile = await owner.client.from("profiles").select("id").eq("id", owner.id).maybeSingle();
  check("profile auto-created", profile.data?.id === owner.id, profile.error?.message);

  const circle = await owner.client.rpc("create_circle", {
    p_name: `verify-${runId}`,
    p_description: "authorization suite",
    p_currency: "CNY",
  });
  check("create_circle RPC", !circle.error && circle.data?.id, circle.error?.message);
  if (!circle.data?.id) throw new Error("create_circle did not return an id");
  const circleId = circle.data.id;
  createdCircles.push(circleId);

  const invite = await owner.client.rpc("create_invitation", {
    p_circle_id: circleId,
    p_role: "member",
    p_max_uses: 1,
  });
  check("create_invitation RPC", !invite.error && /^[A-Za-z0-9_-]{24}$/.test(invite.data?.token ?? ""), invite.error?.message);
  if (!invite.data?.token) throw new Error("create_invitation did not return a token");

  const join = await debtor.client.rpc("accept_invitation", { p_token: invite.data.token });
  check("accept_invitation joins member", !join.error && join.data === circleId, join.error?.message);
  const idempotent = await debtor.client.rpc("accept_invitation", { p_token: invite.data.token });
  check("accept_invitation is idempotent without consuming another use", !idempotent.error && idempotent.data === circleId, idempotent.error?.message);
  const exhausted = await contender.client.rpc("accept_invitation", { p_token: invite.data.token });
  check("max-use invitation rejects a different first-time member", Boolean(exhausted.error), errorText(exhausted));
  await expectRejected("malformed invitation token rejected before lookup", outsider.client.rpc("accept_invitation", { p_token: `${invite.data.token}!` }));

  const splits = [
    { user_id: owner.id, owed_minor: 5000 },
    { user_id: debtor.id, owed_minor: 5000 },
  ];
  const expense = await owner.client.rpc("create_expense", expenseArgs(circleId, owner.id, splits, {
    p_description: "火锅",
    p_source: "voice",
    p_raw_text: "昨天吃火锅100",
    p_ai_provider: "rule",
    p_asr_provider: "cloud:test",
    p_ai_confidence: 0.9,
    p_ai_raw: { amount: 100 },
  }));
  check("create_expense accepts valid AI audit payload", !expense.error && expense.data?.id, expense.error?.message);

  await expectRejected("anonymous cannot call create_circle", createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } }).rpc("create_circle", { p_name: "forged" }));
  await expectRejected("member cannot insert expense directly", debtor.client.from("expenses").insert({
    circle_id: circleId,
    payer_id: debtor.id,
    amount_minor: 1,
    currency: "CNY",
    split_type: "equal",
    created_by: debtor.id,
  }));
  await expectRejected("member cannot update an expense directly", owner.client.from("expenses").update({ amount_minor: 1 }).eq("id", expense.data?.id));
  await expectRejected("member cannot delete a split directly", owner.client.from("expense_splits").delete().eq("expense_id", expense.data?.id));
  await expectRejected("member cannot insert settlement directly", debtor.client.from("settlements").insert({
    circle_id: circleId,
    from_user: debtor.id,
    to_user: owner.id,
    amount_minor: 1,
    currency: "CNY",
    created_by: debtor.id,
  }));
  await expectRejected("owner cannot mutate membership directly", owner.client.from("circle_members").update({ role: "owner" }).eq("circle_id", circleId).eq("user_id", debtor.id));
  await expectRejected("owner cannot mutate invitation directly", owner.client.from("invitations").update({ used_count: 0 }).eq("id", invite.data.id));
  await expectRejected("member cannot insert a circle directly", debtor.client.from("circles").insert({ name: "forged", default_currency: "CNY", created_by: debtor.id }));

  await expectRejected("expense rejects mismatched split sum", owner.client.rpc("create_expense", expenseArgs(circleId, owner.id, [
    { user_id: owner.id, owed_minor: 5000 },
    { user_id: debtor.id, owed_minor: 4999 },
  ])));
  await expectRejected("expense rejects duplicate participants", owner.client.rpc("create_expense", expenseArgs(circleId, owner.id, [
    { user_id: owner.id, owed_minor: 5000 },
    { user_id: owner.id, owed_minor: 5000 },
  ])));
  await expectRejected("expense rejects nonmember participant", owner.client.rpc("create_expense", expenseArgs(circleId, owner.id, [
    { user_id: owner.id, owed_minor: 5000 },
    { user_id: outsider.id, owed_minor: 5000 },
  ])));
  await expectRejected("expense rejects negative owed amount", owner.client.rpc("create_expense", expenseArgs(circleId, owner.id, [
    { user_id: owner.id, owed_minor: -1 },
    { user_id: debtor.id, owed_minor: 10001 },
  ])));
  await expectRejected("expense rejects unknown split fields", owner.client.rpc("create_expense", expenseArgs(circleId, owner.id, [
    { user_id: owner.id, owed_minor: 5000, circle_id: circleId },
    { user_id: debtor.id, owed_minor: 5000 },
  ])));
  await expectRejected("expense rejects oversized description", owner.client.rpc("create_expense", expenseArgs(circleId, owner.id, splits, { p_description: "x".repeat(501) })));
  await expectRejected("nonmember cannot create expense", outsider.client.rpc("create_expense", expenseArgs(circleId, owner.id, splits)));

  await expectRejected("creditor cannot confirm debtor's payment", owner.client.rpc("create_settlement", {
    p_circle_id: circleId,
    p_from_user: debtor.id,
    p_to_user: owner.id,
    p_amount_minor: 5000,
    p_currency: "CNY",
  }));
  await expectRejected("debtor cannot settle to a nonmember", debtor.client.rpc("create_settlement", {
    p_circle_id: circleId,
    p_from_user: debtor.id,
    p_to_user: outsider.id,
    p_amount_minor: 5000,
    p_currency: "CNY",
  }));
  await expectRejected("settlement rejects nonpositive amount", debtor.client.rpc("create_settlement", {
    p_circle_id: circleId,
    p_from_user: debtor.id,
    p_to_user: owner.id,
    p_amount_minor: 0,
    p_currency: "CNY",
  }));

  const settlement = await debtor.client.rpc("create_settlement", {
    p_circle_id: circleId,
    p_from_user: debtor.id,
    p_to_user: owner.id,
    p_amount_minor: 5000,
    p_currency: "CNY",
    p_note: "verified payment",
  });
  check("debtor creates a valid settlement through RPC", !settlement.error && settlement.data?.created_by === debtor.id, settlement.error?.message);

  const balances = await owner.client.from("circle_balances").select("user_id, net_minor").eq("circle_id", circleId);
  const byUser = Object.fromEntries((balances.data ?? []).map((row) => [row.user_id, Number(row.net_minor)]));
  check("settlement returns both balances to zero", byUser[owner.id] === 0 && byUser[debtor.id] === 0, JSON.stringify(byUser));
  check("balances remain zero-sum", Object.values(byUser).reduce((sum, value) => sum + value, 0) === 0, JSON.stringify(byUser));

  const outsiderExpenses = await outsider.client.from("expenses").select("id").eq("circle_id", circleId);
  check("nonmember reads no circle expenses", !outsiderExpenses.error && (outsiderExpenses.data ?? []).length === 0, outsiderExpenses.error?.message);
  const memberExpenses = await debtor.client.from("expenses").select("id").eq("circle_id", circleId);
  check("member still reads RPC-created expenses", !memberExpenses.error && (memberExpenses.data ?? []).length === 1, memberExpenses.error?.message);

  await expectRejected(
    "anonymous cannot call list_activity",
    createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } })
      .rpc("list_activity", { p_scope: "all", p_limit: 25 }),
  );
  const outsiderActivity = await outsider.client.rpc("list_activity", { p_scope: "all", p_limit: 25 });
  check(
    "nonmember reads no circle activity",
    !outsiderActivity.error && (outsiderActivity.data ?? []).length === 0,
    outsiderActivity.error?.message,
  );

  const contenderMembership = await admin.from("circle_members").insert({
    circle_id: circleId,
    user_id: contender.id,
    role: "member",
  });
  check("activity fixtures add another member", !contenderMembership.error, contenderMembership.error?.message);

  const activityExpenses = await admin.from("expenses").insert([
    {
      circle_id: circleId,
      payer_id: owner.id,
      amount_minor: 100,
      currency: "CNY",
      description: "activity-unrelated-newest",
      category: "测试",
      spent_at: "2099-01-05",
      split_type: "exact",
      source: "manual",
      created_by: owner.id,
      created_at: "2099-01-05T00:00:00Z",
    },
    {
      circle_id: circleId,
      payer_id: owner.id,
      amount_minor: 100,
      currency: "CNY",
      description: "activity-zero-split",
      category: "测试",
      spent_at: "2099-01-02",
      split_type: "exact",
      source: "manual",
      created_by: owner.id,
      created_at: "2099-01-02T00:00:00Z",
    },
    {
      circle_id: circleId,
      payer_id: debtor.id,
      amount_minor: 200,
      currency: "CNY",
      description: "activity-payer",
      category: "测试",
      spent_at: "2099-01-01",
      split_type: "exact",
      source: "manual",
      created_by: owner.id,
      created_at: "2099-01-01T00:00:00Z",
    },
    {
      circle_id: circleId,
      payer_id: owner.id,
      amount_minor: 300,
      currency: "CNY",
      description: "activity-creator",
      category: "测试",
      spent_at: "2098-12-31",
      split_type: "exact",
      source: "manual",
      created_by: debtor.id,
      created_at: "2098-12-31T00:00:00Z",
    },
    {
      circle_id: circleId,
      payer_id: outsider.id,
      amount_minor: 400,
      currency: "CNY",
      description: "activity-hidden-profile",
      category: "测试",
      spent_at: "2098-12-30",
      split_type: "exact",
      source: "manual",
      created_by: owner.id,
      created_at: "2098-12-30T00:00:00Z",
    },
  ]).select("id, description");
  check(
    "activity expense fixtures created",
    !activityExpenses.error && (activityExpenses.data ?? []).length === 5,
    activityExpenses.error?.message,
  );
  const activityExpenseIds = Object.fromEntries(
    (activityExpenses.data ?? []).map((row) => [row.description, row.id]),
  );
  const activitySplits = await admin.from("expense_splits").insert([
    { expense_id: activityExpenseIds["activity-unrelated-newest"], circle_id: circleId, user_id: owner.id, owed_minor: 100 },
    { expense_id: activityExpenseIds["activity-zero-split"], circle_id: circleId, user_id: owner.id, owed_minor: 100 },
    { expense_id: activityExpenseIds["activity-zero-split"], circle_id: circleId, user_id: debtor.id, owed_minor: 0 },
    { expense_id: activityExpenseIds["activity-payer"], circle_id: circleId, user_id: owner.id, owed_minor: 200 },
    { expense_id: activityExpenseIds["activity-creator"], circle_id: circleId, user_id: owner.id, owed_minor: 300 },
    { expense_id: activityExpenseIds["activity-hidden-profile"], circle_id: circleId, user_id: owner.id, owed_minor: 400 },
  ]);
  check("activity split fixtures created", !activitySplits.error, activitySplits.error?.message);

  const activitySettlements = await admin.from("settlements").insert([
    {
      circle_id: circleId,
      from_user: owner.id,
      to_user: contender.id,
      amount_minor: 50,
      currency: "CNY",
      settled_at: "2099-01-04T00:00:00Z",
      created_by: owner.id,
    },
    {
      circle_id: circleId,
      from_user: owner.id,
      to_user: contender.id,
      amount_minor: 60,
      currency: "CNY",
      settled_at: "2098-12-29T00:00:00Z",
      created_by: debtor.id,
    },
  ]).select("id, amount_minor");
  check(
    "activity settlement fixtures created",
    !activitySettlements.error && (activitySettlements.data ?? []).length === 2,
    activitySettlements.error?.message,
  );
  const creatorOnlySettlement = (activitySettlements.data ?? [])
    .find((row) => Number(row.amount_minor) === 60)?.id;

  const debtorAll = await debtor.client.rpc("list_activity", { p_scope: "all", p_limit: 100 });
  const debtorMine = await debtor.client.rpc("list_activity", { p_scope: "mine", p_limit: 100 });
  const allRows = debtorAll.data ?? [];
  const mineRows = debtorMine.data ?? [];
  const allDescriptions = new Set(allRows.map((row) => row.description).filter(Boolean));
  const mineDescriptions = new Set(mineRows.map((row) => row.description).filter(Boolean));
  check("member sees unrelated expense in all", !debtorAll.error && allDescriptions.has("activity-unrelated-newest"), debtorAll.error?.message);
  check("mere membership does not include expense in mine", !debtorMine.error && !mineDescriptions.has("activity-unrelated-newest"), debtorMine.error?.message);
  check("positive split includes expense in mine", mineDescriptions.has("火锅"));
  check("zero split includes expense in mine", mineDescriptions.has("activity-zero-split"));
  check("payer includes expense in mine", mineDescriptions.has("activity-payer"));
  check("creator includes expense in mine", mineDescriptions.has("activity-creator"));
  check(
    "zero split amount remains distinct",
    mineRows.find((row) => row.description === "activity-zero-split")?.my_owed_minor === 0,
  );
  check(
    "activity role overlap does not duplicate rows",
    mineRows.filter((row) => row.description === "火锅").length === 1,
  );
  check(
    "settlement sender and recipient are included in mine",
    mineRows.some((row) => row.id === settlement.data?.id),
  );
  check(
    "legacy settlement creator is included in mine",
    Boolean(creatorOnlySettlement) && mineRows.some((row) => row.id === creatorOnlySettlement),
  );

  const ownerMine = await owner.client.rpc("list_activity", { p_scope: "mine", p_limit: 100 });
  check(
    "settlement recipient is included in mine",
    !ownerMine.error && (ownerMine.data ?? []).some((row) => row.id === settlement.data?.id),
    ownerMine.error?.message,
  );
  const hiddenProfile = (ownerMine.data ?? [])
    .find((row) => row.description === "activity-hidden-profile");
  check(
    "hidden profile does not remove activity row",
    Boolean(hiddenProfile) && hiddenProfile.payer_name === null,
  );

  const globalLimit = await debtor.client.rpc("list_activity", { p_scope: "all", p_limit: 2 });
  check(
    "activity applies one global order and limit",
    !globalLimit.error &&
      globalLimit.data?.[0]?.description === "activity-unrelated-newest" &&
      Number(globalLimit.data?.[1]?.amount_minor) === 50,
    globalLimit.error?.message,
  );
  const mineLimit = await debtor.client.rpc("list_activity", { p_scope: "mine", p_limit: 1 });
  check(
    "mine filtering occurs before global limit",
    !mineLimit.error && mineLimit.data?.[0]?.description === "activity-zero-split",
    mineLimit.error?.message,
  );
  await expectRejected(
    "list_activity rejects unknown scope",
    debtor.client.rpc("list_activity", { p_scope: "unknown", p_limit: 25 }),
  );

  const usageInsert = await debtor.client.from("asr_usage").insert({ user_id: debtor.id });
  check("client cannot write ASR usage directly", Boolean(usageInsert.error), errorText(usageInsert));
  const usageRead = await debtor.client.from("asr_usage").select("id");
  check("client cannot read ASR usage", Boolean(usageRead.error), errorText(usageRead));
  let quotaAccepted = 0;
  for (let i = 0; i < 11; i++) {
    const quota = await debtor.client.rpc("consume_asr_quota");
    const row = Array.isArray(quota.data) ? quota.data[0] : quota.data;
    if (!quota.error && row?.allowed) quotaAccepted++;
    if (i === 10) {
      check(
        "ASR quota rejects the 11th request in ten minutes",
        !quota.error && row?.allowed === false && Number(row.retry_after_seconds) > 0,
        quota.error?.message,
      );
    }
  }
  check("ASR quota atomically accepts exactly ten requests", quotaAccepted === 10, String(quotaAccepted));

  const concurrentQuota = await Promise.all(
    Array.from({ length: 11 }, () => contender.client.rpc("consume_asr_quota")),
  );
  const concurrentRows = concurrentQuota.map((quota) => ({
    error: quota.error,
    row: Array.isArray(quota.data) ? quota.data[0] : quota.data,
  }));
  const concurrentAccepted = concurrentRows.filter(({ error, row }) => !error && row?.allowed === true).length;
  const concurrentRejected = concurrentRows.filter(({ error, row }) => !error && row?.allowed === false).length;
  check(
    "ASR quota serializes eleven concurrent requests",
    concurrentAccepted === 10 && concurrentRejected === 1,
    `${concurrentAccepted} accepted, ${concurrentRejected} rejected`,
  );
}

try {
  await main();
} catch (error) {
  failures++;
  console.error("FATAL", error instanceof Error ? error.message : error);
} finally {
  await cleanup();
}

console.log(`\n${failures === 0 ? "ALL PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`);
process.exit(failures === 0 ? 0 : 1);
