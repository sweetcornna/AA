import { formatMoney, minimizeTransfers } from "@aa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Button,
  Card,
  CategoryGlyph,
  Centered,
  GroupLabel,
  Hairline,
  Hero,
  IconTile,
  NavBar,
  Spinner,
  Svg,
} from "../../components/ui";
import {
  createSettlement,
  getBalances,
  getCircle,
  listExpenses,
  listMembers,
  listSettlements,
} from "../../lib/api";
import type { CircleMember } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { InviteSection } from "../invitations/InviteSection";
import { useCircleRealtime } from "./useCircleRealtime";

function nameOf(members: CircleMember[] | undefined, id: string, me?: string) {
  if (id === me) return "我";
  return members?.find((x) => x.user_id === id)?.profile?.display_name ?? "成员";
}

export function CircleDetailPage() {
  const { circleId } = useParams<{ circleId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useCircleRealtime(circleId);
  const [showInvite, setShowInvite] = useState(false);

  const circle = useQuery({ queryKey: ["circle", circleId], queryFn: () => getCircle(circleId!), enabled: !!circleId });
  const members = useQuery({ queryKey: ["members", circleId], queryFn: () => listMembers(circleId!), enabled: !!circleId });
  const expenses = useQuery({ queryKey: ["expenses", circleId], queryFn: () => listExpenses(circleId!), enabled: !!circleId });
  const balances = useQuery({ queryKey: ["balances", circleId], queryFn: () => getBalances(circleId!), enabled: !!circleId });
  const settlements = useQuery({ queryKey: ["settlements", circleId], queryFn: () => listSettlements(circleId!), enabled: !!circleId });

  const currency = circle.data?.default_currency ?? "CNY";
  const settle = useMutation({
    mutationFn: (t: { from: string; to: string; amount: number }) =>
      createSettlement({ circleId: circleId!, fromUser: t.from, toUser: t.to, amountMinor: t.amount, currency }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["balances", circleId] });
      qc.invalidateQueries({ queryKey: ["settlements", circleId] });
      qc.invalidateQueries({ queryKey: ["my-balances"] });
    },
  });

  if (circle.isLoading) return <Centered><Spinner /></Centered>;
  if (circle.error) return <p className="p-6 text-center text-[14px]" style={{ color: "var(--red)" }}>{(circle.error as Error).message}</p>;

  const net = new Map((balances.data ?? []).map((b) => [b.user_id, b.net_minor]));
  const transfers = minimizeTransfers(net);
  const myNet = (user && net.get(user.id)) ?? 0;
  const total = (expenses.data ?? []).reduce((s, e) => s + e.amount_minor, 0);

  return (
    <div className="mx-auto max-w-md">
      <NavBar
        title={circle.data?.name ?? ""}
        onBack={() => navigate("/")}
        backLabel="圈子"
        right={
          <button onClick={() => setShowInvite((v) => !v)} aria-label="邀请">
            <Svg size={22} stroke="var(--blue)" w={2}><circle cx="12" cy="5" r="1.4" fill="var(--blue)" /><circle cx="12" cy="12" r="1.4" fill="var(--blue)" /><circle cx="12" cy="19" r="1.4" fill="var(--blue)" /></Svg>
          </button>
        }
      />

      <div className="space-y-[18px] px-4 pb-4 pt-1.5">
        {showInvite && <InviteSection circleId={circleId!} />}

        <Hero>
          <div className="text-[13px]" style={{ color: "rgba(255,255,255,.62)" }}>你在本圈{myNet >= 0 ? "应收" : "应付"}</div>
          <div className="tnum mt-[5px] text-[40px] font-semibold leading-none" style={{ color: myNet >= 0 ? "var(--green-bright)" : "#ff6b6b" }}>
            {myNet >= 0 ? "+" : "−"}¥{Math.abs(myNet / 100).toFixed(2).split(".")[0]}
            <span style={{ color: myNet >= 0 ? "rgba(48,209,88,.55)" : "rgba(255,107,107,.55)" }}>.{Math.abs(myNet / 100).toFixed(2).split(".")[1]}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-3.5" style={{ borderColor: "rgba(255,255,255,.13)", marginTop: 16 }}>
            <div className="flex -space-x-2.5">
              {(members.data ?? []).slice(0, 4).map((m) => (
                <span key={m.user_id} style={{ boxShadow: "0 0 0 2px #232326", borderRadius: "50%" }}>
                  <Avatar name={nameOf(members.data, m.user_id, user?.id)} seed={m.user_id} me={m.user_id === user?.id} size={30} />
                </span>
              ))}
            </div>
            <div className="tnum text-[12.5px]" style={{ color: "rgba(255,255,255,.55)" }}>
              {members.data?.length ?? 0} 位成员 · 共 {formatMoney(total, currency)} 账单
            </div>
          </div>
        </Hero>

        {/* member balances */}
        <div>
          <GroupLabel>成员结余</GroupLabel>
          <Card>
            {(balances.data ?? []).map((b, i) => (
              <div key={b.user_id}>
                {i > 0 && <Hairline inset={57} />}
                <div className="flex items-center gap-[11px] px-4 py-[9px]">
                  <Avatar name={nameOf(members.data, b.user_id, user?.id)} seed={b.user_id} me={b.user_id === user?.id} size={30} />
                  <span className="flex-1 text-[16px] font-medium tracking-[-0.01em]">{nameOf(members.data, b.user_id, user?.id)}</span>
                  <span className="tnum text-[15px] font-medium" style={{ color: b.net_minor > 0 ? "var(--green)" : b.net_minor < 0 ? "var(--red)" : "var(--label2)" }}>
                    {b.net_minor === 0 ? "已结清" : `${b.net_minor > 0 ? "应收 " : "应付 "}${formatMoney(Math.abs(b.net_minor), currency)}`}
                  </span>
                </div>
              </div>
            ))}
            {(balances.data ?? []).length === 0 && <div className="px-4 py-3 text-[14px]" style={{ color: "var(--label2)" }}>还没有账单。</div>}
          </Card>
        </div>

        {/* settle suggestions */}
        {transfers.length > 0 && (
          <div>
            <GroupLabel>结算建议 · {transfers.length} 笔</GroupLabel>
            <Card>
              {transfers.map((t, i) => (
                <div key={i}>
                  {i > 0 && <Hairline inset={57} />}
                  <div className="flex items-center gap-[11px] px-4 py-[9px]">
                    <Avatar name={nameOf(members.data, t.from, user?.id)} seed={t.from} me={t.from === user?.id} size={30} />
                    <span className="flex-1 text-[15px]">
                      {nameOf(members.data, t.from, user?.id)} <span style={{ color: "var(--label2)" }}>→</span> {nameOf(members.data, t.to, user?.id)}
                    </span>
                    <span className="tnum text-[15px] font-medium">{formatMoney(t.amount, currency)}</span>
                    <button className="text-[15px]" style={{ color: "var(--blue)" }} disabled={settle.isPending} onClick={() => settle.mutate(t)}>标记已付</button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* bills */}
        <div>
          <GroupLabel>账单 · {(expenses.data ?? []).length} 笔</GroupLabel>
          {expenses.isLoading ? (
            <Spinner />
          ) : (expenses.data ?? []).length > 0 ? (
            <Card>
              {expenses.data!.map((e, i) => (
                <div key={e.id}>
                  {i > 0 && <Hairline inset={62} />}
                  <div className="flex items-center gap-3 py-[10px] pl-4 pr-3.5">
                    <IconTile size={36} radius={10}>
                      <CategoryGlyph category={e.category} />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-medium tracking-[-0.01em]">{e.description || "（无备注）"}</div>
                      <div className="mt-px truncate text-[13px]" style={{ color: "var(--label2)" }}>{nameOf(members.data, e.payer_id, user?.id)} 垫付 · {e.spent_at}</div>
                    </div>
                    <span className="tnum text-[16px] font-medium">{formatMoney(e.amount_minor, e.currency)}</span>
                  </div>
                </div>
              ))}
            </Card>
          ) : (
            <Card><div className="px-4 py-3 text-[14px]" style={{ color: "var(--label2)" }}>还没有账单。</div></Card>
          )}
        </div>

        <Link to={`/circles/${circleId}/add`}>
          <Button>记一笔</Button>
        </Link>
      </div>
    </div>
  );
}
