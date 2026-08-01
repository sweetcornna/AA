import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { createAsrHandler, MAX_AUDIO_BYTES } from "./handler.ts";

function environment(values: Record<string, string>) {
  return { get: (name: string) => values[name] };
}

function fakeClient(options?: { authenticated?: boolean; quota?: Record<string, unknown> }) {
  return {
    auth: {
      getUser: async () => options?.authenticated === false
        ? { data: { user: null }, error: new Error("invalid") }
        : { data: { user: { id: "user-1" } }, error: null },
    },
    rpc: async () => ({
      data: [options?.quota ?? { allowed: true, retry_after_seconds: 0 }],
      error: null,
    }),
  };
}

function request(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request("http://localhost/asr-transcribe", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-jwt",
      "Content-Type": "audio/webm",
      ...headers,
    },
    body,
  });
}

function handler(options?: {
  client?: ReturnType<typeof fakeClient>;
  fetch?: typeof fetch;
  env?: Record<string, string>;
  logs?: Record<string, unknown>[];
}) {
  return createAsrHandler({
    env: environment({
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_ANON_KEY: "anon",
      OPENAI_API_KEY: "provider-key",
      ...options?.env,
    }),
    createClient: (() => options?.client ?? fakeClient()) as never,
    fetch: options?.fetch ?? (async () => new Response(JSON.stringify({ text: "火锅 360" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })),
    requestId: () => "request-1",
    now: () => 100,
    setTimeout,
    clearTimeout,
    log: (entry) => options?.logs?.push(entry),
  });
}

Deno.test("rejects unauthenticated requests without consuming the request body", async () => {
  const req = new Request("http://localhost/asr-transcribe", {
    method: "POST",
    headers: { "Content-Type": "audio/webm" },
    body: "private-audio",
  });
  assertEquals(req.bodyUsed, false);
  const response = await handler()(req);
  assertEquals(response.status, 401);
  assertEquals(req.bodyUsed, false);
  assertEquals(await response.json(), { code: "not_authenticated" });
});

Deno.test("rejects invalid MIME and declared oversize", async () => {
  const invalid = await handler()(request("audio", { "Content-Type": "audio/wav" }));
  assertEquals(invalid.status, 415);
  assertEquals(await invalid.json(), { code: "invalid_audio_type" });

  const oversized = await handler()(request("x", { "Content-Length": String(MAX_AUDIO_BYTES + 1) }));
  assertEquals(oversized.status, 413);
  assertEquals(await oversized.json(), { code: "audio_too_large" });
});

Deno.test("rejects streamed oversize and empty bodies", async () => {
  const oversized = await handler()(request(new Uint8Array(MAX_AUDIO_BYTES + 1)));
  assertEquals(oversized.status, 413);
  assertEquals(await oversized.json(), { code: "audio_too_large" });

  const empty = await handler()(request(new Uint8Array()));
  assertEquals(empty.status, 400);
  assertEquals(await empty.json(), { code: "audio_empty" });
});

Deno.test("validates the audio body before consuming quota", async () => {
  let quotaCalls = 0;
  const client = fakeClient();
  client.rpc = async () => {
    quotaCalls++;
    return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
  };

  const empty = await handler({ client })(request(new Uint8Array()));
  assertEquals(empty.status, 400);
  assertEquals(quotaCalls, 0);

  const valid = await handler({ client })(request("audio"));
  assertEquals(valid.status, 200);
  assertEquals(quotaCalls, 1);
});

Deno.test("enforces quota and Retry-After", async () => {
  const response = await handler({
    client: fakeClient({ quota: { allowed: false, retry_after_seconds: 42 } }),
  })(request("audio"));
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "42");
  assertEquals(await response.json(), { code: "quota_exceeded" });
});

Deno.test("maps provider timeout to a stable error", async () => {
  const timeoutHandler = createAsrHandler({
    env: environment({
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_ANON_KEY: "anon",
      OPENAI_API_KEY: "provider-key",
    }),
    createClient: (() => fakeClient()) as never,
    fetch: async (_input, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    },
    requestId: () => "request-1",
    now: () => 100,
    setTimeout: ((callback: () => void) => {
      queueMicrotask(callback);
      return 1;
    }) as never,
    clearTimeout: () => {},
    log: () => {},
  });
  const response = await timeoutHandler(request("audio"));

  assertEquals(response.status, 504);
  assertEquals(await response.json(), { code: "provider_timeout" });
});

Deno.test("returns stable provider errors without upstream body leakage", async () => {
  const response = await handler({
    fetch: async () => new Response("provider-secret-body", { status: 500 }),
  })(request("audio"));
  assertEquals(response.status, 503);
  const body = JSON.stringify(await response.json());
  assertEquals(body.includes("provider-secret-body"), false);
  assertEquals(body, JSON.stringify({ code: "provider_unavailable" }));
});

Deno.test("returns text while logs exclude audio, transcript, JWT, and provider response", async () => {
  const logs: Record<string, unknown>[] = [];
  const response = await handler({ logs })(request("private-audio-bytes"));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { text: "火锅 360", provider: "openai" });
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(logs.length, 1);
  const serialized = JSON.stringify(logs[0]);
  assertStringIncludes(serialized, '"result":"ok"');
  for (const secret of ["private-audio-bytes", "火锅 360", "test-jwt", "provider-key"]) {
    assertEquals(serialized.includes(secret), false);
  }
});
