import { formatMoney, minimizeTransfers } from "@aa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Button,
  Card,
  CategoryGlyph,
  Dialog,
  EmptyState,
  ErrorState,
  GroupLabel,
  Hero,
  Icon,
  IconTile,
  NavBar,
  Skeleton,
  Spinner,
} from "../../components/ui";
import {
  createSettlement,
  getBalances,
  getCircle,
  leaveCircle,
  listCircleParticipants,
  listExpenses,
  listMembers,
  listSettlements,
} from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
const InviteSection = lazy(() =>
  import("../invitations/InviteSection").then((m) => ({
    default: m.InviteSection,
  })),
);
type Transfer = { from: string; to: string; amount: number };
export function CircleDetailPage() {
  const { circleId = "" } = useParams<{ circleId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [panel, setPanel] = useState<"closed" | "menu" | "invite" | "leave">(
    "closed",
  );
  const [successor, setSuccessor] = useState("");
  const [payment, setPayment] = useState<Transfer | null>(null);
  const circle = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => getCircle(circleId),
  });
  const members = useQuery({
    queryKey: ["members", circleId],
    queryFn: () => listMembers(circleId),
  });
  const participants = useQuery({
    queryKey: ["participants", circleId],
    queryFn: () => listCircleParticipants(circleId),
  });
  const expenses = useQuery({
    queryKey: ["expenses", circleId],
    queryFn: () => listExpenses(circleId),
  });
  const balances = useQuery({
    queryKey: ["balances", circleId],
    queryFn: () => getBalances(circleId),
  });
  const settlements = useQuery({
    queryKey: ["settlements", circleId],
    queryFn: () => listSettlements(circleId),
  });
  const currency = circle.data?.default_currency ?? "CNY";
  const me = members.data?.find((m) => m.user_id === user?.id);
  const others = members.data?.filter((m) => m.user_id !== user?.id) ?? [];
  const needsSuccessor = me?.role === "owner" && others.length > 0;
  const canInvite = me?.role === "owner" || me?.role === "admin";
  function nameOf(id: string) {
    if (id === user?.id) return "我";
    const person = participants.data?.find((p) => p.user_id === id);
    const name =
      person?.display_name ||
      members.data?.find((m) => m.user_id === id)?.profile?.display_name ||
      "成员";
    return person?.active === false ? `${name}（已退出）` : name;
  }
  const myNet = balances.isSuccess
    ? balances.data.find((b) => b.user_id === user?.id)?.net_minor
    : undefined;
  const balanceKnown = myNet !== undefined && !balances.isError;
  const transfers = balances.isSuccess
    ? minimizeTransfers(
        new Map(balances.data.map((b) => [b.user_id, b.net_minor])),
      )
    : [];
  const total = expenses.data?.reduce(
    (sum, expense) => sum + expense.amount_minor,
    0,
  );
  const settle = useMutation({
    mutationFn: (t: Transfer) =>
      createSettlement({
        circleId,
        fromUser: t.from,
        toUser: t.to,
        amountMinor: t.amount,
        currency,
      }),
    onSuccess: async () => {
      setPayment(null);
      await Promise.all(
        ["balances", "settlements", "my-balances", "activity"].map((key) =>
          qc.invalidateQueries({
            queryKey:
              key === "balances" || key === "settlements"
                ? [key, circleId]
                : [key],
          }),
        ),
      );
    },
  });
  const leave = useMutation({
    mutationFn: () =>
      leaveCircle(circleId, needsSuccessor ? successor : undefined),
    onSuccess: async () => {
      setPanel("closed");
      await qc.cancelQueries();
      qc.setQueryData(["circles"], (old: { id: string }[] | undefined) =>
        old?.filter((c) => c.id !== circleId),
      );
      navigate("/", {
        replace: true,
        state: { notice: "已退出圈子，历史账目已保留。" },
      });
      for (const key of [
        "circle",
        "members",
        "participants",
        "expenses",
        "balances",
        "settlements",
      ])
        qc.removeQueries({ queryKey: [key, circleId] });
      await Promise.all(
        ["circles", "my-balances", "activity"].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
    onError: () => {
      void balances.refetch();
      void members.refetch();
    },
  });
  if (circle.isLoading)
    return (
      <div className="page">
        <Skeleton />
      </div>
    );
  if (circle.isError || !circle.data)
    return (
      <div className="page">
        <NavBar title="圈子" onBack={() => navigate("/")} />
        <ErrorState
          message="圈子暂时无法访问。你可能已退出，或网络暂不可用。"
          onRetry={() => void circle.refetch()}
        />
      </div>
    );
  return (
    <div className="page !pt-0">
      <NavBar
        title={circle.data.name}
        onBack={() => navigate("/")}
        backLabel="圈子"
        right={
          <button
            className="icon-button"
            aria-label="更多"
            onClick={() => setPanel("menu")}
          >
            <Icon name="more" />
          </button>
        }
      />
      <div className="detail-grid">
        <div className="detail-overview">
          {balances.isLoading ? (
            <Skeleton lines={2} />
          ) : !balanceKnown ? (
            <ErrorState
              message="余额加载失败，暂时无法结算或退出。"
              onRetry={() => void balances.refetch()}
            />
          ) : (
            <Hero>
              <div className="summary-top">
                <span className="balance-label">
                  {myNet === 0
                    ? "你在本圈已结清"
                    : myNet! > 0
                      ? "你在本圈应收"
                      : "你在本圈应付"}
                </span>
                <span className="currency-badge">{currency}</span>
              </div>
              <div
                className="balance-amount tnum"
                style={{
                  color:
                    myNet! > 0
                      ? "var(--green)"
                      : myNet! < 0
                        ? "var(--red)"
                        : "var(--ink)",
                }}
              >
                {formatMoney(Math.abs(myNet!), currency)}
              </div>
              <div className="balance-footer">
                <div>
                  <small>累计账单</small>
                  <strong className="tnum">
                    {expenses.isError || total === undefined
                      ? "—"
                      : formatMoney(total, currency)}
                  </strong>
                </div>
                <div className="ml-auto">
                  <small>成员</small>
                  <strong>
                    {members.isError ? "—" : (members.data?.length ?? "—")} 人
                  </strong>
                </div>
              </div>
            </Hero>
          )}
          <div>
            <GroupLabel>成员结余</GroupLabel>
            {members.isLoading || balances.isLoading ? (
              <Skeleton lines={2} />
            ) : members.isError || balances.isError ? (
              <ErrorState
                onRetry={() => {
                  void members.refetch();
                  void balances.refetch();
                }}
              />
            ) : (
              <Card>
                {members.data?.map((m) => {
                  const n = balances.data?.find(
                    (b) => b.user_id === m.user_id,
                  )?.net_minor;
                  return (
                    <div key={m.user_id} className="list-row !py-3">
                      <Avatar
                        name={m.profile?.display_name || "成员"}
                        seed={m.user_id}
                        me={m.user_id === user?.id}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium truncate">
                          {nameOf(m.user_id)}
                        </p>
                        {m.role !== "member" && (
                          <small className="text-[11px] text-[var(--label2)]">
                            {m.role === "owner" ? "圈主" : "管理员"}
                          </small>
                        )}
                      </div>
                      <span
                        className="tnum text-[13px] font-medium"
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
                          : n === 0
                            ? "已结清"
                            : `${n > 0 ? "应收 " : "应付 "}${formatMoney(Math.abs(n), currency)}`}
                      </span>
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
          {balanceKnown && transfers.length > 0 && (
            <section id="settlement-suggestions">
              <GroupLabel>
                结算建议{" "}
                <span className="count-badge">{transfers.length} 笔</span>
              </GroupLabel>
              <Card>
                {transfers.map((t) => (
                  <div
                    className="list-row flex-wrap !py-3"
                    key={`${t.from}-${t.to}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px]">
                        {nameOf(t.from)}{" "}
                        <span className="text-[var(--label2)]">付给</span>{" "}
                        {nameOf(t.to)}
                      </p>
                      <p className="tnum mt-1 text-[16px] font-semibold">
                        {formatMoney(t.amount, currency)}
                      </p>
                    </div>
                    {t.from === user?.id && (
                      <Button
                        variant="secondary"
                        className="!min-h-9 !px-3 !text-[12px]"
                        onClick={() => {
                          settle.reset();
                          setPayment(t);
                        }}
                      >
                        标记已付
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
            </section>
          )}
          <Button onClick={() => navigate(`/circles/${circleId}/add`)}>
            <Icon name="plus" size={19} />
            记一笔
          </Button>
        </div>
        <div className="detail-ledger">
          <section>
            <div className="section-heading">
              <h2>账单记录</h2>
              <span className="count-badge">
                {expenses.data?.length ?? "—"} 笔
              </span>
            </div>
            {expenses.isLoading ? (
              <Skeleton />
            ) : expenses.isError ? (
              <ErrorState onRetry={() => void expenses.refetch()} />
            ) : expenses.data?.length ? (
              <Card>
                {expenses.data.map((e) => (
                  <div key={e.id} className="list-row">
                    <IconTile>
                      <CategoryGlyph category={e.category} />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <p className="row-title truncate">
                        {e.description || "未填写备注"}
                      </p>
                      <p className="row-description truncate">
                        {nameOf(e.payer_id)} 垫付 · {e.spent_at}
                      </p>
                    </div>
                    <div className="row-amount tnum">
                      {formatMoney(e.amount_minor, e.currency)}
                      <small>{e.category || "其他"}</small>
                    </div>
                  </div>
                ))}
              </Card>
            ) : (
              <Card>
                <EmptyState
                  icon="receipt"
                  title="还没有账单"
                  description="记下第一笔共同开销，分摊和结余会自动计算。"
                />
              </Card>
            )}
          </section>
          {participants.isError && (
            <ErrorState
              message="历史成员姓名加载失败。"
              onRetry={() => void participants.refetch()}
            />
          )}
          {settlements.isError ? (
            <ErrorState
              message="结算记录加载失败。"
              onRetry={() => void settlements.refetch()}
            />
          ) : (
            !!settlements.data?.length && (
              <section>
                <GroupLabel>结算记录</GroupLabel>
                <Card>
                  {settlements.data.map((s) => (
                    <div className="list-row" key={s.id}>
                      <IconTile>
                        <Icon name="check" />
                      </IconTile>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px]">
                          {nameOf(s.from_user)} 付给 {nameOf(s.to_user)}
                        </p>
                        <p className="row-description">
                          {s.settled_at.slice(0, 10)}
                        </p>
                      </div>
                      <span className="tnum text-[14px]">
                        {formatMoney(s.amount_minor, s.currency)}
                      </span>
                    </div>
                  ))}
                </Card>
              </section>
            )
          )}
        </div>
      </div>
      <Dialog
        title={
          panel === "leave"
            ? "退出圈子"
            : panel === "invite"
              ? "邀请朋友"
              : "圈子管理"
        }
        open={panel !== "closed"}
        busy={leave.isPending}
        onClose={() => setPanel("closed")}
      >
        {panel === "menu" ? (
          <div>
            {canInvite && (
              <button
                className="list-row w-full text-left"
                onClick={() => setPanel("invite")}
              >
                <Icon name="invite" />
                <span>邀请成员</span>
              </button>
            )}
            <button
              className="list-row w-full text-left text-[var(--red)]"
              onClick={() => {
                leave.reset();
                setSuccessor("");
                void balances.refetch();
                void members.refetch();
                setPanel("leave");
              }}
            >
              <Icon name="leave" />
              <span>退出圈子</span>
            </button>
          </div>
        ) : panel === "invite" ? (
          <Suspense fallback={<Spinner />}>
            <InviteSection circleId={circleId} />
          </Suspense>
        ) : (
          <>
            <p className="text-[14px] text-[var(--label2)] mb-4">
              退出「{circle.data.name}
              」后，你将无法查看此圈子。历史账单和结算记录会完整保留。
            </p>
            {!balanceKnown || members.isError ? (
              <ErrorState
                message="需要读取最新余额与成员信息后才能退出。"
                onRetry={() => {
                  void balances.refetch();
                  void members.refetch();
                }}
              />
            ) : myNet !== 0 ? (
              <div className="notice">
                你还有
                <strong className="tnum text-[var(--red)]">
                  {myNet! > 0 ? "应收 " : "应付 "}
                  {formatMoney(Math.abs(myNet!), currency)}
                </strong>
                ，请先完成结算。
              </div>
            ) : (
              <div className="notice">
                款项已结清，可以退出。
                {others.length === 0 &&
                  "你是最后一名成员，退出后所有邀请将失效。"}
              </div>
            )}
            {needsSuccessor && (
              <>
                <label className="field-label" htmlFor="successor">
                  选择新圈主
                </label>
                <select
                  id="successor"
                  className="select-field"
                  value={successor}
                  onChange={(e) => setSuccessor(e.target.value)}
                >
                  <option value="">请选择一位现有成员</option>
                  {others.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {nameOf(m.user_id)}
                    </option>
                  ))}
                </select>
              </>
            )}
            {leave.error && (
              <p role="alert" className="text-[13px] text-[var(--red)] mt-3">
                {(leave.error as Error).message}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                variant="ghost"
                onClick={() => setPanel("closed")}
                disabled={leave.isPending}
              >
                取消
              </Button>
              {balanceKnown && myNet !== 0 ? (
                <Button
                  onClick={() => {
                    setPanel("closed");
                    setTimeout(
                      () =>
                        document
                          .getElementById("settlement-suggestions")
                          ?.scrollIntoView({
                            behavior: matchMedia(
                              "(prefers-reduced-motion: reduce)",
                            ).matches
                              ? "instant"
                              : "smooth",
                            block: "center",
                          }),
                      200,
                    );
                  }}
                >
                  查看结算
                </Button>
              ) : (
                <Button
                  variant="danger"
                  disabled={
                    leave.isPending ||
                    !balanceKnown ||
                    myNet !== 0 ||
                    !me ||
                    members.isError ||
                    members.isFetching ||
                    balances.isFetching ||
                    (needsSuccessor &&
                      !others.some((m) => m.user_id === successor))
                  }
                  onClick={() => leave.mutate()}
                >
                  {leave.isPending ? "正在退出…" : "确认退出"}
                </Button>
              )}
            </div>
          </>
        )}
      </Dialog>
      <Dialog
        open={payment !== null}
        onClose={() => setPayment(null)}
        title="确认已付款"
        busy={settle.isPending}
      >
        {payment && (
          <>
            <p className="text-[14px] text-[var(--label2)]">
              请确认你已向 {nameOf(payment.to)}{" "}
              实际支付以下金额。此操作仅记录结算，不会发起转账。
            </p>
            <p className="balance-amount tnum">
              {formatMoney(payment.amount, currency)}
            </p>
            {settle.error && (
              <p role="alert" className="text-[13px] text-[var(--red)]">
                结算失败，请刷新余额后重试。
              </p>
            )}
            <div className="dialog-actions">
              <Button
                variant="ghost"
                disabled={settle.isPending}
                onClick={() => setPayment(null)}
              >
                取消
              </Button>
              <Button
                disabled={settle.isPending}
                onClick={() => settle.mutate(payment)}
              >
                {settle.isPending ? "记录中…" : "确认已付"}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
