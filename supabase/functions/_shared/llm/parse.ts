// Shared pieces of the "sentence → structured expense" task: the tool JSON
// Schema, the system prompt, and the trust-nothing normalizer every provider's
// raw output passes through before reaching the client.
import type { ParseCtx } from "./types.ts";

// JSON Schema mirror of ParsedExpense (snake_case for the tool); kept in sync
// with packages/shared/src/ai.ts.
export const PARSE_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    amount: { type: "number", description: "总金额，单位元（major units）" },
    currency: { type: "string", description: "3 字母币种，如 CNY" },
    payer_member_id: { type: ["string", "null"], description: "付款人的成员 id；匹配不到填 null" },
    payer_raw_name: { type: ["string", "null"], description: "原文里的付款人称呼" },
    spent_at: { type: "string", description: "ISO 日期 YYYY-MM-DD（结合 today 解析相对日期）" },
    split_type: { type: "string", enum: ["equal", "exact", "shares"] },
    participants: {
      type: "array",
      description: "参与分账的人",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          matched_member_id: { type: ["string", "null"], description: "匹配到的成员 id；不确定填 null" },
          raw_name: { type: "string" },
          amount: { type: ["number", "null"], description: "精确分账时该人金额(元)，否则 null" },
        },
        required: ["matched_member_id", "raw_name", "amount"],
      },
    },
    category: { type: ["string", "null"] },
    description: { type: "string", description: "简短备注，如 火锅" },
    confidence: { type: "number", description: "0~1 总体置信度" },
    unresolved: { type: "array", items: { type: "string" }, description: "没解析/没匹配上的点" },
  },
  required: [
    "amount",
    "currency",
    "payer_member_id",
    "payer_raw_name",
    "spent_at",
    "split_type",
    "participants",
    "category",
    "description",
    "confidence",
    "unresolved",
  ],
};

export function parseSystemPrompt(ctx: ParseCtx): string {
  const roster = ctx.members.map((m) => `- ${m.name} (id: ${m.id})`).join("\n");
  return [
    "你是一个 AA 记账助手。把用户的一句话解析成结构化账单，并调用 record_expense 工具返回。",
    "",
    `今天是 ${ctx.today}（时区 Asia/Shanghai）。默认币种 ${ctx.currency}。`,
    `当前用户（“我/自己”指此人）的成员 id 是 ${ctx.currentUserId}。`,
    "圈子成员名单：",
    roster,
    "可用分类：" + ctx.categories.join("、"),
    "",
    "规则：",
    "- 金额只取数字（元）。",
    "- 相对日期（昨天/前天/上周…）要结合今天解析成绝对日期 YYYY-MM-DD。",
    "- 人名尽量匹配到上面的成员 id 填到 matched_member_id；“我/自己”→当前用户 id；不确定就填 null 并把原名写进 unresolved，绝不乱猜。",
    "- 付款人默认是“我”（当前用户），除非句子里另有说明。",
    "- 分账方式：平摊/AA/平均→equal；“我出X他出Y/各付”→exact（每人 amount 填元）；按比例/份额→shares。",
    "- 没提到具体参与人时，participants 包含全部成员，equal。",
    "- confidence 反映整体把握，0~1。",
  ].join("\n");
}

/**
 * Server-side second line of defense (after the model, before the user's form):
 * validates member ids against the roster, fills defaults, and collects
 * unmatched names into `unresolved` so the form renders them for review.
 */
// deno-lint-ignore no-explicit-any
export function normalizeParsed(raw: any, ctx: ParseCtx): Record<string, unknown> {
  const ids = new Set(ctx.members.map((m) => m.id));
  const fixId = (v: unknown) => (typeof v === "string" && ids.has(v) ? v : null);

  let participants = Array.isArray(raw?.participants)
    ? // deno-lint-ignore no-explicit-any
      raw.participants.map((p: any) => ({
        matchedMemberId: fixId(p?.matched_member_id),
        rawName: String(p?.raw_name ?? ""),
        amount: typeof p?.amount === "number" ? p.amount : null,
      }))
    : [];

  // Default to all members (equal) when nothing was resolved.
  if (participants.length === 0) {
    participants = ctx.members.map((m) => ({ matchedMemberId: m.id, rawName: m.name, amount: null }));
  }

  const unresolved: string[] = Array.isArray(raw?.unresolved) ? raw.unresolved.map(String) : [];
  for (const p of participants) {
    if (!p.matchedMemberId && p.rawName && !unresolved.includes(p.rawName)) unresolved.push(p.rawName);
  }

  return {
    amount: typeof raw?.amount === "number" ? raw.amount : 0,
    currency: typeof raw?.currency === "string" && raw.currency.length === 3 ? raw.currency : ctx.currency,
    payerMemberId: fixId(raw?.payer_member_id) ?? ctx.currentUserId,
    payerRawName: typeof raw?.payer_raw_name === "string" ? raw.payer_raw_name : null,
    spentAt: typeof raw?.spent_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.spent_at) ? raw.spent_at : ctx.today,
    splitType: ["equal", "exact", "shares"].includes(raw?.split_type) ? raw.split_type : "equal",
    participants,
    category: typeof raw?.category === "string" ? raw.category : null,
    description: typeof raw?.description === "string" ? raw.description : "",
    confidence: typeof raw?.confidence === "number" ? raw.confidence : 0.6,
    unresolved,
  };
}
