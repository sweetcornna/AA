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

  it("maps gateway, network, and server failures without exposing internals", () => {
    expect(authErrorMessage(Object.assign(new Error("Unauthorized"), { status: 401 }), "register")).toBe(
      "认证服务暂时不可用，请稍后再试",
    );
    expect(authErrorMessage(new TypeError("Failed to fetch"), "register")).toBe("网络连接失败，请稍后重试");
    expect(authErrorMessage(Object.assign(new Error("upstream failed"), { status: 503 }), "register")).toBe(
      "认证服务暂时不可用，请稍后再试",
    );
  });

  it("maps expected registration failures", () => {
    expect(authErrorMessage(new Error("User already registered"), "register")).toBe("该邮箱已注册，请直接登录");
    expect(authErrorMessage(new Error("Password should be at least 8 characters"), "register")).toBe(
      "密码强度不足，请设置更安全的密码",
    );
    expect(authErrorMessage(new Error("Invalid email"), "register")).toBe("请输入有效的邮箱地址");
  });

  it("preserves local Chinese validation errors but hides unknown remote messages", () => {
    expect(authErrorMessage(new Error("注册服务尚未配置为即时登录，请联系管理员"), "register")).toBe(
      "注册服务尚未配置为即时登录，请联系管理员",
    );
    expect(authErrorMessage(new Error("database error saving new user"), "register")).toBe("注册失败，请稍后重试");
    expect(authErrorMessage(new Error("数据库错误：profiles trigger failed"), "register")).toBe("注册失败，请稍后重试");
    expect(authErrorMessage(null)).toBe("操作失败，请稍后重试");
  });
});
