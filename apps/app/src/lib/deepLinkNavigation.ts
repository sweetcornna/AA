import { invitePathFromDeepLink } from "./inviteLink";

export function firstNewInvitePath(
  urls: string[] | null,
  currentPath: string,
  startupEventPaths: ReadonlySet<string> | null = null,
  startupPath?: string,
): string | null {
  if (startupPath !== undefined && currentPath !== startupPath) return null;
  for (const rawUrl of urls ?? []) {
    const path = invitePathFromDeepLink(rawUrl);
    if (path && path !== currentPath && !startupEventPaths?.has(path))
      return path;
  }
  return null;
}
