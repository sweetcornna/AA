// Claude (Anthropic) — the default LLM provider.
import { normalizeParsed, PARSE_TOOL_SCHEMA, parseSystemPrompt } from "./parse.ts";
import type { AgentReply, LLMProvider, ParseCtx, Snapshot } from "./types.ts";
import { actionFromProposal } from "./settle.ts";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

// deno-lint-ignore no-explicit-any
async function client(): Promise<any> {
  // Dynamic import: only loaded when this provider is actually selected, so
  // other paths (rule fallback) have no dependency on the SDK module.
  const { default: Anthropic } = await import("npm:@anthropic-ai/sdk");
  return new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
}

export const claudeProvider: LLMProvider = {
  name: "claude",

  available: () => !!Deno.env.get("ANTHROPIC_API_KEY"),

  async parseExpense(text: string, ctx: ParseCtx) {
    const anthropic = await client();
    const resp = await anthropic.messages.create({
      model: MODEL,
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

  async answerQuestion(question: string, snap: Snapshot): Promise<AgentReply> {
    const anthropic = await client();
    const system = [
      "你是「AA 记账」app 的记账助手。根据下面提供的 JSON 账本数据回答用户的问题。",
      "要求：",
      "- 只用数据里的事实，不要编造；数据里没有就说不知道或建议去哪看。",
      "- 金额都是「分」(minor units)，回答时换算成元，保留两位小数，加 ¥ 前缀。",
      "- net 为正表示「应收」(别人欠我)，为负表示「应付」(我欠别人)。",
      "- 简洁、口语化中文，必要时用短列表。不要输出 JSON 或代码。",
      "- 当用户明确想【结账/记一笔还款】而且 settlements 里有涉及用户本人的转账时，调用 propose_settlement 提议其中一笔（用 circle_id + 该圈 settlements 数组的下标），并在文字里说明这笔是谁付给谁多少；用户会在界面上确认。只是询问「怎么结」则不要调用工具。",
      "",
      "账本数据：",
      JSON.stringify(snap),
    ].join("\n");
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system,
      tools: [
        {
          name: "propose_settlement",
          description: "提议记录一笔结算转账，等待用户在界面上确认。只能引用账本数据 settlements 里已存在的转账。",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              circle_id: { type: "string", description: "圈子 id" },
              transfer_index: { type: "number", description: "该圈 settlements 数组的下标" },
            },
            required: ["circle_id", "transfer_index"],
          },
        },
      ],
      messages: [{ role: "user", content: question }],
    });
    const text = resp.content
      // deno-lint-ignore no-explicit-any
      .filter((b: any) => b.type === "text")
      // deno-lint-ignore no-explicit-any
      .map((b: any) => b.text)
      .join("")
      .trim();
    // deno-lint-ignore no-explicit-any
    const tu = resp.content.find((b: any) => b.type === "tool_use" && b.name === "propose_settlement");
    // The action's amounts/parties come from the snapshot (server-computed),
    // never from model text — the tool input is just a reference into it.
    const action = tu ? actionFromProposal(snap, tu.input?.circle_id, tu.input?.transfer_index) : null;
    return { answer: text || "我没太理解，换个说法再问问？", action };
  },
};
