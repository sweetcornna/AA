import { resolveLLM, ruleProvider } from "./registry.ts";

function assertSame(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error("expected values to be identical");
}

function queryResult(result: unknown) {
  const query = {
    or: () => query,
    is: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return {
    from: () => ({
      select: () => query,
    }),
  };
}

Deno.test("resolveLLM fails closed when ai_settings returns an error", async () => {
  const provider = await resolveLLM(
    queryResult({ data: null, error: { message: "unavailable" } }),
    null,
  );

  assertSame(provider, ruleProvider);
});

Deno.test("resolveLLM fails closed when ai_settings throws", async () => {
  const provider = await resolveLLM(
    {
      from: () => {
        throw new Error("unavailable");
      },
    },
    null,
  );

  assertSame(provider, ruleProvider);
});

Deno.test("resolveLLM honors the database kill switch", async () => {
  const provider = await resolveLLM(
    queryResult({
      data: [{ circle_id: null, llm_provider: "claude", ai_enabled: false }],
      error: null,
    }),
    null,
  );

  assertSame(provider, ruleProvider);
});
