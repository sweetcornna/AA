export interface SupabaseConfiguration {
  url: string;
  publishableKey: string;
}

export interface SupabaseConfigurationInput {
  url?: string;
  publishableKey?: string;
  legacyAnonKey?: string;
}

export type SupabaseConfigurationResult =
  | { configuration: SupabaseConfiguration; error: null }
  | { configuration: null; error: string };

const PRODUCTION_SUPABASE_ORIGIN = "https://api.cornna.xyz";

function jwtRole(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const parsed = JSON.parse(decoded) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

export function resolveSupabaseConfiguration(
  input: SupabaseConfigurationInput,
  production: boolean,
): SupabaseConfigurationResult {
  const url = input.url?.trim();
  const publishableKey = (input.publishableKey ?? input.legacyAnonKey)?.trim();

  if (!url || !publishableKey) {
    return { configuration: null, error: "缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_PUBLISHABLE_KEY" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { configuration: null, error: "VITE_SUPABASE_URL 不是有效 URL" };
  }

  const local = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (production && parsed.origin !== PRODUCTION_SUPABASE_ORIGIN) {
    return { configuration: null, error: `生产版本必须连接 ${PRODUCTION_SUPABASE_ORIGIN}` };
  }
  if (!production && parsed.protocol !== "https:" && !local) {
    return { configuration: null, error: "Supabase URL 必须使用 HTTPS（本地 loopback 开发除外）" };
  }
  if (
    (parsed.port && !local) ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    return { configuration: null, error: "VITE_SUPABASE_URL 必须是 Supabase 项目的根地址" };
  }
  if (/example|placeholder|your[-_]/i.test(`${url} ${publishableKey}`)) {
    return { configuration: null, error: "Supabase 公共配置仍是占位值" };
  }
  if (/^sb_secret_/i.test(publishableKey) || /service[_-]?role/i.test(publishableKey)) {
    return { configuration: null, error: "客户端配置不得使用 secret 或 service-role key" };
  }

  const canonicalUrl = parsed.origin;

  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    return { configuration: { url: canonicalUrl, publishableKey }, error: null };
  }

  const role = jwtRole(publishableKey);
  if (role === "service_role") {
    return { configuration: null, error: "客户端配置不得使用 secret 或 service-role key" };
  }
  if (role !== "anon") {
    return { configuration: null, error: "Supabase 公共 key 格式不正确" };
  }

  return { configuration: { url: canonicalUrl, publishableKey }, error: null };
}
