// asr-transcribe — audio → text (cloud ASR fallback for platforms where the
// browser Web Speech API is unavailable, e.g. iOS WKWebView / some webviews).
//
// Vendor-agnostic by design: the default implementation calls an
// OpenAI-compatible transcription endpoint (gpt-4o-transcribe / whisper-1) when
// OPENAI_API_KEY is set. Without a key it returns 501 with configured:false, so
// the client cleanly degrades to manual text entry — voice never blocks recording.
// Runs as a Supabase Edge Function (Deno). Anthropic has no speech API, so ASR is
// intentionally a separate provider from the Claude-powered parse-expense/agent-query.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function transcribeOpenAI(apiKey: string, bytes: Uint8Array, mimeType: string): Promise<string> {
  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType || "audio/webm" }), `audio.${ext}`);
  form.append("model", Deno.env.get("ASR_MODEL") ?? "gpt-4o-transcribe");
  form.append("language", "zh");
  const resp = await fetch((Deno.env.get("ASR_BASE_URL") ?? "https://api.openai.com/v1") + "/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`ASR provider error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return (data?.text as string) ?? "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { audioBase64, mimeType } = await req.json().catch(() => ({}));
    if (!audioBase64 || typeof audioBase64 !== "string") {
      return json({ error: "audioBase64 is required" }, 400);
    }

    // Require a signed-in caller (consistent with the other functions).
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return json({ error: "unauthorized" }, 401);

    const apiKey = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("ASR_API_KEY");
    if (!apiKey) {
      return json(
        { configured: false, error: "云端语音未配置（设置 OPENAI_API_KEY 启用）。可改用浏览器语音或直接输入文字。" },
        501,
      );
    }

    const bytes = b64ToBytes(audioBase64);
    const text = await transcribeOpenAI(apiKey, bytes, typeof mimeType === "string" ? mimeType : "audio/webm");
    return json({ text, configured: true, _provider: "openai" }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
