import { formatMoney } from "@aa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Button,
  Card,
  Centered,
  ChevronR,
  GroupLabel,
  Hairline,
  Hero,
  IconTile,
  Input,
  Plus,
  Segmented,
  Spinner,
  Svg,
} from "../../components/ui";
import { createCircle, getMyBalances, getMyProfile, listMyCircles } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";

const CURRENCIES = ["CNY", "USD", "EUR", "JPY", "HKD", "GBP"];
const BARS = [36, 54, 42, 70, 58, 48, 82, 64, 52, 100, 74, 60];

const GroupGlyph = () => (
  <Svg size={22}>
    <circle cx="9" cy="8.4" r="2.9" />
    <path d="M3.4 18.8c0-3.1 2.5-5 5.6-5s5.6 1.9 5.6 5" />
    <path d="M15.8 5.8a2.9 2.9 0 0 1 0 5.5" />
    <path d="M16.8 13.9c2.4.3 4 2 4 4.9" />
  </Svg>
);

export function CirclesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const circles = useQuery({ queryKey: ["circles"], queryFn: listMyCircles });
  const profile = useQuery({ queryKey: ["my-profile"], queryFn: getMyProfile });
  const balances = useQuery({ queryKey: ["my-balances"], queryFn: getMyBalances });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<string>("CNY");

  const create = useMutation({
    mutationFn: () => createCircle({ name: name.trim(), currency }),
    onSuccess: () => {
      setName("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["circles"] });
    },
  });

  const netByCircle = new Map((balances.data ?? []).map((b) => [b.circle_id, b.net_minor]));
  let credit = 0;
  let debit = 0;
  for (const b of balances.data ?? []) {
    if (b.net_minor > 0) credit += b.net_minor;
    else debit += -b.net_minor;
  }
  const net = credit - debit;

  return (
    <div className="mx-auto max-w-md px-4 pt-3">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-[32px] font-bold tracking-[-0.022em]">圈子</h1>
        <div className="flex items-center gap-3.5">
          <button onClick={() => setOpen((v) => !v)} aria-label="新建圈子">
            <Plus />
          </button>
          <Link to="/profile">
            <Avatar name={profile.data?.display_name || "我"} seed={user?.id} me size={32} />
          </Link>
        </div>
      </header>

      {open && (
        <Card className="mb-4 p-4">
          <div className="mb-2.5">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="圈子名称，如 周末旅行" autoFocus />
          </div>
          <Segmented
            value={currency}
            onChange={setCurrency}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
          {create.error && <p className="mt-2 text-[13px]" style={{ color: "var(--red)" }}>{(create.error as Error).message}</p>}
          <div className="mt-3 flex gap-2">
            <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "创建中…" : "创建"}</Button>
            <Button variant="ghost" className="px-4" onClick={() => setOpen(false)}>取消</Button>
          </div>
        </Card>
      )}

      <Hero className="mb-[26px]">
        <div className="flex items-center justify-between">
          <span className="text-[13px]" style={{ color: "rgba(255,255,255,.62)" }}>总结余</span>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ color: "rgba(255,255,255,.92)", background: "rgba(255,255,255,.14)" }}>本月</span>
        </div>
        <div className="tnum mt-[7px] text-[42px] font-semibold leading-none" style={{ color: "var(--green-bright)" }}>
          {net >= 0 ? "+" : "−"}¥{Math.abs(net / 100).toFixed(2).split(".")[0]}
          <span style={{ color: "rgba(48,209,88,.55)" }}>.{Math.abs(net / 100).toFixed(2).split(".")[1]}</span>
        </div>
        <div className="mt-[18px] flex h-9 items-end gap-[5px]">
          {BARS.map((h, i) => (
            <span key={i} className="flex-1 rounded-[2px]" style={{ height: `${h}%`, background: i === 9 ? "var(--green-bright)" : `rgba(255,255,255,${0.22 + (h / 100) * 0.14})` }} />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t pt-3.5" style={{ borderColor: "rgba(255,255,255,.13)" }}>
          <div className="flex gap-5">
            <div>
              <div className="text-[11px]" style={{ color: "rgba(255,255,255,.5)" }}>应收</div>
              <div className="tnum mt-0.5 text-[15px] font-semibold text-white">{formatMoney(credit, "CNY")}</div>
            </div>
            <div>
              <div className="text-[11px]" style={{ color: "rgba(255,255,255,.5)" }}>应付</div>
              <div className="tnum mt-0.5 text-[15px] font-semibold text-white">{formatMoney(debit, "CNY")}</div>
            </div>
          </div>
          <div className="text-[12px]" style={{ color: "rgba(255,255,255,.55)" }}>{circles.data?.length ?? 0} 个圈子</div>
        </div>
      </Hero>

      {circles.isLoading ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : circles.data && circles.data.length > 0 ? (
        <>
          <GroupLabel>全部圈子</GroupLabel>
          <Card>
            {circles.data.map((c, i) => {
              const n = netByCircle.get(c.id) ?? 0;
              return (
                <div key={c.id}>
                  {i > 0 && <Hairline inset={66} />}
                  <Link to={`/circles/${c.id}`} className="flex items-center gap-3 py-[11px] pl-4 pr-3.5 active:bg-black/5">
                    <IconTile>
                      <GroupGlyph />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-medium tracking-[-0.01em]">{c.name}</div>
                      <div className="mt-px truncate text-[13px]" style={{ color: "var(--label2)" }}>{c.description || `默认 ${c.default_currency}`}</div>
                    </div>
                    <span className="tnum text-[15px] font-medium" style={{ color: n > 0 ? "var(--green)" : n < 0 ? "var(--red)" : "var(--label2)" }}>
                      {n === 0 ? "已结清" : `${n > 0 ? "+" : "−"}${formatMoney(Math.abs(n), c.default_currency)}`}
                    </span>
                    <ChevronR />
                  </Link>
                </div>
              );
            })}
          </Card>
        </>
      ) : (
        <p className="mt-12 text-center text-[15px]" style={{ color: "var(--label2)" }}>
          还没有圈子，点右上角 + 新建一个，
          <br />
          把朋友拉进来一起 AA 吧。
        </p>
      )}
    </div>
  );
}
