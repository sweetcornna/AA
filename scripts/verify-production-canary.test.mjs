import assert from "node:assert/strict";
import test from "node:test";
import { runCanary } from "./verify-production-canary.mjs";

const circleId = "00000000-0000-4000-8000-000000000001";
const runId = "0123456789abcdef";
const configuration = {
  url: "https://api.cornna.xyz",
  publicKey: "sb_publishable_canary_test",
  otpEmail: "owner@example.test",
  passwordEmail: "member@example.test",
  password: "verification-only",
  otp: "123456",
  audioFile: "",
  audioMime: "",
  targetsFile: new URL("../supabase/hosted-targets.example.json", import.meta.url).pathname,
};

function auth(userId, method) {
  return {
    [method]: async () => ({ data: { session: { user: { id: userId } } }, error: null }),
    signOut: async () => ({ error: null }),
  };
}

function anonymousClient() {
  return {
    rpc: async () => ({ data: null, error: { message: "permission denied", code: "42501" } }),
  };
}

test("cleans the preallocated circle after an ambiguous create response", async () => {
  const cleanupCalls = [];
  const owner = {
    auth: auth("00000000-0000-4000-8000-000000000011", "verifyOtp"),
    rpc: async (name, args) => {
      if (name === "create_canary_circle") {
        return { data: null, error: { message: "response lost after commit" } };
      }
      if (name === "cleanup_canary_circle") {
        cleanupCalls.push(args);
        return { data: true, error: null };
      }
      throw new Error(`unexpected owner RPC: ${name}`);
    },
  };
  const member = {
    auth: auth("00000000-0000-4000-8000-000000000022", "signInWithPassword"),
  };
  const clients = [owner, member, anonymousClient()];

  await assert.rejects(
    runCanary({
      configuration,
      makeClient: () => clients.shift(),
      createCircleId: () => circleId,
      createRunId: () => runId,
    }),
    /create canary circle failed: response lost after commit/,
  );
  assert.deepEqual(cleanupCalls, [{ p_circle_id: circleId, p_run_id: runId }]);
});

test("rejects nonmember expense visibility before creating an invitation", async () => {
  const operations = [];
  const owner = {
    auth: auth("00000000-0000-4000-8000-000000000011", "verifyOtp"),
    rpc: async (name, args) => {
      operations.push(name);
      if (name === "create_canary_circle") return { data: { id: circleId }, error: null };
      if (name === "create_expense") return { data: { id: "expense-id" }, error: null };
      if (name === "cleanup_canary_circle") return { data: true, error: null };
      if (name === "create_invitation") return { data: { token: "A".repeat(24) }, error: null };
      throw new Error(`unexpected owner RPC: ${name} ${JSON.stringify(args)}`);
    },
  };
  const member = {
    auth: auth("00000000-0000-4000-8000-000000000022", "signInWithPassword"),
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ id: "leaked-expense" }], error: null }),
      }),
    }),
  };
  const clients = [owner, member, anonymousClient()];

  await assert.rejects(
    runCanary({
      configuration,
      makeClient: () => clients.shift(),
      createCircleId: () => circleId,
      createRunId: () => runId,
    }),
    /nonmember RLS denial failed: invalid response/,
  );
  assert.deepEqual(operations, [
    "create_canary_circle",
    "create_expense",
    "cleanup_canary_circle",
  ]);
});
