// Rule-based provider — the always-available floor of the registry. No API
// key, no network: 一句话记账 remains available with zero AI configuration.
import { normalizeParsed } from "./parse.ts";
import type { LLMProvider, ParseCtx } from "./types.ts";

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/火锅|吃饭|餐|饭|外卖|烧烤|奶茶|咖啡|早餐|午餐|晚餐|夜宵|聚餐/, "餐饮"],
  [/打车|出租|滴滴|地铁|公交|高铁|机票|油费|停车|车费/, "交通"],
  [/酒店|住宿|民宿|房费|房租/, "住宿"],
  [/电影|ktv|唱歌|游戏|娱乐|门票|演唱会/i, "娱乐"],
  [/超市|买|购物|商场/, "购物"],
];

export const ruleProvider: LLMProvider = {
  name: "rule",

  available: () => true,

  // deno-lint-ignore require-await
  async parseExpense(text: string, ctx: ParseCtx) {
    // amount = largest number in the sentence
    const nums = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) =>
      Number(m[1]),
    );
    const amount = nums.length ? Math.max(...nums) : 0;

    // date
    let spentAt = ctx.today;
    if (/前天/.test(text)) spentAt = addDays(ctx.today, -2);
    else if (/昨天|昨晚/.test(text)) spentAt = addDays(ctx.today, -1);

    // participants: members whose name appears, plus "我/自己" → current user
    const matched: {
      matchedMemberId: string | null;
      rawName: string;
      amount: number | null;
    }[] = [];
    const seen = new Set<string>();
    if (/我|自己|俺/.test(text)) {
      matched.push({
        matchedMemberId: ctx.currentUserId,
        rawName: "我",
        amount: null,
      });
      seen.add(ctx.currentUserId);
    }
    for (const m of ctx.members) {
      if (
        m.id !== ctx.currentUserId &&
        text.includes(m.name) &&
        !seen.has(m.id)
      ) {
        matched.push({ matchedMemberId: m.id, rawName: m.name, amount: null });
        seen.add(m.id);
      }
    }
    // "和/跟/与 X …" implies the speaker took part too ("昨天和Bob吃火锅 平摊").
    if (
      !seen.has(ctx.currentUserId) &&
      seen.size > 0 &&
      /[和跟与]/.test(text)
    ) {
      matched.unshift({
        matchedMemberId: ctx.currentUserId,
        rawName: "我",
        amount: null,
      });
      seen.add(ctx.currentUserId);
    }
    const participants = matched.length
      ? matched
      : ctx.members.map((m) => ({
          matchedMemberId: m.id,
          rawName: m.name,
          amount: null,
        }));

    // category
    let category: string | null = null;
    for (const [re, cat] of CATEGORY_RULES) {
      if (re.test(text)) {
        category = cat;
        break;
      }
    }

    return normalizeParsed(
      {
        amount,
        currency: ctx.currency,
        payer_member_id: ctx.currentUserId,
        payer_raw_name: "我",
        spent_at: spentAt,
        split_type: "equal",
        participants: participants.map((p) => ({
          matched_member_id: p.matchedMemberId,
          raw_name: p.rawName,
          amount: p.amount,
        })),
        category,
        description: category ?? text.slice(0, 20),
        confidence: 0.5,
        unresolved: [],
      },
      ctx,
    );
  },
};
