import { formatMoney } from "@aa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Avatar,
  Button,
  Card,
  ChevronR,
  Dialog,
  EmptyState,
  ErrorState,
  Hero,
  Icon,
  IconTile,
  Input,
  Skeleton,
} from "../../components/ui";
import {
  createCircle,
  getMyBalances,
  getMyProfile,
  listMyCircles,
} from "../../lib/api";
import { summarizeBalances } from "../../lib/balanceSummary";
import type { CurrencySummary } from "../../lib/balanceSummary";
import { useAuth } from "../auth/AuthProvider";

const CURRENCIES = ["CNY", "USD", "EUR", "JPY", "HKD", "GBP"];
export function CirclesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const circles = useQuery({ queryKey: ["circles"], queryFn: listMyCircles });
  const profile = useQuery({ queryKey: ["my-profile"], queryFn: getMyProfile });
  const balances = useQuery({
    queryKey: ["my-balances"],
    queryFn: getMyBalances,
  });
  const [panel, setPanel] = useState<"closed" | "chooser" | "create">("closed");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (location.state?.create) setPanel("chooser");
    if (location.state?.notice) setNotice(location.state.notice);
    if (location.state)
      navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);
  const create = useMutation({
    mutationFn: () => createCircle({ name: name.trim(), currency }),
    onSuccess: async (circle) => {
      setPanel("closed");
      setName("");
      // Seed the new circle before the shell's membership guard sees its route.
      qc.setQueryData(["circles"], (old: typeof circles.data) => [
        circle,
        ...(old ?? []).filter((c) => c.id !== circle.id),
      ]);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["circles"] }),
        qc.invalidateQueries({ queryKey: ["my-balances"] }),
      ]);
      navigate(`/circles/${circle.id}`);
    },
  });
  let summaries: CurrencySummary[] = [];
  let summaryError: string | null = null;
  if (circles.data && balances.data) {
    try {
      summaries = summarizeBalances(circles.data, balances.data);
    } catch (error) {
      summaryError = (error as Error).message;
    }
  }
  const refreshing = circles.isLoading || balances.isLoading;
  const netByCircle = new Map(
    balances.data?.map((b) => [b.circle_id, b.net_minor]),
  );
  const retry = () => {
    void circles.refetch();
    void balances.refetch();
  };
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">一起生活 · 轻松分账</p>
          <h1>我的圈子</h1>
          <p className="page-subtitle">每一份共同开销，都有清晰的记录。</p>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="创建或加入圈子"
            onClick={() => {
              create.reset();
              setPanel("chooser");
            }}
          >
            <Icon name="plus" />
          </button>
          <Link to="/profile" aria-label="个人资料">
            <Avatar
              name={profile.data?.display_name || "我"}
              seed={user?.id}
              me
              size={38}
            />
          </Link>
        </div>
      </header>
      {notice && (
        <div
          role="status"
          className="success-note flex items-center justify-between"
        >
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {refreshing ? (
        <div className="mb-7">
          <Skeleton lines={2} />
        </div>
      ) : circles.isError || balances.isError || summaryError ? (
        <div className="mb-7">
          <ErrorState
            message={summaryError ?? "余额加载失败，请重试。"}
            onRetry={retry}
          />
        </div>
      ) : summaries.length > 0 ? (
        <div className="balance-grid">
          {summaries.map((s) => (
            <Hero key={s.currency}>
              <div className="summary-top">
                <span className="balance-label">当前净结余</span>
                <span className="currency-badge">{s.currency}</span>
              </div>
              <div
                className="balance-amount tnum"
                style={{
                  color:
                    s.net > 0
                      ? "var(--green)"
                      : s.net < 0
                        ? "var(--red)"
                        : "var(--ink)",
                }}
              >
                {s.net > 0 ? "+" : ""}
                {formatMoney(s.net, s.currency)}
              </div>
              <div className="balance-footer">
                <div>
                  <small>待收款</small>
                  <strong className="tnum">
                    {formatMoney(s.credit, s.currency)}
                  </strong>
                </div>
                <div>
                  <small>待付款</small>
                  <strong className="tnum">
                    {formatMoney(s.debit, s.currency)}
                  </strong>
                </div>
                <span className="ml-auto self-end text-[12px] text-[var(--label2)]">
                  {s.count} 个圈子
                </span>
              </div>
            </Hero>
          ))}
        </div>
      ) : null}
      <div className="section-heading">
        <h2>
          全部圈子{" "}
          <span className="count-badge ml-2">
            {circles.data?.length ?? "—"}
          </span>
        </h2>
        <button
          className="text-[13px] text-[var(--blue)] min-h-11"
          onClick={() => navigate("/join")}
        >
          加入圈子
        </button>
      </div>
      {circles.isLoading ? (
        <Skeleton />
      ) : circles.isError ? (
        <ErrorState onRetry={() => void circles.refetch()} />
      ) : circles.data?.length ? (
        <div className="circle-grid">
          {circles.data.map((c) => {
            const n = balances.isError ? undefined : netByCircle.get(c.id);
            return (
              <Link
                className="card circle-card"
                key={c.id}
                to={`/circles/${c.id}`}
              >
                <div className="circle-card-top">
                  <IconTile size={44}>
                    <Icon name="circles" size={24} />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate">{c.name}</h3>
                    <p className="truncate">
                      {c.description || "共享账本"} · {c.default_currency}
                    </p>
                  </div>
                  <ChevronR />
                </div>
                <div className="circle-card-bottom">
                  <span className="text-[12px] text-[var(--label2)]">
                    {n === undefined
                      ? "余额待更新"
                      : n === 0
                        ? "你在本圈已结清"
                        : n > 0
                          ? "你在本圈应收"
                          : "你在本圈应付"}
                  </span>
                  <span
                    className="tnum text-[17px] font-semibold"
                    style={{
                      color:
                        n === undefined || n === 0
                          ? "var(--label2)"
                          : n > 0
                            ? "var(--green)"
                            : "var(--red)",
                    }}
                  >
                    {n === undefined
                      ? "—"
                      : formatMoney(Math.abs(n), c.default_currency)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="让第一笔开销，有个归属"
            description="旅行、聚餐，或日常的小事。创建一个圈子，邀请朋友一起记账。"
            action={
              <Button className="w-auto" onClick={() => setPanel("create")}>
                <Icon name="plus" size={18} />
                新建圈子
              </Button>
            }
          />
        </Card>
      )}
      <Dialog
        title={panel === "create" ? "新建圈子" : "一起开始记账"}
        open={panel !== "closed"}
        busy={create.isPending}
        onClose={() => setPanel("closed")}
      >
        {panel === "chooser" ? (
          <>
            <button
              className="list-row w-full text-left"
              onClick={() => setPanel("create")}
            >
              <IconTile>
                <Icon name="plus" />
              </IconTile>
              <span className="flex-1">
                <strong className="block text-[15px]">新建圈子</strong>
                <small className="text-[var(--label2)]">
                  给共同开销建一个账本
                </small>
              </span>
              <ChevronR />
            </button>
            <button
              className="list-row w-full text-left"
              onClick={() => navigate("/join")}
            >
              <IconTile>
                <Icon name="invite" />
              </IconTile>
              <span className="flex-1">
                <strong className="block text-[15px]">输入邀请码或链接</strong>
                <small className="text-[var(--label2)]">加入朋友的圈子</small>
              </span>
              <ChevronR />
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && !create.isPending) create.mutate();
            }}
          >
            <label className="field-label" htmlFor="circle-name">
              圈子名称
            </label>
            <div className="select-field">
              <Input
                id="circle-name"
                aria-label="圈子名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：周末旅行"
                maxLength={100}
                autoFocus
              />
            </div>
            <label className="field-label" htmlFor="circle-currency">
              账本币种
            </label>
            <select
              id="circle-currency"
              className="select-field"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <p className="mt-3 text-[12px] text-[var(--label2)]">
              所有账单均使用此币种，金额分别统计。
            </p>
            {create.error && (
              <p role="alert" className="mt-3 text-[13px] text-[var(--red)]">
                {(create.error as Error).message}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                variant="ghost"
                disabled={create.isPending}
                onClick={() => setPanel("closed")}
              >
                取消
              </Button>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {create.isPending ? "创建中…" : "创建圈子"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
