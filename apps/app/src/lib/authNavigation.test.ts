import { describe, expect, it } from "vitest";
import { authErrorMessage, safeReturnPath } from "./authNavigation";

describe("auth navigation", () => {
  it("preserves a pending invitation path through registration", () => {
    expect(safeReturnPath("/join?token=AbCdEf0123456789_-xyZWvu")).toBe(
      "/join?token=AbCdEf0123456789_-xyZWvu",
    );
  });

  it.each([undefined, null, "", "https://example.com", "//example.com", "/\\example.com"])(
    "rejects unsafe return target %s",
    (value) => expect(safeReturnPath(value)).toBe("/"),
  );
});

describe("auth error messages", () => {
  it("maps expected OTP, credential, and rate-limit failures", () => {
    expect(authErrorMessage(Object.assign(new Error("rate limit exceeded"), { status: 429 }))).toBe(
      "操作太频繁，请稍后再试",
    );
    expect(authErrorMessage(new Error("OTP expired"))).toBe("验证码已过期，请重新发送");
    expect(authErrorMessage(new Error("Token invalid"))).toBe("验证码不正确，请检查后重试");
    expect(authErrorMessage(new Error("Invalid login credentials"))).toBe("邮箱或密码不正确");
  });

  it("does not expose an empty or non-error value", () => {
    expect(authErrorMessage(null)).toBe("操作失败，请稍后重试");
  });
});
