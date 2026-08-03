import { describe, expect, it } from "vitest";
import {
  invitationErrorMessage,
  inviteLink,
  invitePathFromDeepLink,
  isInviteToken,
  parseInviteInput,
} from "./inviteLink";

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

  it("accepts a raw token or exact link from manual input", () => {
    expect(parseInviteInput(TOKEN)).toBe(TOKEN);
    expect(parseInviteInput(`  ${TOKEN}\n`)).toBe(TOKEN);
    expect(parseInviteInput(` aa://join?token=${TOKEN} `)).toBe(TOKEN);
    expect(parseInviteInput(`\naa://join/?token=${TOKEN}\t`)).toBe(TOKEN);
  });

  it.each([
    ["empty input", ""],
    ["short token", "AbCdEf0123456789_-xyZWv"],
    ["long token", `${TOKEN}x`],
    ["internal whitespace", `${TOKEN.slice(0, 12)} ${TOKEN.slice(12)}`],
    ["unicode lookalike", TOKEN.replace("A", "Ａ")],
    ["https link", `https://example.com/join?token=${TOKEN}`],
    ["wrong host", `aa://other?token=${TOKEN}`],
    ["extra query", `aa://join?token=${TOKEN}&source=copy`],
    ["duplicate token", `aa://join?token=${TOKEN}&token=${TOKEN}`],
    ["fragment", `aa://join?token=${TOKEN}#copy`],
    ["empty fragment", `aa://join?token=${TOKEN}#`],
    ["empty credentials", `aa://@join?token=${TOKEN}`],
    ["empty port", `aa://join:?token=${TOKEN}`],
    ["encoded parameter", `aa://join?%74oken=${TOKEN}`],
    ["empty extra query", `aa://join?token=${TOKEN}&`],
  ])("rejects %s from manual input", (_label, value) => {
    expect(parseInviteInput(value)).toBeNull();
  });

  it.each([
    ["invalid invitation", "邀请码无效，请检查后重试"],
    ["invitation has been revoked", "邀请已失效，请向圈子管理员获取新邀请"],
    ["invitation has expired", "邀请已过期，请向圈子管理员获取新邀请"],
    ["invitation has no uses left", "邀请使用次数已达上限，请向圈子管理员获取新邀请"],
    ["must be authenticated", "登录状态已失效，请重新登录后再试"],
    ["Failed to fetch", "网络连接失败，请检查网络后重试"],
    ["request timed out", "网络连接失败，请检查网络后重试"],
  ])("maps invitation error %s", (message, expected) => {
    expect(invitationErrorMessage(new Error(message))).toBe(expected);
  });

  it("hides unknown invitation errors", () => {
    expect(invitationErrorMessage(new Error("database internals"))).toBe("暂时无法加入圈子，请稍后重试");
    expect(invitationErrorMessage("invalid invitation")).toBe("暂时无法加入圈子，请稍后重试");
  });
});
