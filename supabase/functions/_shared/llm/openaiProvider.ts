// OpenAI(-compatible) provider — the proof that the registry is truly
// pluggable. Plain fetch against the chat completions API (no SDK); set
// OPENAI_BASE_URL to point at any compatible gateway.
import {
  normalizeParsed,
  PARSE_TOOL_SCHEMA,
  parseSystemPrompt,
} from "./parse.ts";
import type { LLMProvider, ParseCtx } from "./types.ts";

const BASE = () =>
  Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
const MODEL = () => Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

async function chat(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BASE()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({ model: MODEL(), ...body }),
  });
  if (!resp.ok)
    throw new Error(`openai error ${resp.status}: ${await resp.text()}`);
  return await resp.json();
}

export const openaiProvider: LLMProvider = {
  name: "openai",

  available: () => !!Deno.env.get("OPENAI_API_KEY"),

  async parseExpense(text: string, ctx: ParseCtx) {
    const data = await chat({
      messages: [
        { role: "system", content: parseSystemPrompt(ctx) },
        { role: "user", content: text },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "record_expense",
          strict: true,
          schema: PARSE_TOOL_SCHEMA,
        },
      },
    });
    // deno-lint-ignore no-explicit-any
    const content = (data as any)?.choices?.[0]?.message?.content;
    if (typeof content !== "string")
      throw new Error("model returned no content");
    return normalizeParsed(JSON.parse(content), ctx);
  },
};
