export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;

export function isInviteToken(value: string | null | undefined): value is string {
  return typeof value === "string" && INVITE_TOKEN_RE.test(value);
}

/**
 * Build a shareable invitation link. With a hosted web build configured the link
 * is an ordinary https URL anyone can open (and any camera can scan); without one
 * the `aa://` scheme stays the only handler, so it remains the fallback.
 */
export function inviteLink(token: string, webOrigin: string | null = null): string {
  if (!isInviteToken(token)) throw new Error("invalid invitation token");
  const query = `token=${encodeURIComponent(token)}`;
  return webOrigin ? `${webOrigin}#/join?${query}` : `aa://join?${query}`;
}

function inviteTokenFromDeepLink(rawUrl: string): string | null {
  if (rawUrl.length > 256) return null;
  const match = /^aa:\/\/join\/?\?token=([A-Za-z0-9_-]{24})$/.exec(rawUrl);
  return match?.[1] ?? null;
}

export function invitePathFromDeepLink(rawUrl: string): string | null {
  const token = inviteTokenFromDeepLink(rawUrl);
  return token ? `/join?token=${encodeURIComponent(token)}` : null;
}

export function parseInviteInput(raw: string): string | null {
  const value = raw.trim();
  if (isInviteToken(value)) return value;
  return inviteTokenFromDeepLink(value);
}

export function invitationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (/invitation has been revoked/i.test(message)) {
    return "邀请已失效，请向圈子管理员获取新邀请";
  }
  if (/invitation has expired/i.test(message)) {
    return "邀请已过期，请向圈子管理员获取新邀请";
  }
  if (/invitation has no uses left/i.test(message)) {
    return "邀请使用次数已达上限，请向圈子管理员获取新邀请";
  }
  if (/invalid invitation/i.test(message)) {
    return "邀请码无效，请检查后重试";
  }
  if (/must be authenticated/i.test(message)) {
    return "登录状态已失效，请重新登录后再试";
  }
  if (/failed to fetch|network|timeout|timed out|load failed/i.test(message)) {
    return "网络连接失败，请检查网络后重试";
  }
  return "暂时无法加入圈子，请稍后重试";
}
