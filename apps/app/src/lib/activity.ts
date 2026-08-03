export type ActivityScope = "all" | "mine";

export interface ActivityActor {
  id: string;
  name: string;
}

interface ActivityBase {
  id: string;
  circleId: string;
  circleName: string;
  at: string;
  amountMinor: number;
  currency: string;
  creator: ActivityActor;
}

export interface ExpenseActivityItem extends ActivityBase {
  kind: "expense";
  description: string;
  category: string | null;
  payer: ActivityActor;
  myOwedMinor: number | null;
}

export type SettlementDirection =
  | "outgoing"
  | "incoming"
  | "recorded"
  | "other";

export interface SettlementActivityItem extends ActivityBase {
  kind: "settlement";
  from: ActivityActor;
  to: ActivityActor;
  direction: SettlementDirection;
}

export type ActivityItem = ExpenseActivityItem | SettlementActivityItem;

export interface SettlementPresentation {
  prefix: "−" | "+" | "";
  status: "已付款" | "已收款" | "转账记录";
  tone: "negative" | "positive" | "neutral";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid activity response");
  }
  return value as Record<string, unknown>;
}

function requiredString(
  row: Record<string, unknown>,
  field: string,
): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid activity field: ${field}`);
  }
  return value;
}

function requiredUuid(
  row: Record<string, unknown>,
  field: string,
): string {
  const value = requiredString(row, field);
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid activity field: ${field}`);
  }
  return value;
}

function nullableString(
  row: Record<string, unknown>,
  field: string,
): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Invalid activity field: ${field}`);
  }
  return value;
}

function safeInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid activity field: ${field}`);
  }
  return parsed;
}

function actor(
  row: Record<string, unknown>,
  idField: string,
  nameField: string,
  viewerId: string,
): ActivityActor {
  const id = requiredUuid(row, idField);
  const remoteName = nullableString(row, nameField)?.trim();
  return {
    id,
    name: id === viewerId ? "我" : remoteName || "成员",
  };
}

function commonFields(
  row: Record<string, unknown>,
  viewerId: string,
): ActivityBase {
  const currency = requiredString(row, "currency");
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Invalid activity field: currency");
  }
  const at = requiredString(row, "occurred_at");
  if (!Number.isFinite(Date.parse(at))) {
    throw new Error("Invalid activity field: occurred_at");
  }
  return {
    id: requiredUuid(row, "id"),
    circleId: requiredUuid(row, "circle_id"),
    circleName: requiredString(row, "circle_name"),
    at,
    amountMinor: safeInteger(row.amount_minor, "amount_minor"),
    currency,
    creator: actor(row, "creator_id", "creator_name", viewerId),
  };
}

export function mapActivityRow(
  value: unknown,
  viewerId: string,
): ActivityItem {
  if (!UUID_RE.test(viewerId)) {
    throw new Error("Invalid activity viewer");
  }
  const row = recordOf(value);
  const common = commonFields(row, viewerId);

  if (row.kind === "expense") {
    const myOwed = row.my_owed_minor;
    return {
      ...common,
      kind: "expense",
      description: nullableString(row, "description") ?? "",
      category: nullableString(row, "category"),
      payer: actor(row, "payer_id", "payer_name", viewerId),
      myOwedMinor:
        myOwed === null || myOwed === undefined
          ? null
          : safeInteger(myOwed, "my_owed_minor"),
    };
  }

  if (row.kind === "settlement") {
    const from = actor(row, "from_user", "from_name", viewerId);
    const to = actor(row, "to_user", "to_name", viewerId);
    const direction: SettlementDirection =
      from.id === viewerId
        ? "outgoing"
        : to.id === viewerId
          ? "incoming"
          : common.creator.id === viewerId
            ? "recorded"
            : "other";
    return {
      ...common,
      kind: "settlement",
      from,
      to,
      direction,
    };
  }

  throw new Error("Invalid activity kind");
}

export function mapActivityRows(
  rows: unknown[] | null,
  viewerId: string,
): ActivityItem[] {
  return (rows ?? []).map((row) => mapActivityRow(row, viewerId));
}

export function expenseActivityTitle(item: ExpenseActivityItem): string {
  const description = item.description || "一笔";
  if (item.creator.id === item.payer.id) {
    return `${item.creator.name} 添加了「${description}」`;
  }
  return `${item.creator.name} 记录了「${description}」，${item.payer.name}付款`;
}

export function settlementActivityTitle(
  item: SettlementActivityItem,
): string {
  const transfer = `${item.from.name} 付给 ${item.to.name}`;
  if (
    item.creator.id !== item.from.id &&
    item.creator.id !== item.to.id
  ) {
    return `${item.creator.name}记录了：${transfer}`;
  }
  return transfer;
}

export function settlementPresentation(
  direction: SettlementDirection,
): SettlementPresentation {
  if (direction === "outgoing") {
    return { prefix: "−", status: "已付款", tone: "negative" };
  }
  if (direction === "incoming") {
    return { prefix: "+", status: "已收款", tone: "positive" };
  }
  return { prefix: "", status: "转账记录", tone: "neutral" };
}
