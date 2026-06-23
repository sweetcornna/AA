// agent-query — natural language Q&A over the caller's ledger.
//
// The function builds an AUTHORITATIVE snapshot from the database (every query
// runs under the caller's JWT, so RLS guarantees they only ever see their own
// circles), then either lets Claude phrase an answer over that snapshot or, when
// ANTHROPIC_API_KEY is unset, answers with a rule-based intent matcher. Read-only
// — it never writes. Runs as a Supabase Edge Function (Deno).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const yuan = (minor: number) => (minor / 100).toFixed(2);

function shanghaiNow(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}
function monthStartISO(): string {
  const d = shanghaiNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// Greedy minimal-transfer settlement over net balances (mirrors
// packages/shared/settle.ts). Positive net = creditor, negative = debtor.
function minimizeTransfers(nets: { id: string; net: number }[]) {
  const creditors = nets.filter((n) => n.net > 0).map((n) => ({ ...n })).sort((a, b) => b.net - a.net);
  const debtors = nets.filter((n) => n.net < 0).map((n) => ({ id: n.id, net: -n.net })).sort((a, b) => b.net - a.net);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].net, creditors[j].net);
    if (pay > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].net -= pay;
    creditors[j].net -= pay;
    if (debtors[i].net === 0) i++;
    if (creditors[j].net === 0) j++;
  }
  return out;
}

interface Snapshot {
  me: { id: string; name: string };
  today: string;
  monthStart: string;
  circles: {
    id: string;
    name: string;
    currency: string;
    myNet: number;
    members: { id: string; name: string; net: number }[];
    settlements: { from: string; to: string; amount: number }[];
  }[];
  myMonthSpendByCategory: { category: string; amount: number }[];
  myMonthTotal: number;
  recentExpenses: {
    circle: string;
    description: string;
    category: string | null;
    amount: number;
    payer: string;
    spentAt: string;
  }[];
}

async function buildSnapshot(supabase: any, userId: string): Promise<Snapshot> {
  const { data: circles } = await supabase
    .from("circles")
    .select("id, name, default_currency");
  const circleRows = circles ?? [];
  const circleIds = circleRows.map((c: any) => c.id);

  const { data: balances } = circleIds.length
    ? await supabase.from("circle_balances").select("circle_id, user_id, net_minor").in("circle_id", circleIds)
    : { data: [] };

  const { data: members } = circleIds.length
    ? await supabase
        .from("circle_members")
        .select("circle_id, user_id, profile:profiles(display_name)")
        .in("circle_id", circleIds)
    : { data: [] };

  const nameOf = new Map<string, string>();
  for (const m of members ?? []) {
    const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
    nameOf.set(m.user_id, p?.display_name ?? "成员");
  }
  const myName = nameOf.get(userId) ?? "我";

  // recent expenses across my circles (covers "who paid" + this-month spend)
  const { data: expenses } = circleIds.length
    ? await supabase
        .from("expenses")
        .select("id, circle_id, description, category, amount_minor, payer_id, spent_at")
        .in("circle_id", circleIds)
        .order("spent_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(80)
    : { data: [] };
  const expRows = expenses ?? [];

  // my share per expense (for spend-by-category)
  const expIds = expRows.map((e: any) => e.id);
  const { data: splits } = expIds.length
    ? await supabase.from("expense_splits").select("expense_id, owed_minor").eq("user_id", userId).in("expense_id", expIds)
    : { data: [] };
  const myShare = new Map<string, number>();
  for (const s of splits ?? []) myShare.set(s.expense_id, s.owed_minor);

  const circleNameOf = new Map(circleRows.map((c: any) => [c.id, c.name]));
  const monthStart = monthStartISO();

  const byCat = new Map<string, number>();
  let myMonthTotal = 0;
  for (const e of expRows) {
    if (e.spent_at >= monthStart) {
      const share = myShare.get(e.id) ?? 0;
      if (share > 0) {
        const cat = e.category ?? "其他";
        byCat.set(cat, (byCat.get(cat) ?? 0) + share);
        myMonthTotal += share;
      }
    }
  }

  const circlesOut = circleRows.map((c: any) => {
    const rows = (balances ?? []).filter((b: any) => b.circle_id === c.id);
    const memberNets = rows.map((b: any) => ({ id: b.user_id, name: nameOf.get(b.user_id) ?? "成员", net: b.net_minor }));
    const mine = memberNets.find((m: any) => m.id === userId)?.net ?? 0;
    const transfers = minimizeTransfers(memberNets.map((m: any) => ({ id: m.id, net: m.net }))).map((t) => ({
      from: nameOf.get(t.from) ?? "成员",
      to: nameOf.get(t.to) ?? "成员",
      amount: t.amount,
    }));
    return {
      id: c.id,
      name: c.name,
      currency: c.default_currency ?? "CNY",
      myNet: mine,
      members: memberNets,
      settlements: transfers,
    };
  });

  return {
    me: { id: userId, name: myName },
    today: shanghaiNow().toISOString().slice(0, 10),
    monthStart,
    circles: circlesOut,
    myMonthSpendByCategory: [...byCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    myMonthTotal,
    recentExpenses: expRows.slice(0, 30).map((e: any) => ({
      circle: circleNameOf.get(e.circle_id) ?? "圈子",
      description: e.description,
      category: e.category,
      amount: e.amount_minor,
      payer: nameOf.get(e.payer_id) ?? "成员",
      spentAt: e.spent_at,
    })),
  };
}

async function answerWithClaude(apiKey: string, question: string, snap: Snapshot): Promise<string> {
  const { default: Anthropic } = await import("npm:@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const system = [
    "你是「AA 记账」app 的记账助手。根据下面提供的 JSON 账本数据回答用户的问题。",
    "要求：",
    "- 只用数据里的事实，不要编造；数据里没有就说不知道或建议去哪看。",
    "- 金额都是「分」(minor units)，回答时换算成元，保留两位小数，加 ¥ 前缀。",
    "- net 为正表示「应收」(别人欠我)，为负表示「应付」(我欠别人)。",
    "- 简洁、口语化中文，必要时用短列表。不要输出 JSON 或代码。",
    "",
    "账本数据：",
    JSON.stringify(snap),
  ].join("\n");
  const resp = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 700,
    system,
    messages: [{ role: "user", content: question }],
  });
  const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  return text || "我没太理解，换个说法再问问？";
}

function fallbackAnswer(question: string, snap: Snapshot): string {
  const q = question.toLowerCase();
  const lines: string[] = [];

  // settle: 结账 / 结一下 / 结算
  if (/结账|结一下|结算|怎么还|还钱/.test(question)) {
    const all = snap.circles.flatMap((c) =>
      c.settlements
        .filter((t) => t.from === snap.me.name || t.to === snap.me.name)
        .map((t) =>
          t.from === snap.me.name
            ? `· ${c.name}：你应付给 ${t.to} ¥${yuan(t.amount)}`
            : `· ${c.name}：${t.from} 应付给你 ¥${yuan(t.amount)}`,
        ),
    );
    return all.length ? "结算建议：\n" + all.join("\n") : "当前没有需要结算的款项，大家都两清啦 🎉";
  }

  // who paid: 谁付 / 谁出
  if (/谁付|谁出|谁请|是谁/.test(question)) {
    // Strip filler so the remaining chars are the expense keyword (e.g. 火锅).
    const kw = question.replace(/[?？。.,，!！谁付的了出请是哪笔那顿上周这最近我和帮吗呢啊吧个一下找查]/g, "").trim();
    const hits = snap.recentExpenses.filter(
      (e) => (kw && (e.description.includes(kw) || (e.category ?? "").includes(kw))) || (!kw && true),
    );
    const list = (kw ? hits : snap.recentExpenses).slice(0, 5);
    if (!list.length) return "最近没有相关账单记录。";
    return (
      (kw ? `关于「${kw}」：\n` : "最近的账单：\n") +
      list.map((e) => `· ${e.spentAt} ${e.circle}「${e.description}」¥${yuan(e.amount)}，${e.payer} 付的`).join("\n")
    );
  }

  // spending: 花了多少 / 花销 / 吃饭/餐饮 …
  if (/花了多少|花销|花了|多少钱|开销|消费/.test(question)) {
    if (!snap.myMonthSpendByCategory.length) return "这个月你还没有分摊到的花销。";
    // category-specific?
    const cat = snap.myMonthSpendByCategory.find((c) => question.includes(c.category));
    if (cat) return `这个月你在「${cat.category}」上分摊了 ¥${yuan(cat.amount)}。`;
    lines.push(`这个月你一共分摊了 ¥${yuan(snap.myMonthTotal)}：`);
    for (const c of snap.myMonthSpendByCategory.slice(0, 6)) lines.push(`· ${c.category}：¥${yuan(c.amount)}`);
    return lines.join("\n");
  }

  // balance / owe: 欠 / 结余 / 余额 (also the default overview)
  const credit = snap.circles.filter((c) => c.myNet > 0);
  const debit = snap.circles.filter((c) => c.myNet < 0);
  const total = snap.circles.reduce((s, c) => s + c.myNet, 0);
  if (total === 0 && !credit.length && !debit.length) return "你目前没有任何未结清的账,全部两清 ✅";
  lines.push(total >= 0 ? `总的来说，你应收 ¥${yuan(total)}：` : `总的来说，你应付 ¥${yuan(-total)}：`);
  for (const c of snap.circles) {
    if (c.myNet > 0) lines.push(`· ${c.name}：应收 ¥${yuan(c.myNet)}`);
    else if (c.myNet < 0) lines.push(`· ${c.name}：应付 ¥${yuan(-c.myNet)}`);
  }
  void q;
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const { question } = await req.json().catch(() => ({}));
    if (!question || typeof question !== "string") return json({ error: "question is required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const snap = await buildSnapshot(supabase, user.id);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    let answer: string;
    let provider: string;
    if (apiKey) {
      try {
        answer = await answerWithClaude(apiKey, question, snap);
        provider = "claude";
      } catch (_e) {
        answer = fallbackAnswer(question, snap);
        provider = "fallback(after-error)";
      }
    } else {
      answer = fallbackAnswer(question, snap);
      provider = "fallback";
    }

    return json({ answer, _provider: provider }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
