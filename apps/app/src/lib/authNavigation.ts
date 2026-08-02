export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const parsed = new URL(value, "https://aa.invalid");
    if (parsed.origin !== "https://aa.invalid" || parsed.pathname !== value.split(/[?#]/, 1)[0]) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export type AuthOperation = "login" | "register";

const LOCAL_AUTH_MESSAGES = new Set(["注册服务尚未配置为即时登录，请联系管理员"]);

export function authErrorMessage(error: unknown, operation: AuthOperation = "login"): string {
  const message = error instanceof Error ? error.message : "";
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
  if (status === 429 || /rate limit|too many/i.test(message)) return "操作太频繁，请稍后再试";
  if (/expired/i.test(message)) return "验证码已过期，请重新发送";
  if (/invalid.*otp|token.*invalid|otp.*invalid/i.test(message)) return "验证码不正确，请检查后重试";
  if (/invalid login credentials/i.test(message)) return "邮箱或密码不正确";
  if (operation === "register" && /already registered|user already exists|already been registered/i.test(message)) {
    return "该邮箱已注册，请直接登录";
  }
  if (operation === "register" && /weak password|password.*(?:short|length)|at least \d+ characters/i.test(message)) {
    return "密码强度不足，请设置更安全的密码";
  }
  if (operation === "register" && /invalid email|email.*invalid/i.test(message)) return "请输入有效的邮箱地址";
  if (status === 401 || /^unauthorized$/i.test(message) || /invalid api key|no api key/i.test(message)) {
    return "认证服务暂时不可用，请稍后再试";
  }
  if (/failed to fetch|network|timeout|timed out|load failed/i.test(message)) return "网络连接失败，请稍后重试";
  if (status >= 500) return "认证服务暂时不可用，请稍后再试";
  if (LOCAL_AUTH_MESSAGES.has(message)) return message;
  return operation === "register" ? "注册失败，请稍后重试" : "操作失败，请稍后重试";
}
