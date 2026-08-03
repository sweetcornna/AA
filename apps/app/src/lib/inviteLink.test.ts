import { describe, expect, it } from "vitest";
import { inviteLink, invitePathFromDeepLink, isInviteToken } from "./inviteLink";

const TOKEN = "AbCdEf0123456789_-xyZWvu";

describe("invitation links", () => {
  it("generates the installed-app invitation contract", () => {
    expect(isInviteToken(TOKEN)).toBe(true);
    expect(inviteLink(TOKEN)).toBe(`aa://join?token=${TOKEN}`);
  });

  it("prefers the hosted web build so any browser can open the invitation", () => {
    expect(inviteLink(TOKEN, "https://sweetcornna.github.io/AA/")).toBe(
      `https://sweetcornna.github.io/AA/#/join?token=${TOKEN}`,
    );
    // A build without a hosted counterpart keeps the custom-scheme contract.
    expect(inviteLink(TOKEN, null)).toBe(`aa://join?token=${TOKEN}`);
  });

  it("rejects invalid generated tokens", () => {
    for (const token of ["", "short", `${TOKEN}x`, "abcdefghijklmnopqrstuv!@"]) {
      expect(isInviteToken(token)).toBe(false);
      expect(() => inviteLink(token)).toThrow("invalid invitation token");
      expect(() => inviteLink(token, "https://sweetcornna.github.io/AA/")).toThrow(
        "invalid invitation token",
      );
    }
  });

  it("maps only the exact deep-link contract to the hash-router path", () => {
    expect(invitePathFromDeepLink(`aa://join?token=${TOKEN}`)).toBe(`/join?token=${TOKEN}`);
    expect(invitePathFromDeepLink(`aa://join/?token=${TOKEN}`)).toBe(`/join?token=${TOKEN}`);
  });

  it.each([
    ["wrong scheme", `https://join?token=${TOKEN}`],
    ["wrong host", `aa://other?token=${TOKEN}`],
    ["credentials", `aa://user@join?token=${TOKEN}`],
    ["port", `aa://join:123?token=${TOKEN}`],
    ["path", `aa://join/path?token=${TOKEN}`],
    ["fragment", `aa://join?token=${TOKEN}#fragment`],
    ["missing token", "aa://join"],
    ["extra parameter", `aa://join?token=${TOKEN}&source=share`],
    ["duplicate parameter", `aa://join?token=${TOKEN}&token=${TOKEN}`],
    ["malformed token", "aa://join?token=not-valid"],
    ["oversized URL", `aa://join?token=${TOKEN}${"x".repeat(240)}`],
  ])("rejects %s", (_label, value) => {
    expect(invitePathFromDeepLink(value)).toBeNull();
  });
});
