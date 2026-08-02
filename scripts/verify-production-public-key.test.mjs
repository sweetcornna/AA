import assert from "node:assert/strict";
import test from "node:test";
import { verifyProductionPublicKey } from "./verify-production-public-key.mjs";

const configuration = {
  url: "https://aa-api.cornna.xyz",
  publicKey: `sb_publishable_${"p".repeat(32)}`,
  targetsFile: new URL("../supabase/hosted-targets.example.json", import.meta.url).pathname,
};

function response(status) {
  return { ok: status >= 200 && status < 300, status };
}

test("verifies Auth, REST, and invalid-key rejection with the exact public key", async () => {
  const requests = [];
  await verifyProductionPublicKey({
    configuration,
    fetchImpl: async (url, options) => {
      requests.push({ url, apikey: options.headers.apikey });
      return response(requests.length === 3 ? 401 : 200);
    },
  });
  assert.deepEqual(requests, [
    { url: `${configuration.url}/auth/v1/health`, apikey: configuration.publicKey },
    { url: `${configuration.url}/rest/v1/profiles?select=id&limit=1`, apikey: configuration.publicKey },
    { url: `${configuration.url}/auth/v1/health`, apikey: "sb_publishable_invalid_release_probe" },
  ]);
});

test("fails closed when the publishable key is rejected", async () => {
  await assert.rejects(
    verifyProductionPublicKey({ configuration, fetchImpl: async () => response(401) }),
    /Auth probe failed with HTTP 401/,
  );
});

test("rejects legacy and malformed public keys before any request", async () => {
  let requested = false;
  await assert.rejects(
    verifyProductionPublicKey({
      configuration: { ...configuration, publicKey: "eyJlegacy" },
      fetchImpl: async () => {
        requested = true;
        return response(200);
      },
    }),
    /opaque production publishable key is required/,
  );
  assert.equal(requested, false);
});
