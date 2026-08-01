import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const PROVIDER_TIMEOUT_MS = 45_000;

interface Environment {
  get(name: string): string | undefined;
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

interface HandlerDependencies {
  env: Environment;
  fetch: typeof fetch;
  createClient: typeof createClient;
  now: () => number;
  requestId: () => string;
  setTimeout: (callback: () => void, milliseconds: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  log: (entry: Record<string, unknown>) => void;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm;codecs=opus": "webm",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
};

function response(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function errorResponse(code: string, status: number, headers?: HeadersInit) {
  return response({ code }, status, headers);
}

function normalizedMimeType(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  return normalized in MIME_EXTENSIONS ? normalized : null;
}

async function readAudio(req: Request): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function transcribeOpenAI(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  bytes: Uint8Array;
  mimeType: string;
  fetch: typeof fetch;
  setTimeout: HandlerDependencies["setTimeout"];
  clearTimeout: HandlerDependencies["clearTimeout"];
}): Promise<{ kind: "ok"; text: string } | { kind: "rate_limit" | "unavailable" | "timeout" | "failed" }> {
  const controller = new AbortController();
  const timer = input.setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const form = new FormData();
    const audioBuffer = input.bytes.buffer.slice(
      input.bytes.byteOffset,
      input.bytes.byteOffset + input.bytes.byteLength,
    ) as ArrayBuffer;
    form.append("file", new Blob([audioBuffer], { type: input.mimeType }), `audio.${MIME_EXTENSIONS[input.mimeType]}`);
    form.append("model", input.model);
    form.append("language", "zh");
    const providerResponse = await input.fetch(`${input.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (providerResponse.status === 429) return { kind: "rate_limit" };
    if (providerResponse.status >= 500) return { kind: "unavailable" };
    if (!providerResponse.ok) return { kind: "failed" };

    const data = await providerResponse.json().catch(() => null) as { text?: unknown } | null;
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    return text ? { kind: "ok", text } : { kind: "failed" };
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError"
      ? { kind: "timeout" }
      : { kind: "unavailable" };
  } finally {
    input.clearTimeout(timer);
  }
}

export function createAsrHandler(overrides: Partial<HandlerDependencies> = {}) {
  const dependencies: HandlerDependencies = {
    env: Deno.env,
    fetch,
    createClient,
    now: () => Date.now(),
    requestId: () => crypto.randomUUID(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    log: (entry) => console.log(JSON.stringify(entry)),
    ...overrides,
  };

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

    const requestId = dependencies.requestId();
    const startedAt = dependencies.now();
    let bytesCount = 0;
    let mimeType: string | null = null;
    let result = "internal_error";

    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!/^Bearer\s+\S+$/i.test(authHeader)) {
        result = "not_authenticated";
        return errorResponse(result, 401);
      }

      const supabaseUrl = dependencies.env.get("SUPABASE_URL");
      const publicKey = dependencies.env.get("SUPABASE_ANON_KEY") ?? dependencies.env.get("SUPABASE_PUBLISHABLE_KEY");
      if (!supabaseUrl || !publicKey) {
        result = "server_misconfigured";
        return errorResponse(result, 503);
      }
      const supabase = dependencies.createClient(supabaseUrl, publicKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        result = "not_authenticated";
        return errorResponse(result, 401);
      }

      mimeType = normalizedMimeType(req.headers.get("Content-Type"));
      if (!mimeType) {
        result = "invalid_audio_type";
        return errorResponse(result, 415);
      }
      const contentLength = Number(req.headers.get("Content-Length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
        result = "audio_too_large";
        return errorResponse(result, 413);
      }

      const apiKey = dependencies.env.get("OPENAI_API_KEY") ?? dependencies.env.get("ASR_API_KEY");
      if (!apiKey) {
        result = "asr_not_configured";
        return errorResponse(result, 501);
      }

      const audio = await readAudio(req);
      if (audio === null) {
        result = "audio_too_large";
        return errorResponse(result, 413);
      }
      bytesCount = audio.byteLength;
      if (bytesCount === 0) {
        result = "audio_empty";
        return errorResponse(result, 400);
      }

      const { data: quotaRows, error: quotaError } = await supabase.rpc("consume_asr_quota");
      const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;
      if (quotaError || !quota || typeof quota.allowed !== "boolean") {
        result = "quota_unavailable";
        return errorResponse(result, 503);
      }
      if (!quota.allowed) {
        result = "quota_exceeded";
        const retryAfter = Number.isInteger(quota.retry_after_seconds)
          ? String(Math.max(1, quota.retry_after_seconds))
          : "60";
        return errorResponse(result, 429, { "Retry-After": retryAfter });
      }

      const model = dependencies.env.get("ASR_MODEL") ?? "gpt-4o-transcribe";
      const providerResult = await transcribeOpenAI({
        apiKey,
        baseUrl: dependencies.env.get("ASR_BASE_URL") ?? "https://api.openai.com/v1",
        model,
        bytes: audio,
        mimeType,
        fetch: dependencies.fetch,
        setTimeout: dependencies.setTimeout,
        clearTimeout: dependencies.clearTimeout,
      });
      if (providerResult.kind === "rate_limit") {
        result = "provider_rate_limited";
        return errorResponse(result, 429);
      }
      if (providerResult.kind === "timeout") {
        result = "provider_timeout";
        return errorResponse(result, 504);
      }
      if (providerResult.kind === "unavailable") {
        result = "provider_unavailable";
        return errorResponse(result, 503);
      }
      if (providerResult.kind !== "ok") {
        result = "transcription_failed";
        return errorResponse(result, 502);
      }

      result = "ok";
      return response({ text: providerResult.text, provider: "openai" });
    } catch {
      result = "internal_error";
      return errorResponse(result, 500);
    } finally {
      dependencies.log({
        request_id: requestId,
        elapsed_ms: Math.max(0, dependencies.now() - startedAt),
        bytes: bytesCount,
        mime_type: mimeType,
        provider: "openai",
        model: dependencies.env.get("ASR_MODEL") ?? "gpt-4o-transcribe",
        result,
      });
    }
  };
}
