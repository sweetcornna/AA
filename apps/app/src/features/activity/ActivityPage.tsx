import { formatMoney } from "@aa/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  CategoryGlyph,
  Centered,
  Hairline,
  IconTile,
  Segmented,
  Spinner,
  Svg,
} from "../../components/ui";
import {
  expenseActivityTitle,
  settlementActivityTitle,
  settlementPresentation,
  type ActivityScope,
} from "../../lib/activity";
import { listActivity } from "../../lib/api";
import type { ActivityItem } from "../../lib/activity";
import { useAuth } from "../auth/AuthProvider";

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return iso.slice(0, 10);
}

function bucketOf(iso: string): string {
  const now = new Date();
  const d = new Date(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const sameDay = now.toDateString() === d.toDateString();
  if (sameDay) return "今天";
  if (days <= 1) return "昨天";
  if (days <= 7) return "本周";
  return "更早";
}

function settlementColor(tone: "negative" | "positive" | "neutral") {
  if (tone === "positive") return "var(--green)";
  if (tone === "negative") return "var(--red)";
  return "var(--ink)";
}

export function ActivityPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<ActivityScope>("all");
  const activity = useQuery({
    queryKey: ["activity", user?.id, scope],
    queryFn: () => listActivity(scope, user!.id),
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });

  const items = activity.data ?? [];
  const order = ["今天", "昨天", "本周", "更早"];
  const groups = new Map<string, ActivityItem[]>();
  for (const it of items) {
    const k = bucketOf(it.at);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-3">
      <header className="mb-3 flex items-end justify-between">
        <h1 className="text-[32px] font-bold tracking-[-0.022em]">动态</h1>
        <Segmented
          className="mb-1"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "全部" },
            { value: "mine", label: "与我有关" },
          ]}
        />
      </header>

      {activity.isLoading ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : activity.isError && items.length === 0 ? (
        <div className="mt-12 text-center" role="alert">
          <p className="text-[15px]" style={{ color: "var(--red)" }}>
            动态加载失败，请检查网络后重试。
          </p>
          <Button
            className="mx-auto mt-4 w-auto px-6"
            variant="plain"
            onClick={() => void activity.refetch()}
            disabled={activity.isFetching}
          >
            {activity.isFetching ? "正在重试…" : "重试"}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-[15px]" style={{ color: "var(--label2)" }}>
            {scope === "all"
              ? "还没有动态，去记一笔吧。"
              : "还没有与你有关的动态。"}
          </p>
          {scope === "mine" && (
            <p className="mx-auto mt-2 max-w-[270px] text-[13px] leading-relaxed" style={{ color: "var(--label3)" }}>
              你付款、参与分摊、收付款或记录账目后，会显示在这里。
            </p>
          )}
        </div>
      ) : (
        order
          .filter((k) => groups.has(k))
          .map((k) => (
            <div key={k} className="mb-5">
              <div className="mb-[7px] px-1.5 text-[13px] font-semibold" style={{ color: "var(--label3)" }}>{k}</div>
              <Card className="rounded-[14px]">
                {groups.get(k)!.map((it, i) => {
                  const settlement =
                    it.kind === "settlement"
                      ? settlementPresentation(it.direction)
                      : null;
                  return (
                    <div key={`${it.kind}-${it.id}`}>
                      {i > 0 && <Hairline inset={68} />}
                      <Link to={`/circles/${it.circleId}`} className="flex items-center gap-3 py-3 pl-4 pr-3.5 active:bg-black/5">
                        <IconTile size={40} radius={12}>
                          {it.kind === "expense" ? (
                            <CategoryGlyph category={it.category} />
                          ) : (
                            <Svg size={22} w={2.1}><path d="M20 7 9.5 17.5 4 12" /></Svg>
                          )}
                        </IconTile>
                        <div className="min-w-0 flex-1">
                          <div className="text-[15px] leading-tight tracking-[-0.01em]">
                            {it.kind === "expense"
                              ? expenseActivityTitle(it)
                              : settlementActivityTitle(it)}
                          </div>
                          <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--label2)" }}>
                            {it.circleName} · {ago(it.at)}
                          </div>
                        </div>
                        <div className="flex-none text-right">
                          <div
                            className="tnum text-[15px] font-semibold"
                            style={{
                              color: settlement
                                ? settlementColor(settlement.tone)
                                : "var(--ink)",
                            }}
                          >
                            {it.kind === "expense" ? "总额 " : settlement?.prefix}
                            {formatMoney(it.amountMinor, it.currency)}
                          </div>
                          {it.kind === "expense" && it.myOwedMinor !== null ? (
                            <div className="mt-0.5 text-[12px]" style={{ color: "var(--label2)" }}>
                              我的份额 {formatMoney(it.myOwedMinor, it.currency)}
                            </div>
                          ) : it.kind === "settlement" ? (
                            <div className="mt-0.5 text-[12px]" style={{ color: "var(--label2)" }}>
                              {settlement!.status}
                            </div>
                          ) : null}
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </Card>
            </div>
          ))
      )}
    </div>
  );
}
