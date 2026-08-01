import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from "@supabase/supabase-js";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const ASR_CLIENT_TIMEOUT_MS = 55_000;
export const ASR_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;

type AsrMimeType = (typeof ASR_MIME_TYPES)[number];

const ASR_ERROR_MESSAGES: Record<string, string> = {
  audio_empty: "录音为空，请重试或直接输入文字。",
  audio_too_large: "录音超过 8 MiB 限制，请缩短后重试。",
  invalid_audio_type: "当前录音格式不受支持，请更新系统 WebView 或直接输入文字。",
  invalid_request: "录音请求无效，请重试。",
  not_authenticated: "登录已失效，请重新登录后再试。",
  quota_exceeded: "语音转写次数已达上限，请稍后再试或直接输入文字。",
  asr_not_configured: "云端语音服务尚未配置，请直接输入文字。",
  quota_unavailable: "语音服务暂时不可用，请稍后再试。",
  provider_rate_limited: "语音服务正忙，请稍后再试。",
  provider_unavailable: "语音服务暂时不可用，请稍后再试。",
  provider_timeout: "语音转写超时，请重试或直接输入文字。",
  transcription_failed: "语音转写失败，请重试或直接输入文字。",
};

function isAsrMimeType(value: string): value is AsrMimeType {
  return ASR_MIME_TYPES.includes(value as AsrMimeType);
}

async function httpErrorCode(error: FunctionsHttpError): Promise<string | null> {
  try {
    const body = await (error.context as Response).clone().json() as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

async function asrErrorMessage(error: unknown, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return "语音转写已取消";
  if (error instanceof FunctionsHttpError) {
    const code = await httpErrorCode(error);
    return (code && ASR_ERROR_MESSAGES[code]) || "语音转写失败，请稍后再试。";
  }
  if (error instanceof FunctionsRelayError) return "语音服务连接失败，请稍后再试。";
  if (error instanceof FunctionsFetchError) {
    const cause = error.context as { name?: unknown } | null;
    return cause?.name === "AbortError"
      ? "语音转写超时，请重试或直接输入文字。"
      : "网络不可用，请检查连接后重试。";
  }
  return "语音转写失败，请稍后再试。";
}

export async function transcribeAudioWithClient(
  client: SupabaseClient,
  blob: Blob,
  signal?: AbortSignal,
): Promise<{ text: string; provider: string }> {
  if (blob.size === 0) throw new Error(ASR_ERROR_MESSAGES.audio_empty);
  if (blob.size > MAX_AUDIO_BYTES) throw new Error(ASR_ERROR_MESSAGES.audio_too_large);
  if (!isAsrMimeType(blob.type)) throw new Error(ASR_ERROR_MESSAGES.invalid_audio_type);

  const { data, error } = await client.functions.invoke<{
    text?: unknown;
    provider?: unknown;
  }>("asr-transcribe", {
    body: blob,
    headers: { "Content-Type": blob.type },
    signal,
    timeout: ASR_CLIENT_TIMEOUT_MS,
  });
  if (error) throw new Error(await asrErrorMessage(error, signal));

  const text = typeof data?.text === "string" ? data.text.trim() : "";
  const provider = typeof data?.provider === "string" ? data.provider.trim() : "";
  if (!text || !provider) throw new Error(ASR_ERROR_MESSAGES.transcription_failed);
  return { text, provider: `cloud:${provider}` };
}
