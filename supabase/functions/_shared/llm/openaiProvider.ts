// OpenAI(-compatible) provider — the proof that the registry is truly
// pluggable. Plain fetch against the chat completions API (no SDK); set
// OPENAI_BASE_URL to point at any compatible gateway.
import { normalizeParsed, PARSE_TOOL_SCHEMA, parseSystemPrompt } from "./parse.ts";
import type { AgentReply, LLMProvider, ParseCtx, Snapshot } from "./types.ts";

const BASE = () => Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
const MODEL = () => Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

async function chat(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BASE()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({ model: MODEL(), ...body }),
  });
  if (!resp.ok) throw new Error(`openai error ${resp.status}: ${await resp.text()}`);
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
        json_schema: { name: "record_expense", strict: true, schema: PARSE_TOOL_SCHEMA },
      },
    });
    // deno-lint-ignore no-explicit-any
    const content = (data as any)?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("model returned no content");
    return normalizeParsed(JSON.parse(content), ctx);
  },

  async answerQuestion(question: string, snap: Snapshot): Promise<AgentReply> {
    const system = [
      "你是「AA 记账」app 的记账助手。根据下面提供的 JSON 账本数据回答用户的问题。",
      "只用数据里的事实；金额是分，回答换算成元(两位小数,¥前缀)；net 正=应收 负=应付；简洁口语化中文，不输出 JSON。",
      "",
      "账本数据：",
      JSON.stringify(snap),
    ].join("\n");
    const data = await chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
      max_tokens: 700,
    });
    // deno-lint-ignore no-explicit-any
    const content = (data as any)?.choices?.[0]?.message?.content;
    return { answer: typeof content === "string" && content.trim() ? content.trim() : "我没太理解，换个说法再问问？" };
  },
};
