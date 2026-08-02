#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir as readdirAsync, readFile as readFileAsync, stat as statAsync } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_TARGETS_FILE = path.join(ROOT_DIR, "supabase", "hosted-targets.json");
const EXPECTED_REGION = "japaneast";
const EXPECTED_DEPLOYMENT_TYPE = "self-hosted";
const EXPECTED_SERVER_ID = "azure-aa-40-115-207-13";
const DEPLOYMENT_MODES = new Set(["dual-stack", "single-stack"]);
const EXPECTED_ORIGINS = {
  staging: "https://aa-staging-api.cornna.xyz",
  production: "https://aa-api.cornna.xyz",
};
const EXPECTED_FUNCTIONS = ["agent-query", "asr-transcribe", "parse-expense"];
const SOURCE_PATHS = [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "docs/HOSTED_DEPLOYMENT.md",
  "infra/supabase-selfhost",
  "apps/app/src/lib/asrClient.ts",
  "apps/app/src/lib/supabaseConfiguration.ts",
  "scripts/hosted-deployment.mjs",
  "scripts/verify-backend.mjs",
  "scripts/verify-production-canary.mjs",
  "scripts/verify-production-public-key.mjs",
  "supabase/config.toml",
  "supabase/functions",
  "supabase/migrations",
  "supabase/templates",
];

function usage() {
  console.error(`Usage:
  node scripts/hosted-deployment.mjs validate-target <staging|production>
  node scripts/hosted-deployment.mjs api-origin <staging|production>
  node scripts/hosted-deployment.mjs stack-id <staging|production>
  node scripts/hosted-deployment.mjs deployment-mode
  node scripts/hosted-deployment.mjs fingerprint`);
}

function targetsFilePath() {
  return process.env.AA_HOSTED_TARGETS_FILE
    ? path.resolve(process.env.AA_HOSTED_TARGETS_FILE)
    : DEFAULT_TARGETS_FILE;
}

export function validateHostedTarget(target, environment) {
  if (!target || typeof target !== "object") {
    throw new Error(`${environment} target is missing`);
  }
  const deploymentType = target.deploymentType ?? "";
  const stackId = target.stackId ?? "";
  const serverId = target.serverId ?? "";
  const apiOrigin = target.apiOrigin ?? "";
  const region = target.region ?? "";
  if (deploymentType !== EXPECTED_DEPLOYMENT_TYPE) {
    throw new Error(`${environment} deploymentType must be exactly ${EXPECTED_DEPLOYMENT_TYPE}`);
  }
  if (!new RegExp(`^aa-${environment}-[a-z0-9-]+$`).test(stackId)) {
    throw new Error(`${environment} stackId must start with aa-${environment}-`);
  }
  if (serverId !== EXPECTED_SERVER_ID) {
    throw new Error(`${environment} serverId must be exactly ${EXPECTED_SERVER_ID}`);
  }
  if (region !== EXPECTED_REGION) {
    throw new Error(`${environment} region must be exactly ${EXPECTED_REGION}`);
  }

  let parsed;
  try {
    parsed = new URL(apiOrigin);
  } catch {
    throw new Error(`${environment} apiOrigin is invalid`);
  }
  const expectedOrigin = EXPECTED_ORIGINS[environment];
  if (
    parsed.origin !== expectedOrigin ||
    parsed.href !== `${expectedOrigin}/` ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${environment} apiOrigin must be exactly ${expectedOrigin}`);
  }

  return { environment, deploymentType, stackId, serverId, apiOrigin: expectedOrigin, region };
}

export function readApprovedTargets(filePath = targetsFilePath()) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read approved hosted targets from ${filePath}: ${detail}`);
  }
  let deploymentMode;
  if (parsed.schemaVersion === 2) {
    deploymentMode = "dual-stack";
  } else if (parsed.schemaVersion === 3) {
    if (!DEPLOYMENT_MODES.has(parsed.deploymentMode)) {
      throw new Error("hosted targets deploymentMode must be dual-stack or single-stack");
    }
    deploymentMode = parsed.deploymentMode;
  } else {
    throw new Error("hosted targets schemaVersion must be 2 or 3");
  }

  const production = validateHostedTarget(parsed.production, "production");
  if (deploymentMode === "single-stack") {
    if (Object.hasOwn(parsed, "staging")) {
      throw new Error("single-stack hosted targets must not define staging");
    }
    return { deploymentMode, production };
  }

  const staging = validateHostedTarget(parsed.staging, "staging");
  if (staging.stackId === production.stackId || staging.apiOrigin === production.apiOrigin) {
    throw new Error("staging and production targets must be different");
  }
  return { deploymentMode, staging, production };
}

export function readApprovedTarget(environment, filePath = targetsFilePath()) {
  if (!new Set(["staging", "production"]).has(environment)) {
    throw new Error("environment must be staging or production");
  }
  const targets = readApprovedTargets(filePath);
  if (!targets[environment]) {
    throw new Error(`${environment} target is unavailable in ${targets.deploymentMode} mode`);
  }
  return targets[environment];
}

async function collectFiles(relativePath) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  const info = await statAsync(absolutePath);
  if (info.isFile()) return [relativePath];

  const entries = await readdirAsync(absolutePath, { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (["node_modules", "__pycache__", ".DS_Store"].includes(entry.name) || entry.name.endsWith(".pyc")) continue;
    const child = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) collected.push(...await collectFiles(child));
    else if (entry.isFile()) collected.push(child);
  }
  return collected;
}

async function sha256File(relativePath) {
  const bytes = await readFileAsync(path.join(ROOT_DIR, relativePath));
  return createHash("sha256").update(bytes).digest("hex");
}

async function fingerprint() {
  const files = [];
  for (const sourcePath of SOURCE_PATHS) files.push(...await collectFiles(sourcePath));
  files.sort();

  const entries = [];
  for (const file of files) entries.push({ path: file, sha256: await sha256File(file) });
  const canonical = entries.map(({ path: file, sha256 }) => `${sha256}  ${file}\n`).join("");
  return {
    schemaVersion: 2,
    deploymentType: EXPECTED_DEPLOYMENT_TYPE,
    functions: EXPECTED_FUNCTIONS,
    bundleSha256: createHash("sha256").update(canonical).digest("hex"),
    files: entries,
  };
}

async function main() {
  const [command, argument, ...extra] = process.argv.slice(2);
  if (!command || extra.length) {
    usage();
    process.exitCode = 2;
    return;
  }

  if (command === "validate-target" && argument) {
    console.log(JSON.stringify(readApprovedTarget(argument), null, 2));
    return;
  }
  if (command === "api-origin" && argument) {
    console.log(readApprovedTarget(argument).apiOrigin);
    return;
  }
  if (command === "stack-id" && argument) {
    console.log(readApprovedTarget(argument).stackId);
    return;
  }
  if (command === "deployment-mode" && !argument) {
    console.log(readApprovedTargets().deploymentMode);
    return;
  }
  if (command === "fingerprint" && !argument) {
    console.log(JSON.stringify(await fingerprint(), null, 2));
    return;
  }

  usage();
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
