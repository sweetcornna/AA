// Isolated local Supabase integration tests. Never accepts a hosted target.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const URL = "http://127.0.0.1:54321";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXB" +
  "hYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, options);
const anonymous = createClient(URL, ANON, options);
const users = [],
  circles = [];
let passed = 0;
function check(label, ok) {
  assert.ok(ok, label);
  console.log(`PASS ${label}`);
  passed++;
}
function data(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function user(name) {
  const email = `departure-${randomUUID()}@example.invalid`,
    password = `Aa-${randomUUID()}!`;
  const id = data(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    }),
  ).user.id;
  users.push(id);
  const client = createClient(URL, ANON, options);
  data(await client.auth.signInWithPassword({ email, password }));
  return { id, client };
}
async function circle(owner, name = "退出回归") {
  const c = data(await owner.client.rpc("create_circle", { p_name: name }));
  circles.push(c.id);
  return c.id;
}
async function invite(owner, id, role = "member") {
  return data(
    await owner.client.rpc("create_invitation", {
      p_circle_id: id,
      p_role: role,
    }),
  );
}
async function join(u, inv) {
  return data(await u.client.rpc("accept_invitation", { p_token: inv.token }));
}
function leave(u, id, successor) {
  return u.client.rpc("leave_circle", {
    p_circle_id: id,
    p_successor_user_id: successor ?? null,
  });
}
function expense(u, id, participant) {
  return u.client.rpc("create_expense", {
    p_circle_id: id,
    p_payer_id: u.id,
    p_amount_minor: 20000,
    p_currency: "CNY",
    p_description: "退出并发账单",
    p_category: "餐饮",
    p_spent_at: "2026-09-05",
    p_split_type: "equal",
    p_splits: [
      { user_id: u.id, owed_minor: 10000 },
      { user_id: participant.id, owed_minor: 10000 },
    ],
  });
}
try {
  const a = await user("圈主"),
    b = await user("小红"),
    c = await user("管理员"),
    outsider = await user("圈外人");
  const id = await circle(a);
  const invitation = await invite(a, id);
  await join(b, invitation);
  await join(c, await invite(a, id, "admin"));
  check(
    "anonymous cannot invoke departure",
    !!(await anonymous.rpc("leave_circle", { p_circle_id: id })).error,
  );
  check(
    "members cannot delete memberships directly",
    !!(
      await b.client
        .from("circle_members")
        .delete()
        .eq("circle_id", id)
        .eq("user_id", b.id)
    ).error,
  );
  check(
    "outsider receives no circle identity data",
    !!(
      await outsider.client.rpc("list_circle_participants", { p_circle_id: id })
    ).error,
  );
  check(
    "nonmembership retry reveals no circle data",
    data(await leave(outsider, id)).status === "already_left",
  );
  data(await expense(a, id, b));
  check(
    "positive balance blocks owner departure",
    (await leave(a, id, c.id)).error?.message === "balance_not_zero",
  );
  check(
    "negative balance blocks member departure",
    (await leave(b, id)).error?.message === "balance_not_zero",
  );
  data(
    await b.client.rpc("create_settlement", {
      p_circle_id: id,
      p_from_user: b.id,
      p_to_user: a.id,
      p_amount_minor: 10000,
      p_currency: "CNY",
    }),
  );
  check("settled member can leave", data(await leave(b, id)).status === "left");
  check(
    "repeat departure is idempotent",
    data(await leave(b, id)).status === "already_left",
  );
  check(
    "departed user cannot read circle",
    data(await b.client.from("circles").select("id").eq("id", id)).length === 0,
  );
  check(
    "departed user cannot read expenses",
    data(await b.client.from("expenses").select("id").eq("circle_id", id))
      .length === 0,
  );
  check(
    "departed user cannot query identities",
    !!(await b.client.rpc("list_circle_participants", { p_circle_id: id }))
      .error,
  );
  const people = data(
    await a.client.rpc("list_circle_participants", { p_circle_id: id }),
  );
  check(
    "historical display name preserved",
    people.some(
      (p) =>
        p.user_id === b.id && p.display_name === "小红" && p.active === false,
    ),
  );
  check(
    "historical projection excludes private profile fields",
    people.every((p) => !("email" in p) && !("phone" in p)),
  );
  check(
    "history and zero-sum balances retained",
    data(await a.client.from("expenses").select("id").eq("circle_id", id))
      .length === 1 &&
      data(
        await a.client
          .from("circle_balances")
          .select("net_minor")
          .eq("circle_id", id),
      ).every((x) => Number(x.net_minor) === 0),
  );
  check(
    "new expense cannot name a departed member",
    !!(await expense(a, id, b)).error,
  );
  check(
    "member can rejoin with a valid invitation",
    (await join(b, invitation)) === id,
  );
  check(
    "rejoining member has zero balance",
    data(
      await b.client
        .from("circle_balances")
        .select("net_minor")
        .eq("circle_id", id)
        .eq("user_id", b.id),
    )[0].net_minor === 0,
  );
  check(
    "owner must choose successor",
    (await leave(a, id)).error?.message === "successor_required",
  );
  check(
    "owner cannot select outsider",
    (await leave(a, id, outsider.id)).error?.message === "invalid_successor",
  );
  check(
    "owner cannot select self",
    (await leave(a, id, a.id)).error?.message === "invalid_successor",
  );
  check("administrator can leave", data(await leave(c, id)).status === "left");
  check(
    "departed successor rejected",
    (await leave(a, id, c.id)).error?.message === "invalid_successor",
  );
  check(
    "ownership transfer and departure succeed atomically",
    data(await leave(a, id, b.id)).status === "left",
  );
  check(
    "successor is sole owner",
    data(
      await b.client
        .from("circle_members")
        .select("user_id,role")
        .eq("circle_id", id),
    ).every((m) => m.user_id === b.id && m.role === "owner"),
  );
  check("new owner can invite", !!(await invite(b, id)).token);
  check("last member can leave", data(await leave(b, id)).status === "left");
  check(
    "empty circle retains ledger",
    data(await admin.from("circles").select("id").eq("id", id)).length === 1 &&
      data(await admin.from("expenses").select("id").eq("circle_id", id))
        .length === 1,
  );
  check(
    "empty circle revokes all invitations",
    data(
      await admin.from("invitations").select("revoked").eq("circle_id", id),
    ).every((i) => i.revoked),
  );
  check(
    "revoked invitation cannot revive empty circle",
    !!(await c.client.rpc("accept_invitation", { p_token: invitation.token }))
      .error,
  );
  for (let i = 0; i < 5; i++) {
    const concurrentCircle = await circle(a);
    const inv = await invite(a, concurrentCircle);
    await join(b, inv);
    const result = await Promise.all(
      i % 2
        ? [expense(a, concurrentCircle, b), leave(b, concurrentCircle)]
        : [leave(b, concurrentCircle), expense(a, concurrentCircle, b)],
    );
    check(
      `concurrent expense/departure ${i + 1}: exactly one succeeds`,
      result.filter((r) => !r.error).length === 1,
    );
    const live = data(
      await admin
        .from("circle_members")
        .select("user_id")
        .eq("circle_id", concurrentCircle),
    );
    const balances = data(
      await admin
        .from("circle_balances")
        .select("net_minor")
        .eq("circle_id", concurrentCircle),
    );
    check(
      `concurrent expense/departure ${i + 1}: balances stay zero-sum`,
      balances.reduce((s, x) => s + Number(x.net_minor), 0) === 0 &&
        balances.length === live.length,
    );
  }
  const paymentRace = await circle(a);
  await join(b, await invite(a, paymentRace));
  data(await expense(a, paymentRace, b));
  const paymentResults = await Promise.all([
    leave(b, paymentRace),
    b.client.rpc("create_settlement", {
      p_circle_id: paymentRace,
      p_from_user: b.id,
      p_to_user: a.id,
      p_amount_minor: 10000,
      p_currency: "CNY",
    }),
  ]);
  check(
    "concurrent settlement/departure records the payment",
    !paymentResults[1].error,
  );
  check(
    "settlement/departure retains zero-sum balances",
    data(
      await admin
        .from("circle_balances")
        .select("net_minor")
        .eq("circle_id", paymentRace),
    ).every((row) => Number(row.net_minor) === 0),
  );
  check(
    "settled member can retry departure after racing a payment",
    !(await leave(b, paymentRace)).error,
  );
  const invitationRace = await circle(a);
  await Promise.all([
    leave(a, invitationRace),
    a.client.rpc("create_invitation", { p_circle_id: invitationRace }),
  ]);
  check(
    "invite creation/departure leaves no live invitation in an empty circle",
    data(
      await admin
        .from("invitations")
        .select("revoked")
        .eq("circle_id", invitationRace),
    ).every((row) => row.revoked),
  );
  const race = await circle(a);
  const raceInvite = await invite(a, race);
  const admissions = await Promise.all([
    leave(a, race),
    c.client.rpc("accept_invitation", { p_token: raceInvite.token }),
  ]);
  check(
    "last departure vs admission: exactly one succeeds",
    admissions.filter((r) => !r.error).length === 1,
  );
  const raceMembers = data(
    await admin.from("circle_members").select("role").eq("circle_id", race),
  );
  check(
    "last departure vs admission leaves an owner or an empty circle",
    raceMembers.length === 0 || raceMembers.some((m) => m.role === "owner"),
  );
  const ownershipRace = await circle(a);
  await join(b, await invite(a, ownershipRace));
  await Promise.all([leave(a, ownershipRace, b.id), leave(b, ownershipRace)]);
  const finalMembers = data(
    await admin
      .from("circle_members")
      .select("role")
      .eq("circle_id", ownershipRace),
  );
  check(
    "successor departure race never strands members without owner",
    finalMembers.length === 0 || finalMembers.some((m) => m.role === "owner"),
  );
  console.log(`${passed} departure checks passed`);
} finally {
  for (const id of circles)
    data(await admin.from("circles").delete().eq("id", id));
  for (const id of users) data(await admin.auth.admin.deleteUser(id));
}
