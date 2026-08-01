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

export function authErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
  if (status === 429 || /rate limit|too many/i.test(message)) return "操作太频繁，请稍后再试";
  if (/expired/i.test(message)) return "验证码已过期，请重新发送";
  if (/invalid.*otp|token.*invalid|otp.*invalid/i.test(message)) return "验证码不正确，请检查后重试";
  if (/invalid login credentials/i.test(message)) return "邮箱或密码不正确";
  return message || "操作失败，请稍后重试";
}
