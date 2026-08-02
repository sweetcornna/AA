import assert from "node:assert/strict";
import test from "node:test";
import { verifyProductionPublicKey } from "./verify-production-public-key.mjs";

const configuration = {
  url: "https://aa-api.cornna.xyz",
  publicKey: `sb_publishable_${"p".repeat(32)}`,
  targetsFile: new URL("../supabase/hosted-targets.example.json", import.meta.url).pathname,
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  };
}

// Kong rejects an unknown key before routing; PostgREST always answers with an
// error code. Migration 0009 leaves anon without table privileges, so 42501 is
// the expected upstream answer for a correctly translated key.
const KONG_REJECTION = { message: "Unauthorized", request_id: "probe" };
const POSTGREST_DENIAL = { code: "42501", message: "permission denied for table profiles" };

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

test("accepts the upstream privilege denial that anon is expected to receive", async () => {
  let call = 0;
  await verifyProductionPublicKey({
    configuration,
    fetchImpl: async () => {
      call += 1;
      if (call === 2) return response(401, POSTGREST_DENIAL);
      return response(call === 3 ? 401 : 200);
    },
  });
});

test("fails closed when the gateway itself rejects the key on the REST route", async () => {
  let call = 0;
  await assert.rejects(
    verifyProductionPublicKey({
      configuration,
      fetchImpl: async () => {
        call += 1;
        if (call === 2) return response(401, KONG_REJECTION);
        return response(call === 3 ? 401 : 200);
      },
    }),
    /REST probe was rejected by the gateway with HTTP 401/,
  );
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
