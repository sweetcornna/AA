// Provider registry. Resolution order (per the project plan):
//   ai_settings circle row > ai_settings global row > LLM_PROVIDER env > default.
// ai_enabled=false at either DB level is the kill switch → rule provider.
// A provider whose credentials are missing also falls back to rule, so the
// feature degrades instead of erroring. Adding a vendor = one implementation
// file + one entry in PROVIDERS.
import { claudeProvider } from "./claudeProvider.ts";
import { openaiProvider } from "./openaiProvider.ts";
import { ruleProvider } from "./ruleProvider.ts";
import type { LLMProvider } from "./types.ts";

const PROVIDERS: Record<string, LLMProvider> = {
  claude: claudeProvider,
  openai: openaiProvider,
  rule: ruleProvider,
};

export { ruleProvider };

interface AiSettingsRow {
  circle_id: string | null;
  llm_provider: string | null;
  ai_enabled: boolean;
}

/**
 * Pick the LLM provider for this request. `supabase` must be the caller's
 * RLS-scoped client (global row is readable by any signed-in user; circle rows
 * only by members). DB read errors are treated as "no settings".
 */
export async function resolveLLM(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  circleId: string | null,
): Promise<LLMProvider> {
  let rows: AiSettingsRow[] = [];
  try {
    let q = supabase.from("ai_settings").select("circle_id, llm_provider, ai_enabled");
    q = circleId ? q.or(`circle_id.eq.${circleId},circle_id.is.null`) : q.is("circle_id", null);
    const { data } = await q;
    rows = data ?? [];
  } catch {
    // table unreachable → behave as if unconfigured
  }

  const circleRow = circleId ? rows.find((r) => r.circle_id === circleId) : undefined;
  const globalRow = rows.find((r) => r.circle_id === null);

  if (circleRow?.ai_enabled === false || globalRow?.ai_enabled === false) return ruleProvider;

  const name =
    circleRow?.llm_provider ??
    globalRow?.llm_provider ??
    Deno.env.get("LLM_PROVIDER") ??
    "claude";

  const provider = PROVIDERS[name] ?? claudeProvider;
  return provider.available() ? provider : ruleProvider;
}
