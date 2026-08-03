import { describe, expect, it } from "vitest";
import {
  expenseActivityTitle,
  mapActivityRow,
  settlementActivityTitle,
  settlementPresentation,
} from "./activity";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const CREATOR = "22222222-2222-4222-8222-222222222222";
const PAYER = "33333333-3333-4333-8333-333333333333";
const RECIPIENT = "44444444-4444-4444-8444-444444444444";
const CIRCLE = "55555555-5555-4555-8555-555555555555";
const ITEM = "66666666-6666-4666-8666-666666666666";

function common() {
  return {
    id: ITEM,
    circle_id: CIRCLE,
    circle_name: "旅行",
    occurred_at: "2026-08-03T10:00:00.000Z",
    amount_minor: "1234",
    currency: "CNY",
  };
}

function expenseRow(overrides: Record<string, unknown> = {}) {
  return {
    ...common(),
    kind: "expense",
    description: "晚餐",
    category: "餐饮",
    creator_id: CREATOR,
    creator_name: "小陈",
    payer_id: PAYER,
    payer_name: "小李",
    my_owed_minor: "0",
    from_user: null,
    from_name: null,
    to_user: null,
    to_name: null,
    ...overrides,
  };
}

function settlementRow(overrides: Record<string, unknown> = {}) {
  return {
    ...common(),
    kind: "settlement",
    description: null,
    category: null,
    creator_id: CREATOR,
    creator_name: "小陈",
    payer_id: null,
    payer_name: null,
    my_owed_minor: null,
    from_user: PAYER,
    from_name: "小李",
    to_user: RECIPIENT,
    to_name: "小王",
    ...overrides,
  };
}

describe("activity row mapping", () => {
  it("preserves distinct creator, payer, and zero-valued split", () => {
    const item = mapActivityRow(expenseRow(), VIEWER);
    expect(item).toMatchObject({
      kind: "expense",
      amountMinor: 1234,
      creator: { id: CREATOR, name: "小陈" },
      payer: { id: PAYER, name: "小李" },
      myOwedMinor: 0,
    });
    if (item.kind !== "expense") throw new Error("expected expense");
    expect(expenseActivityTitle(item)).toBe("小陈 记录了「晚餐」，小李付款");
  });

  it("distinguishes no split from a zero share", () => {
    const item = mapActivityRow(expenseRow({ my_owed_minor: null }), VIEWER);
    expect(item.kind === "expense" && item.myOwedMinor).toBeNull();
  });

  it("labels the viewer as me and missing profiles as member", () => {
    const item = mapActivityRow(expenseRow({
      creator_id: VIEWER,
      creator_name: "Remote name",
      payer_name: null,
    }), VIEWER);
    expect(item).toMatchObject({
      creator: { name: "我" },
      payer: { name: "成员" },
    });
  });

  it("uses a shorter expense title when creator paid", () => {
    const item = mapActivityRow(expenseRow({
      creator_id: PAYER,
      creator_name: "小李",
    }), VIEWER);
    if (item.kind !== "expense") throw new Error("expected expense");
    expect(expenseActivityTitle(item)).toBe("小李 添加了「晚餐」");
  });

  it.each([
    [
      "outgoing",
      { from_user: VIEWER },
      { prefix: "−", status: "已付款", tone: "negative" },
    ],
    [
      "incoming",
      { to_user: VIEWER },
      { prefix: "+", status: "已收款", tone: "positive" },
    ],
    [
      "recorded",
      { creator_id: VIEWER },
      { prefix: "", status: "转账记录", tone: "neutral" },
    ],
    [
      "other",
      {},
      { prefix: "", status: "转账记录", tone: "neutral" },
    ],
  ] as const)("maps %s settlement direction", (direction, overrides, presentation) => {
    const item = mapActivityRow(settlementRow(overrides), VIEWER);
    expect(item.kind === "settlement" && item.direction).toBe(direction);
    expect(settlementPresentation(direction)).toEqual(presentation);
  });

  it("credits a third-party creator in settlement text", () => {
    const item = mapActivityRow(settlementRow(), VIEWER);
    if (item.kind !== "settlement") throw new Error("expected settlement");
    expect(settlementActivityTitle(item)).toBe("小陈记录了：小李 付给 小王");
  });

  it("rejects unknown activity kinds", () => {
    expect(() => mapActivityRow({ ...expenseRow(), kind: "note" }, VIEWER))
      .toThrow("Invalid activity kind");
  });

  it("rejects missing required actor fields", () => {
    expect(() => mapActivityRow(expenseRow({ payer_id: null }), VIEWER))
      .toThrow("Invalid activity field: payer_id");
  });

  it("accepts every canonical UUID that PostgreSQL can return", () => {
    const item = mapActivityRow(expenseRow({
      id: "00000000-0000-0000-0000-000000000000",
    }), VIEWER);
    expect(item.id).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("rejects amounts outside JavaScript's safe integer range", () => {
    expect(() => mapActivityRow(expenseRow({
      amount_minor: "9007199254740992",
    }), VIEWER)).toThrow("Invalid activity field: amount_minor");
  });
});
