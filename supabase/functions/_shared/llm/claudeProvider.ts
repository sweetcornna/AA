// Claude (Anthropic) — the default LLM provider.
import {
  normalizeParsed,
  PARSE_TOOL_SCHEMA,
  parseSystemPrompt,
} from "./parse.ts";
import type { LLMProvider, ParseCtx } from "./types.ts";

const MODEL = () => Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

// deno-lint-ignore no-explicit-any
async function client(): Promise<any> {
  // Dynamic import: only loaded when this provider is actually selected, so
  // other paths (rule fallback) have no dependency on the SDK module.
  const { default: Anthropic } = await import("npm:@anthropic-ai/sdk@0.110.0");
  return new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
}

export const claudeProvider: LLMProvider = {
  name: "claude",

  available: () => !!Deno.env.get("ANTHROPIC_API_KEY"),

  async parseExpense(text: string, ctx: ParseCtx) {
    const anthropic = await client();
    const resp = await anthropic.messages.create({
      model: MODEL(),
      max_tokens: 1024,
      system: parseSystemPrompt(ctx),
      tools: [
        {
          name: "record_expense",
          description: "把用户这句话解析成一条结构化账单。",
          // strict is a top-level tool field (structured outputs)
          strict: true,
          input_schema: PARSE_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "record_expense" },
      messages: [{ role: "user", content: text }],
    });
    // deno-lint-ignore no-explicit-any
    const tu = resp.content.find((b: any) => b.type === "tool_use");
    if (!tu) throw new Error("model did not return a tool_use block");
    return normalizeParsed(tu.input, ctx);
  },
};
