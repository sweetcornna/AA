export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;

export function isInviteToken(value: string | null | undefined): value is string {
  return typeof value === "string" && INVITE_TOKEN_RE.test(value);
}

export function inviteLink(token: string): string {
  if (!isInviteToken(token)) throw new Error("invalid invitation token");
  return `aa://join?token=${encodeURIComponent(token)}`;
}

export function invitePathFromDeepLink(rawUrl: string): string | null {
  if (rawUrl.length > 256) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    url.protocol !== "aa:" ||
    url.username ||
    url.password ||
    url.hostname !== "join" ||
    url.port ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.hash ||
    [...url.searchParams.keys()].length !== 1
  ) {
    return null;
  }

  const token = url.searchParams.get("token");
  if (!isInviteToken(token)) return null;
  return `/join?token=${encodeURIComponent(token)}`;
}
