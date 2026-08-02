#!/usr/bin/env node
import process from "node:process";
import { readApprovedTarget } from "./hosted-deployment.mjs";

function configurationFromEnvironment() {
  return {
    url: process.env.AA_SUPABASE_URL ?? "",
    publicKey: process.env.AA_SUPABASE_PUBLIC_KEY ?? "",
    targetsFile: process.env.AA_HOSTED_TARGETS_FILE,
  };
}

export function requireProductionPublicKey(configuration) {
  const production = readApprovedTarget("production", configuration.targetsFile);
  if (configuration.url !== production.apiOrigin) {
    throw new Error("public-key probe URL does not match the approved production origin");
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(configuration.publicKey)) {
    throw new Error("an opaque production publishable key is required");
  }
}

// The gateway is what this probe verifies, not the database. Migration 0009
// revokes every public table privilege from anon, so a correctly translated key
// still reaches PostgREST and is refused there. Only a Kong key-auth rejection,
// which never carries a PostgREST error code, means the build key is unusable.
async function reachedUpstream(response) {
  if (response.ok) return true;
  const body = await response.json().catch(() => null);
  return typeof body?.code === "string";
}

async function request(fetchImpl, url, key) {
  return fetchImpl(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
}

export async function verifyProductionPublicKey({
  configuration = configurationFromEnvironment(),
  fetchImpl = fetch,
} = {}) {
  requireProductionPublicKey(configuration);
  const auth = await request(fetchImpl, `${configuration.url}/auth/v1/health`, configuration.publicKey);
  if (!auth.ok) throw new Error(`production publishable key Auth probe failed with HTTP ${auth.status}`);

  const rest = await request(
    fetchImpl,
    `${configuration.url}/rest/v1/profiles?select=id&limit=1`,
    configuration.publicKey,
  );
  if (!(await reachedUpstream(rest))) {
    throw new Error(`production publishable key REST probe was rejected by the gateway with HTTP ${rest.status}`);
  }

  const invalid = await request(
    fetchImpl,
    `${configuration.url}/auth/v1/health`,
    "sb_publishable_invalid_release_probe",
  );
  if (invalid.status !== 401) {
    throw new Error(`production invalid-key probe returned HTTP ${invalid.status} instead of 401`);
  }
  console.log("PASS production publishable-key gateway contract");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  verifyProductionPublicKey().catch((error) => {
    console.error(error instanceof Error ? error.message : "production public-key probe failed");
    process.exitCode = 1;
  });
}
