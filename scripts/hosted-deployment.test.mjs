import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

const script = new URL("./hosted-deployment.mjs", import.meta.url);
const productionCanary = new URL("./verify-production-canary.mjs", import.meta.url);
const temporaryDirectories = [];

const staging = {
  deploymentType: "self-hosted",
  stackId: "aa-staging-primary",
  serverId: "azure-aa-40-115-207-13",
  apiOrigin: "https://staging-api.cornna.xyz",
  region: "japaneast",
};
const production = {
  deploymentType: "self-hosted",
  stackId: "aa-production-primary",
  serverId: "azure-aa-40-115-207-13",
  apiOrigin: "https://api.cornna.xyz",
  region: "japaneast",
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function writeTargets(overrides = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "aa-hosted-targets-"));
  temporaryDirectories.push(directory);
  const file = path.join(directory, "targets.json");
  writeFileSync(file, JSON.stringify({ schemaVersion: 2, staging, production, ...overrides }));
  return file;
}

function run(args, targetsFile = writeTargets()) {
  return spawnSync(process.execPath, [script.pathname, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, AA_HOSTED_TARGETS_FILE: targetsFile },
  });
}

function jwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`;
}

function runCanary(overrides = {}) {
  return spawnSync(process.execPath, [productionCanary.pathname, "request-otp"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      AA_HOSTED_TARGETS_FILE: writeTargets(),
      AA_SUPABASE_URL: production.apiOrigin,
      AA_SUPABASE_PUBLIC_KEY: "sb_publishable_canary_test",
      AA_CANARY_OTP_EMAIL: "otp@example.test",
      AA_CANARY_PASSWORD_EMAIL: "password@example.test",
      ...overrides,
    },
  });
}

test("validates the exact approved staging target", () => {
  const result = run(["validate-target", "staging"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { environment: "staging", ...staging });
});

test("prints only approved origins and stack ids", () => {
  const origin = run(["api-origin", "production"]);
  assert.equal(origin.status, 0, origin.stderr);
  assert.equal(origin.stdout.trim(), production.apiOrigin);
  const stack = run(["stack-id", "staging"]);
  assert.equal(stack.status, 0, stack.stderr);
  assert.equal(stack.stdout.trim(), staging.stackId);
});

test("rejects production relabeled as staging", () => {
  const result = run(["validate-target", "staging"], writeTargets({ staging: production }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stackId must start|apiOrigin must be exactly/);
});

test("rejects a noncanonical origin", () => {
  const result = run(["validate-target", "staging"], writeTargets({
    staging: { ...staging, apiOrigin: `${staging.apiOrigin}/rest/v1` },
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /apiOrigin must be exactly/);
});

test("rejects ports, IP addresses, and old cloud origins", () => {
  for (const apiOrigin of [
    "https://staging-api.cornna.xyz:8443",
    "https://40.115.207.13",
    "https://abcdefghijklmnopqrst.supabase.co",
  ]) {
    const result = run(["validate-target", "staging"], writeTargets({
      staging: { ...staging, apiOrigin },
    }));
    assert.notEqual(result.status, 0, apiOrigin);
  }
});

test("rejects wrong deployment, server, and region identities", () => {
  for (const override of [
    { deploymentType: "cloud" },
    { serverId: "other-server" },
    { region: "southeastasia" },
  ]) {
    const result = run(["validate-target", "production"], writeTargets({
      production: { ...production, ...override },
    }));
    assert.notEqual(result.status, 0, JSON.stringify(override));
  }
});

test("rejects duplicate stack identities", () => {
  const result = run(["validate-target", "production"], writeTargets({
    production: { ...production, stackId: staging.stackId },
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must start|must be different/);
});

test("rejects a missing approved target file", () => {
  const result = run(["validate-target", "staging"], "/definitely/missing/targets.json");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not read approved hosted targets/);
});

test("production canary rejects a non-production origin before network access", () => {
  const result = runCanary({ AA_SUPABASE_URL: staging.apiOrigin });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /canary URL does not match the approved production origin/);
});

test("production canary rejects service-role credentials before network access", () => {
  for (const overrides of [
    { AA_SUPABASE_SERVICE_ROLE_KEY: "present" },
    { SUPABASE_SERVICE_ROLE_KEY: "present" },
    { SERVICE_ROLE_KEY: "present" },
    { SUPABASE_SERVICE_KEY: "present" },
    { AA_SUPABASE_PUBLIC_KEY: jwt("service_role") },
  ]) {
    const result = runCanary(overrides);
    assert.notEqual(result.status, 0, JSON.stringify(overrides));
    assert.match(result.stderr, /must not receive a service-role key|publishable or anon key/);
  }
});

test("produces a stable non-secret source fingerprint", () => {
  const first = run(["fingerprint"]);
  const second = run(["fingerprint"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);

  const result = JSON.parse(first.stdout);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.deploymentType, "self-hosted");
  assert.match(result.bundleSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.functions, ["agent-query", "asr-transcribe", "parse-expense"]);
  assert.ok(result.files.some((entry) => entry.path === "supabase/migrations/0011_production_canary_cleanup.sql"));
  assert.ok(result.files.some((entry) => entry.path === "scripts/verify-production-canary.mjs"));
  assert.ok(result.files.some((entry) => entry.path === "supabase/functions/asr-transcribe/handler.ts"));
  assert.ok(result.files.some((entry) => entry.path === "supabase/functions/deno.lock"));
  assert.ok(result.files.some((entry) => entry.path.startsWith("infra/supabase-selfhost/")));
  assert.ok(!result.files.some((entry) => entry.path === "supabase/hosted-targets.json"));
});
