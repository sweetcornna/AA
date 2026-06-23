// parse-expense — natural language → structured expense (ParsedExpense).
// Default provider: Claude (Anthropic) via strict tool use. Falls back to a
// rule-based parser when ANTHROPIC_API_KEY is unset, so the flow works locally
// without a key. Runs as a Supabase Edge Function (Deno).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface Member {
  id: string;
  name: string;
}
interface Ctx {
  members: Member[];
  currentUserId: string;
  currency: string;
  today: string;
  categories: string[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function shanghaiToday(): string {
  // Edge runtime is UTC; shift +8h for Asia/Shanghai.
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// JSON Schema mirror of ParsedExpense (snake_case for the tool); kept in sync
// with packages/shared/src/ai.ts.
const TOOL_SCHEMA = {
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

function systemPrompt(ctx: Ctx): string {
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

function normalize(raw: any, ctx: Ctx): unknown {
  const ids = new Set(ctx.members.map((m) => m.id));
  const fixId = (v: unknown) => (typeof v === "string" && ids.has(v) ? v : null);

  let participants = Array.isArray(raw?.participants)
    ? raw.participants.map((p: any) => ({
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

async function parseWithClaude(apiKey: string, text: string, ctx: Ctx): Promise<unknown> {
  // Dynamic import: only loaded when an API key is present, so the fallback
  // path has no dependency on the SDK module.
  const { default: Anthropic } = await import("npm:@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    system: systemPrompt(ctx),
    tools: [
      {
        name: "record_expense",
        description: "把用户这句话解析成一条结构化账单。",
        // @ts-ignore strict is a top-level tool field (structured outputs)
        strict: true,
        input_schema: TOOL_SCHEMA as any,
      },
    ],
    tool_choice: { type: "tool", name: "record_expense" },
    messages: [{ role: "user", content: text }],
  });
  const tu: any = resp.content.find((b: any) => b.type === "tool_use");
  if (!tu) throw new Error("model did not return a tool_use block");
  return normalize(tu.input, ctx);
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/火锅|吃饭|餐|饭|外卖|烧烤|奶茶|咖啡|早餐|午餐|晚餐|夜宵|聚餐/, "餐饮"],
  [/打车|出租|滴滴|地铁|公交|高铁|机票|油费|停车|车费/, "交通"],
  [/酒店|住宿|民宿|房费|房租/, "住宿"],
  [/电影|ktv|唱歌|游戏|娱乐|门票|演唱会/i, "娱乐"],
  [/超市|买|购物|商场/, "购物"],
];

function fallbackParse(text: string, ctx: Ctx): unknown {
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

  return normalize(
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
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { circleId, text } = await req.json().catch(() => ({}));
    if (!circleId || !text || typeof text !== "string") {
      return json({ error: "circleId and text are required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const { data: circle } = await supabase
      .from("circles")
      .select("default_currency")
      .eq("id", circleId)
      .maybeSingle();
    if (!circle) return json({ error: "circle not found or not a member" }, 403);

    const { data: members } = await supabase
      .from("circle_members")
      .select("user_id, profile:profiles(display_name)")
      .eq("circle_id", circleId);

    const memberList: Member[] = (members ?? []).map((m: any) => ({
      id: m.user_id,
      name: Array.isArray(m.profile)
        ? m.profile[0]?.display_name ?? "成员"
        : m.profile?.display_name ?? "成员",
    }));

    const ctx: Ctx = {
      members: memberList,
      currentUserId: user.id,
      currency: (circle.default_currency as string) ?? "CNY",
      today: shanghaiToday(),
      categories: ["餐饮", "交通", "住宿", "购物", "娱乐", "其他"],
    };

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    let parsed: unknown;
    let provider: string;
    if (apiKey) {
      try {
        parsed = await parseWithClaude(apiKey, text, ctx);
        provider = "claude";
      } catch (e) {
        // Graceful degrade: fall back to rules if the model call fails.
        parsed = fallbackParse(text, ctx);
        provider = "fallback(after-error)";
      }
    } else {
      parsed = fallbackParse(text, ctx);
      provider = "fallback";
    }

    return json({ ...(parsed as object), _provider: provider }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
