#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { readApprovedTarget } from "./hosted-deployment.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function environmentConfiguration() {
  return {
    url: process.env.AA_SUPABASE_URL ?? "",
    publicKey: process.env.AA_SUPABASE_PUBLIC_KEY ?? "",
    otpEmail: process.env.AA_CANARY_OTP_EMAIL ?? "",
    passwordEmail: process.env.AA_CANARY_PASSWORD_EMAIL ?? "",
    password: process.env.AA_CANARY_PASSWORD ?? "",
    otp: process.env.AA_CANARY_OTP ?? "",
    audioFile: process.env.AA_CANARY_AUDIO_FILE ?? "",
    audioMime: process.env.AA_CANARY_AUDIO_MIME ?? "",
    targetsFile: process.env.AA_HOSTED_TARGETS_FILE,
  };
}

function jwtRole(value) {
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function requireProductionTarget(configuration) {
  const production = readApprovedTarget("production", configuration.targetsFile);
  if (configuration.url !== production.apiOrigin) {
    throw new Error("canary URL does not match the approved production origin");
  }
  if (
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(configuration.publicKey) &&
    jwtRole(configuration.publicKey) !== "anon"
  ) {
    throw new Error("a production publishable or anon key is required");
  }
  if (
    process.env.AA_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY
  ) {
    throw new Error("production canary must not receive a service-role key");
  }
  if (
    !configuration.otpEmail ||
    !configuration.passwordEmail ||
    configuration.otpEmail.trim().toLowerCase() === configuration.passwordEmail.trim().toLowerCase()
  ) {
    throw new Error("two distinct dedicated canary accounts are required");
  }
}

function productionClient(configuration) {
  return createClient(configuration.url, configuration.publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requireResult(label, result, predicate = (value) => Boolean(value)) {
  if (result.error || !predicate(result.data)) {
    throw new Error(`${label} failed: ${result.error?.message ?? "invalid response"}`);
  }
  console.log(`PASS ${label}`);
  return result.data;
}

async function requestOtp(configuration = environmentConfiguration()) {
  requireProductionTarget(configuration);
  const result = await productionClient(configuration).auth.signInWithOtp({
    email: configuration.otpEmail,
    options: { shouldCreateUser: false },
  });
  if (result.error) throw new Error(`OTP request failed: ${result.error.message}`);
  console.log("PASS existing-user OTP requested; retrieve the code through the approved private channel");
}

function audioFixture(configuration) {
  const filename = configuration.audioFile;
  const mime = configuration.audioMime;
  if (!filename || !new Set(["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]).has(mime)) {
    throw new Error("an approved audio fixture and MIME type are required");
  }
  const info = lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 8 * 1024 * 1024) {
    throw new Error("audio fixture must be a non-symlink regular file between 1 byte and 8 MiB");
  }
  return new Blob([readFileSync(filename)], { type: mime });
}

function waitForSubscription(channel) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 10_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timeout);
        reject(new Error(`Realtime subscription failed: ${status}`));
      }
    });
  });
}

function realtimeEventLatch() {
  let received = false;
  let resolveEvent;
  return {
    notify() {
      received = true;
      resolveEvent?.();
    },
    wait() {
      if (received) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Realtime event timed out")), 10_000);
        resolveEvent = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
    },
  };
}

export async function runCanary({
  configuration = environmentConfiguration(),
  makeClient = () => productionClient(configuration),
  createCircleId = randomUUID,
  createRunId = () => randomBytes(8).toString("hex"),
} = {}) {
  requireProductionTarget(configuration);
  if (!/^\d{6}$/.test(configuration.otp) || !configuration.password) {
    throw new Error("a six-digit OTP and password are required");
  }

  const owner = makeClient();
  const member = makeClient();
  const circleId = createCircleId();
  let circleMayExist = false;
  let channel = null;
  let failure = null;
  const runId = createRunId();

  try {
    const ownerAuth = requireResult(
      "OTP sign-in",
      await owner.auth.verifyOtp({ email: configuration.otpEmail, token: configuration.otp, type: "email" }),
      (data) => Boolean(data.session?.user),
    );
    const memberAuth = requireResult(
      "password sign-in",
      await member.auth.signInWithPassword({
        email: configuration.passwordEmail,
        password: configuration.password,
      }),
      (data) => Boolean(data.session?.user),
    );
    const ownerId = ownerAuth.session.user.id;
    const memberId = memberAuth.session.user.id;
    if (ownerId === memberId) throw new Error("canary accounts resolved to the same user");

    const anonymous = makeClient();
    const anonymousWrite = await anonymous.rpc("create_circle", {
      p_name: `AA-CANARY-${runId}`,
      p_description: `production-canary:${runId}`,
      p_currency: "CNY",
    });
    if (!anonymousWrite.error) throw new Error("anonymous create_circle unexpectedly succeeded");
    console.log("PASS anonymous RPC rejected");

    circleMayExist = true;
    requireResult(
      "create canary circle",
      await owner.rpc("create_canary_circle", {
        p_circle_id: circleId,
        p_run_id: runId,
      }),
      (data) => data?.id === circleId,
    );

    requireResult(
      "create owner-only expense",
      await owner.rpc("create_expense", {
        p_circle_id: circleId,
        p_payer_id: ownerId,
        p_amount_minor: 100,
        p_currency: "CNY",
        p_description: `canary-rls-${runId}`,
        p_category: "其他",
        p_spent_at: new Date().toISOString().slice(0, 10),
        p_split_type: "equal",
        p_splits: [{ user_id: ownerId, owed_minor: 100 }],
        p_source: "manual",
      }),
      (data) => Boolean(data?.id),
    );
    requireResult(
      "nonmember RLS denial",
      await member.from("expenses").select("id").eq("circle_id", circleId),
      (data) => Array.isArray(data) && data.length === 0,
    );

    const invitation = requireResult(
      "create invitation",
      await owner.rpc("create_invitation", {
        p_circle_id: circleId,
        p_role: "member",
        p_max_uses: 1,
      }),
      (data) => /^[A-Za-z0-9_-]{24}$/.test(data?.token ?? ""),
    );
    requireResult(
      "accept invitation",
      await member.rpc("accept_invitation", { p_token: invitation.token }),
      (data) => data === circleId,
    );

    const realtimeEvent = realtimeEventLatch();
    channel = member
      .channel(`canary-${runId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "expenses", filter: `circle_id=eq.${circleId}` },
        () => realtimeEvent.notify(),
      );
    await waitForSubscription(channel);
    console.log("PASS Realtime subscribed");

    requireResult(
      "create expense",
      await owner.rpc("create_expense", {
        p_circle_id: circleId,
        p_payer_id: ownerId,
        p_amount_minor: 100,
        p_currency: "CNY",
        p_description: `canary-${runId}`,
        p_category: "其他",
        p_spent_at: new Date().toISOString().slice(0, 10),
        p_split_type: "equal",
        p_splits: [
          { user_id: ownerId, owed_minor: 50 },
          { user_id: memberId, owed_minor: 50 },
        ],
        p_source: "manual",
      }),
      (data) => Boolean(data?.id),
    );
    await realtimeEvent.wait();
    console.log("PASS Realtime expense event");

    const memberExpenses = requireResult(
      "member RLS read",
      await member.from("expenses").select("id").eq("circle_id", circleId),
      (data) => Array.isArray(data) && data.length === 2,
    );
    if (memberExpenses.length !== 2) throw new Error("member expense count mismatch");

    requireResult(
      "create settlement",
      await member.rpc("create_settlement", {
        p_circle_id: circleId,
        p_from_user: memberId,
        p_to_user: ownerId,
        p_amount_minor: 50,
        p_currency: "CNY",
        p_note: `canary-${runId}`,
      }),
      (data) => Boolean(data?.id),
    );
    requireResult(
      "zero balances",
      await owner.from("circle_balances").select("net_minor").eq("circle_id", circleId),
      (data) => Array.isArray(data) && data.length === 2 && data.every((row) => Number(row.net_minor) === 0),
    );

    requireResult(
      "parse-expense function",
      await owner.functions.invoke("parse-expense", { body: { circleId, text: "打车 1 元" } }),
      (data) => data && !data.error && typeof data._provider === "string",
    );
    requireResult(
      "agent-query function",
      await member.functions.invoke("agent-query", { body: { question: "我现在还有欠款吗？" } }),
      (data) => data && typeof data.answer === "string" && data.answer.length > 0,
    );
    requireResult(
      "asr-transcribe function",
      await owner.functions.invoke("asr-transcribe", {
        body: audioFixture(configuration),
        headers: { "Content-Type": configuration.audioMime },
      }),
      (data) => data && typeof data.text === "string" && data.text.trim() && data.provider === "openai",
    );
  } catch (error) {
    failure = error;
  } finally {
    if (channel) await member.removeChannel(channel).catch(() => undefined);
    if (circleMayExist) {
      const cleanup = await owner.rpc("cleanup_canary_circle", {
        p_circle_id: circleId,
        p_run_id: runId,
      });
      if (cleanup.error || cleanup.data !== true) {
        const cleanupError = new Error(`canary cleanup failed: ${cleanup.error?.message ?? "invalid response"}`);
        failure = failure ? new AggregateError([failure, cleanupError], "canary and cleanup failed") : cleanupError;
      } else {
        console.log("PASS canary circle cleanup");
      }
    }
    await Promise.allSettled([owner.auth.signOut(), member.auth.signOut()]);
  }

  if (failure) throw failure;
  console.log("ALL PRODUCTION CANARY CHECKS PASSED");
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const mode = process.argv[2] ?? "";
  if (!new Set(["request-otp", "run"]).has(mode)) {
    console.error(`Usage: ${path.basename(process.argv[1])} <request-otp|run>`);
    process.exitCode = 2;
  } else {
    try {
      if (mode === "request-otp") await requestOtp();
      else await runCanary();
    } catch (error) {
      console.error("PRODUCTION CANARY FAILED", error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
