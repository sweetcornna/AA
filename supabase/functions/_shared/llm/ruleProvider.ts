// Rule-based provider — the always-available floor of the registry. No API
// key, no network: regex heuristics good enough that 一句话记账 and the
// assistant keep working (and stay demo-able) with zero AI configuration.
import { normalizeParsed } from "./parse.ts";
import { findSettleProposal } from "./settle.ts";
import type { AgentReply, LLMProvider, ParseCtx, Snapshot } from "./types.ts";

const yuan = (minor: number) => (minor / 100).toFixed(2);

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
    const nums = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    const amount = nums.length ? Math.max(...nums) : 0;

    // date
    let spentAt = ctx.today;
    if (/前天/.test(text)) spentAt = addDays(ctx.today, -2);
    else if (/昨天|昨晚/.test(text)) spentAt = addDays(ctx.today, -1);

    // participants: members whose name appears, plus "我/自己" → current user
    const matched: { matchedMemberId: string | null; rawName: string; amount: number | null }[] = [];
    const seen = new Set<string>();
    if (/我|自己|俺/.test(text)) {
      matched.push({ matchedMemberId: ctx.currentUserId, rawName: "我", amount: null });
      seen.add(ctx.currentUserId);
    }
    for (const m of ctx.members) {
      if (m.id !== ctx.currentUserId && text.includes(m.name) && !seen.has(m.id)) {
        matched.push({ matchedMemberId: m.id, rawName: m.name, amount: null });
        seen.add(m.id);
      }
    }
    // "和/跟/与 X …" implies the speaker took part too ("昨天和Bob吃火锅 平摊").
    if (!seen.has(ctx.currentUserId) && seen.size > 0 && /[和跟与]/.test(text)) {
      matched.unshift({ matchedMemberId: ctx.currentUserId, rawName: "我", amount: null });
      seen.add(ctx.currentUserId);
    }
    const participants = matched.length
      ? matched
      : ctx.members.map((m) => ({ matchedMemberId: m.id, rawName: m.name, amount: null }));

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

  // deno-lint-ignore require-await
  async answerQuestion(question: string, snap: Snapshot): Promise<AgentReply> {
    const lines: string[] = [];

    // settle: 结账 / 结一下 / 结算 (may also propose a confirmable settle_up)
    if (/结账|结一下|结算|怎么还|还钱|还款/.test(question)) {
      const all = snap.circles.flatMap((c) =>
        c.settlements
          .filter((t) => t.fromId === snap.me.id || t.toId === snap.me.id)
          .map((t) =>
            t.fromId === snap.me.id
              ? `· ${c.name}：你应付给 ${t.toName} ¥${yuan(t.amount)}`
              : `· ${c.name}：${t.fromName} 应付给你 ¥${yuan(t.amount)}`,
          ),
      );
      const action = findSettleProposal(question, snap);
      const answer = all.length
        ? "结算建议：\n" + all.join("\n") + (action ? "\n\n可以帮你记下第一笔，确认后生效。" : "")
        : "当前没有需要结算的款项，大家都两清啦 🎉";
      return { answer, action };
    }

    // who paid: 谁付 / 谁出
    if (/谁付|谁出|谁请|是谁/.test(question)) {
      // Strip filler so the remaining chars are the expense keyword (e.g. 火锅).
      const kw = question.replace(/[?？。.,，!！谁付的了出请是哪笔那顿上周这最近我和帮吗呢啊吧个一下找查]/g, "").trim();
      const hits = snap.recentExpenses.filter(
        (e) => kw && (e.description.includes(kw) || (e.category ?? "").includes(kw)),
      );
      const list = (kw ? hits : snap.recentExpenses).slice(0, 5);
      if (!list.length) return { answer: "最近没有相关账单记录。" };
      return {
        answer:
          (kw ? `关于「${kw}」：\n` : "最近的账单：\n") +
          list.map((e) => `· ${e.spentAt} ${e.circle}「${e.description}」¥${yuan(e.amount)}，${e.payer} 付的`).join("\n"),
      };
    }

    // spending: 花了多少 / 花销 / 吃饭/餐饮 …
    if (/花了多少|花销|花了|多少钱|开销|消费/.test(question)) {
      if (!snap.myMonthSpendByCategory.length) return { answer: "这个月你还没有分摊到的花销。" };
      const cat = snap.myMonthSpendByCategory.find((c) => question.includes(c.category));
      if (cat) return { answer: `这个月你在「${cat.category}」上分摊了 ¥${yuan(cat.amount)}。` };
      lines.push(`这个月你一共分摊了 ¥${yuan(snap.myMonthTotal)}：`);
      for (const c of snap.myMonthSpendByCategory.slice(0, 6)) lines.push(`· ${c.category}：¥${yuan(c.amount)}`);
      return { answer: lines.join("\n") };
    }

    // balance / owe: 欠 / 结余 / 余额 (also the default overview)
    const credit = snap.circles.filter((c) => c.myNet > 0);
    const debit = snap.circles.filter((c) => c.myNet < 0);
    const total = snap.circles.reduce((s, c) => s + c.myNet, 0);
    if (total === 0 && !credit.length && !debit.length) {
      return { answer: "你目前没有任何未结清的账,全部两清 ✅" };
    }
    lines.push(total >= 0 ? `总的来说，你应收 ¥${yuan(total)}：` : `总的来说，你应付 ¥${yuan(-total)}：`);
    for (const c of snap.circles) {
      if (c.myNet > 0) lines.push(`· ${c.name}：应收 ¥${yuan(c.myNet)}`);
      else if (c.myNet < 0) lines.push(`· ${c.name}：应付 ¥${yuan(-c.myNet)}`);
    }
    return { answer: lines.join("\n") };
  },
};
