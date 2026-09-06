import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { listMyCircles } from "../lib/api";
import { useCircleRealtime } from "../features/circles/useCircleRealtime";
import {
  BrandMark,
  Button,
  ChevronR,
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
} from "./ui";
import type { IconName } from "./ui";

const tabs: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "圈子", icon: "circles" },
  { to: "/activity", label: "动态", icon: "activity" },
  { to: "/profile", label: "我的", icon: "profile" },
];
export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const circles = useQuery({
    queryKey: ["circles"],
    queryFn: listMyCircles,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });
  const [chooser, setChooser] = useState(false);
  const pendingCircle = useRef<string | null>(null);
  const currentCircleId = /^\/circles\/([^/]+)/.exec(location.pathname)?.[1];

  useEffect(() => {
    if (
      currentCircleId &&
      circles.isSuccess &&
      !circles.isFetching &&
      !circles.data.some((c) => c.id === currentCircleId)
    ) {
      for (const key of [
        "circle",
        "members",
        "participants",
        "expenses",
        "balances",
        "settlements",
      ])
        qc.removeQueries({ queryKey: [key, currentCircleId] });
      navigate("/", { replace: true, state: { notice: "你已退出该圈子。" } });
    }
  }, [
    currentCircleId,
    circles.data,
    circles.isSuccess,
    circles.isFetching,
    navigate,
    qc,
  ]);

  useCircleRealtime();

  function record() {
    if (currentCircleId) return navigate(`/circles/${currentCircleId}/add`);
    if (circles.data?.length === 1)
      return navigate(`/circles/${circles.data[0].id}/add`);
    setChooser(true);
  }
  const nav = (
    <nav className="primary-nav" aria-label="主导航">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === "/"}
          className={({ isActive }) =>
            isActive || (t.to === "/" && currentCircleId) ? "active" : ""
          }
        >
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
  const recordButton = (
    <button
      type="button"
      onClick={record}
      className="record-button"
      aria-label="记一笔"
    >
      <Icon name="plus" size={24} />
      <span>记一笔</span>
    </button>
  );
  return (
    <div
      className="app-shell"
      onClickCapture={(e) => {
        const button = (e.target as Element).closest("button");
        button?.focus({ preventScroll: true });
      }}
    >
      <aside className="sidebar">
        <NavLink className="sidebar-brand" to="/">
          <BrandMark />
          <div>
            AA 记账<small>一起生活，轻松分账</small>
          </div>
        </NavLink>
        <p className="sidebar-caption">我的账本</p>
        {nav}
        {recordButton}
        <div className="sidebar-footer">
          <Icon name="shield" size={16} />
          <span>每一笔，都清清楚楚</span>
        </div>
      </aside>
      <main className="app-main">{children}</main>
      <div className="nav-dock">
        {nav}
        {recordButton}
      </div>
      <Dialog
        open={chooser}
        onClose={() => {
          pendingCircle.current = null;
          setChooser(false);
        }}
        onClosed={() => {
          if (pendingCircle.current) {
            const target = pendingCircle.current;
            pendingCircle.current = null;
            navigate(`/circles/${target}/add`);
          }
        }}
        title="选择记账圈子"
      >
        {circles.isLoading ? (
          <Skeleton lines={2} />
        ) : circles.isError ? (
          <ErrorState onRetry={() => void circles.refetch()} />
        ) : circles.data?.length ? (
          <div>
            {circles.data.map((c) => (
              <button
                className="list-row w-full text-left"
                key={c.id}
                onClick={() => {
                  pendingCircle.current = c.id;
                  setChooser(false);
                }}
              >
                <Icon name="circles" />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="currency-badge">{c.default_currency}</span>
                <ChevronR />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="先拥有一个圈子"
            description="新建一个圈子，或加入朋友的圈子，就可以开始记账。"
            action={
              <Button
                onClick={() => {
                  setChooser(false);
                  navigate("/", { state: { create: true } });
                }}
              >
                创建或加入圈子
              </Button>
            }
          />
        )}
      </Dialog>
    </div>
  );
}
