import { test } from "node:test";
import assert from "node:assert/strict";
import { brotliCompressSync } from "node:zlib";
import { verifyEmbeddedJavaScript } from "./verify-android-assets.mjs";

const entry = Buffer.from('import("./route.js"); const origin = "https://aa-api.cornna.xyz";');
const route = Buffer.from('export const description = "lazy expense route";');
const packed = [entry, route].map((value) => brotliCompressSync(value));
const native = Buffer.concat([Buffer.from("ELF"), ...packed]);

test("verifies small code-split assets without assuming a large main bundle", () => {
  const result = verifyEmbeddedJavaScript(native, packed, [entry, route]);
  assert.ok(result.includes(entry));
  assert.ok(result.includes(route));
});
test("rejects a missing lazy route even when the entry point is embedded", () => {
  assert.throws(() => verifyEmbeddedJavaScript(packed[0], packed, [entry, route]), /missing/);
});
test("rejects stale Cargo assets that do not match the current frontend build", () => {
  assert.throws(() => verifyEmbeddedJavaScript(native, packed, [Buffer.from("new build")]), /missing/);
});
test("does not accept only a matching compressed prefix", () => {
  const truncatedNative = packed[0].subarray(0, packed[0].length - 2);
  assert.throws(() => verifyEmbeddedJavaScript(truncatedNative, packed, [entry]), /no JavaScript/);
});
test("ignores unembedded old cache entries", () => {
  const stale = brotliCompressSync(Buffer.from("stale source"));
  const result = verifyEmbeddedJavaScript(native, [stale, ...packed], [entry, route]);
  assert.ok(!result.includes(Buffer.from("stale source")));
});
test("rejects empty current build and invalid embedded compression", () => {
  assert.throws(() => verifyEmbeddedJavaScript(native, packed, []), /no JavaScript/);
  const invalid = Buffer.from("not brotli");
  assert.throws(() => verifyEmbeddedJavaScript(invalid, [invalid], [entry]), /not valid Brotli/);
});
