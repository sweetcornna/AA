// Pure validation for the hosted web build's public URL, shared by the Vite
// build (fail-closed on a bad value) and the client bundle. Runtime access goes
// through ./web, which is the only place that reads import.meta.env.

export interface WebOriginResult {
  origin: string | null;
  error: string | null;
}

/**
 * Normalize the public URL of the hosted web build (e.g. `https://user.github.io/AA/`)
 * to an origin plus a trailing-slash path. An empty value is valid: builds with no
 * hosted counterpart fall back to the `aa://` scheme for invitations.
 */
export function resolveWebOrigin(value: string | null | undefined): WebOriginResult {
  const raw = value?.trim();
  if (!raw) return { origin: null, error: null };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { origin: null, error: "VITE_WEB_ORIGIN 不是有效 URL" };
  }

  if (parsed.protocol !== "https:") {
    return { origin: null, error: "VITE_WEB_ORIGIN 必须使用 HTTPS" };
  }
  if (parsed.username || parsed.password) {
    return { origin: null, error: "VITE_WEB_ORIGIN 不得包含用户名或密码" };
  }
  if (parsed.search || parsed.hash) {
    return { origin: null, error: "VITE_WEB_ORIGIN 不得包含查询串或 # 片段" };
  }
  if (/example|placeholder|your[-_]/i.test(raw)) {
    return { origin: null, error: "VITE_WEB_ORIGIN 仍是占位值" };
  }

  const path = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  return { origin: `${parsed.origin}${path}`, error: null };
}
