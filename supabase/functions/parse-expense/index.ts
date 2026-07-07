// parse-expense — natural language → structured expense (ParsedExpense).
// The LLM vendor comes from the provider registry (_shared/llm): ai_settings
// DB rows > LLM_PROVIDER env > Claude default, with the rule-based provider as
// the no-key / on-error floor so the flow always works. Runs as a Supabase
// Edge Function (Deno).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveLLM, ruleProvider } from "../_shared/llm/registry.ts";
import type { Member, ParseCtx } from "../_shared/llm/types.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function shanghaiToday(): string {
  // Edge runtime is UTC; shift +8h for Asia/Shanghai.
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { circleId, text } = await req.json().catch(() => ({}));
    if (!circleId || !text || typeof text !== "string") {
      return json({ error: "circleId and text are required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const { data: circle } = await supabase
      .from("circles")
      .select("default_currency")
      .eq("id", circleId)
      .maybeSingle();
    if (!circle) return json({ error: "circle not found or not a member" }, 403);

    const { data: members } = await supabase
      .from("circle_members")
      .select("user_id, profile:profiles(display_name)")
      .eq("circle_id", circleId);

    // deno-lint-ignore no-explicit-any
    const memberList: Member[] = (members ?? []).map((m: any) => ({
      id: m.user_id,
      name: Array.isArray(m.profile)
        ? m.profile[0]?.display_name ?? "成员"
        : m.profile?.display_name ?? "成员",
    }));

    const ctx: ParseCtx = {
      members: memberList,
      currentUserId: user.id,
      currency: (circle.default_currency as string) ?? "CNY",
      today: shanghaiToday(),
      categories: ["餐饮", "交通", "住宿", "购物", "娱乐", "其他"],
    };

    const provider = await resolveLLM(supabase, circleId);
    let parsed: Record<string, unknown>;
    let providerName = provider.name;
    try {
      parsed = await provider.parseExpense(text, ctx);
    } catch (_e) {
      // Graceful degrade: any provider failure falls back to rules.
      parsed = await ruleProvider.parseExpense(text, ctx);
      providerName = `${ruleProvider.name}(after-${provider.name}-error)`;
    }

    return json({ ...parsed, _provider: providerName }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
