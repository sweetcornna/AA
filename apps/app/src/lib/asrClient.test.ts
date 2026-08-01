import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  ASR_CLIENT_TIMEOUT_MS,
  MAX_AUDIO_BYTES,
  transcribeAudioWithClient,
} from "./asrClient";

function clientWithResult(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn(async () => result);
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke };
}

describe("ASR client", () => {
  it("uploads the Blob as binary with exact MIME and one timeout", async () => {
    const { client, invoke } = clientWithResult({ data: { text: " 火锅 360 ", provider: "openai" }, error: null });
    const blob = new Blob(["audio"], { type: "audio/webm;codecs=opus" });
    const controller = new AbortController();

    await expect(transcribeAudioWithClient(client, blob, controller.signal)).resolves.toEqual({
      text: "火锅 360",
      provider: "cloud:openai",
    });
    expect(invoke).toHaveBeenCalledWith("asr-transcribe", {
      body: blob,
      headers: { "Content-Type": "audio/webm;codecs=opus" },
      signal: controller.signal,
      timeout: ASR_CLIENT_TIMEOUT_MS,
    });
  });

  it("rejects empty, oversized, and unsupported audio before invoking", async () => {
    const { client, invoke } = clientWithResult({ data: null, error: null });
    await expect(transcribeAudioWithClient(client, new Blob([], { type: "audio/webm" }))).rejects.toThrow("录音为空");
    await expect(
      transcribeAudioWithClient(client, new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: "audio/webm" })),
    ).rejects.toThrow("8 MiB");
    await expect(transcribeAudioWithClient(client, new Blob(["x"], { type: "audio/wav" }))).rejects.toThrow("格式");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("maps structured HTTP errors without exposing server bodies", async () => {
    const response = new Response(JSON.stringify({ code: "quota_exceeded", secret: "do-not-leak" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
    const { client } = clientWithResult({ data: null, error: new FunctionsHttpError(response) });
    await expect(transcribeAudioWithClient(client, new Blob(["x"], { type: "audio/webm" }))).rejects.toThrow(
      "次数已达上限",
    );
  });

  it("maps relay, network, timeout, and malformed success responses", async () => {
    const blob = new Blob(["x"], { type: "audio/mp4" });
    const relay = clientWithResult({ data: null, error: new FunctionsRelayError(new Response(null, { status: 502 })) });
    await expect(transcribeAudioWithClient(relay.client, blob)).rejects.toThrow("连接失败");

    const network = clientWithResult({ data: null, error: new FunctionsFetchError(new TypeError("offline")) });
    await expect(transcribeAudioWithClient(network.client, blob)).rejects.toThrow("网络不可用");

    const timeout = clientWithResult({ data: null, error: new FunctionsFetchError(new DOMException("aborted", "AbortError")) });
    await expect(transcribeAudioWithClient(timeout.client, blob)).rejects.toThrow("超时");

    const malformed = clientWithResult({ data: { text: "", provider: "openai" }, error: null });
    await expect(transcribeAudioWithClient(malformed.client, blob)).rejects.toThrow("转写失败");
  });
});
