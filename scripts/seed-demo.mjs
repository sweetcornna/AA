// Seed a small demo circle so screenshots show a populated, working UI.
// Idempotent-ish: reuses the demo users / circle / expense if already present.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function ensureUser(email, password, displayName) {
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error && !/already|registered|exists/i.test(error.message)) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  await client.from("profiles").update({ display_name: displayName }).eq("id", data.user.id);
  return { id: data.user.id, client };
}

const demo = await ensureUser("demo@aa.local", "Password123!", "阿明");
const friend = await ensureUser("xiaohong@aa.local", "Password123!", "小红");

let circleId;
const existing = await demo.client.from("circles").select("id").eq("name", "周末聚餐").limit(1);
if (existing.data?.length) {
  circleId = existing.data[0].id;
} else {
  const r = await demo.client.rpc("create_circle", {
    p_name: "周末聚餐",
    p_description: "同事周末聚餐 AA",
    p_currency: "CNY",
  });
  if (r.error) throw r.error;
  circleId = r.data.id;
}

const member = await friend.client.from("circle_members").select("id").eq("circle_id", circleId);
if (!member.data?.length) {
  const inv = await demo.client.rpc("create_invitation", { p_circle_id: circleId });
  if (inv.error) throw inv.error;
  const j = await friend.client.rpc("accept_invitation", { p_token: inv.data.token });
  if (j.error) throw j.error;
}

const exp = await demo.client.from("expenses").select("id").eq("circle_id", circleId);
if (!exp.data?.length) {
  const r = await demo.client.rpc("create_expense", {
    p_circle_id: circleId,
    p_payer_id: demo.id,
    p_amount_minor: 20000,
    p_currency: "CNY",
    p_description: "火锅",
    p_category: "餐饮",
    p_spent_at: "2026-06-22",
    p_split_type: "equal",
    p_splits: [
      { user_id: demo.id, owed_minor: 10000 },
      { user_id: friend.id, owed_minor: 10000 },
    ],
    p_source: "manual",
    p_raw_text: null,
  });
  if (r.error) throw r.error;
}

console.log("seeded: demo@aa.local / Password123! — circle", circleId);
