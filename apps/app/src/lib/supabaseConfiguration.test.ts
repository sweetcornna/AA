import { describe, expect, it } from "vitest";
import { resolveSupabaseConfiguration } from "./supabaseConfiguration";

const HOSTED_URL = "https://aa-api.cornna.xyz";
const PUBLISHABLE_KEY = "sb_publishable_abc123";

function legacyJwt(role: string): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`;
}

describe("Supabase client configuration", () => {
  it("accepts the exact self-hosted production configuration", () => {
    expect(
      resolveSupabaseConfiguration({ url: HOSTED_URL, publishableKey: PUBLISHABLE_KEY }, true),
    ).toEqual({
      configuration: { url: HOSTED_URL, publishableKey: PUBLISHABLE_KEY },
      error: null,
    });
  });

  it("normalizes an allowed root URL to its canonical origin", () => {
    expect(
      resolveSupabaseConfiguration({ url: `${HOSTED_URL}/`, publishableKey: PUBLISHABLE_KEY }, true),
    ).toEqual({
      configuration: { url: HOSTED_URL, publishableKey: PUBLISHABLE_KEY },
      error: null,
    });
  });

  it("accepts a legacy anon JWT but rejects a service-role JWT", () => {
    expect(resolveSupabaseConfiguration({ url: HOSTED_URL, legacyAnonKey: legacyJwt("anon") }, true).error).toBeNull();
    expect(
      resolveSupabaseConfiguration({ url: HOSTED_URL, legacyAnonKey: legacyJwt("service_role") }, true).error,
    ).toMatch(/service-role/);
  });

  it("allows loopback HTTP only during development", () => {
    const input = { url: "http://127.0.0.1:54321", legacyAnonKey: legacyJwt("anon") };
    expect(resolveSupabaseConfiguration(input, false).error).toBeNull();
    expect(resolveSupabaseConfiguration(input, true).error).toMatch(/生产版本/);
  });

  it.each([
    ["missing values", {}, /缺少/],
    ["invalid URL", { url: "not a URL", publishableKey: PUBLISHABLE_KEY }, /有效 URL/],
    ["staging production URL", { url: "https://aa-staging-api.cornna.xyz", publishableKey: PUBLISHABLE_KEY }, /aa-api\.cornna\.xyz/],
    ["old Supabase Cloud URL", { url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: PUBLISHABLE_KEY }, /aa-api\.cornna\.xyz/],
    ["production IP URL", { url: "https://40.115.207.13", publishableKey: PUBLISHABLE_KEY }, /aa-api\.cornna\.xyz/],
    ["URL with a port", { url: `${HOSTED_URL}:8443`, publishableKey: PUBLISHABLE_KEY }, /aa-api\.cornna\.xyz/],
    ["URL with a path", { url: `${HOSTED_URL}/rest/v1`, publishableKey: PUBLISHABLE_KEY }, /根地址/],
    ["placeholder", { url: HOSTED_URL, publishableKey: "sb_publishable_your-key" }, /占位值/],
    ["secret key", { url: HOSTED_URL, publishableKey: "sb_secret_abc" }, /secret/],
    ["invalid key", { url: HOSTED_URL, publishableKey: "not-public" }, /格式不正确/],
  ])("rejects %s", (_label, input, error) => {
    expect(resolveSupabaseConfiguration(input, true).error).toMatch(error);
  });
});
