import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { listMyCircles } from "../lib/api";
import { Plus, Svg } from "./ui";

const GREY = "#7c7c82";

function TabIcon({ kind, active }: { kind: string; active: boolean }) {
  const s = active ? "var(--blue)" : GREY;
  switch (kind) {
    case "circles":
      return active ? (
        <Svg size={23} fill="var(--blue)" stroke="none">
          <circle cx="9" cy="12" r="6" opacity="0.45" />
          <circle cx="15" cy="12" r="6" />
        </Svg>
      ) : (
        <Svg size={23} stroke={s} w={1.9}>
          <circle cx="9" cy="12" r="6" />
          <circle cx="15" cy="12" r="6" />
        </Svg>
      );
    case "activity":
      return <Svg size={23} stroke={s} w={active ? 2.3 : 1.8}><path d="M2 12h4l2.5-7 4 14 2.5-7H22" /></Svg>;
    case "assistant":
      return <Svg size={23} stroke={s} w={active ? 2.2 : 1.8}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.6A8.4 8.4 0 1 1 21 11.5z" /></Svg>;
    default:
      return <Svg size={23} stroke={s} w={active ? 2.1 : 1.8}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></Svg>;
  }
}

const TABS = [
  { to: "/", label: "圈子", kind: "circles", end: true },
  { to: "/activity", label: "动态", kind: "activity" },
  { to: "/assistant", label: "助手", kind: "assistant" },
  { to: "/profile", label: "我的", kind: "profile" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const circles = useQuery({ queryKey: ["circles"], queryFn: listMyCircles });

  function record() {
    const m = /^\/circles\/([^/]+)(?!.*\/add)/.exec(location.pathname);
    if (m) return navigate(`/circles/${m[1]}/add`);
    const list = circles.data ?? [];
    if (list.length === 1) navigate(`/circles/${list[0].id}/add`);
    else navigate("/");
  }

  return (
    <div className="min-h-full pb-[104px]">
      {children}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md items-center gap-[9px] px-3 pb-[max(18px,env(safe-area-inset-bottom))]">
        <nav className="blur-pill flex h-[60px] flex-1 items-center justify-between rounded-[30px] px-1.5">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className="flex flex-col items-center justify-center gap-[2px] rounded-[24px] px-2.5 py-1.5"
            >
              {({ isActive }) => (
                <span
                  className="flex flex-col items-center gap-[2px] rounded-[24px] px-2.5 py-1"
                  style={isActive ? { background: "rgba(255,255,255,.92)", boxShadow: "0 1px 3px rgba(0,0,0,.09)" } : undefined}
                >
                  <TabIcon kind={t.kind} active={isActive} />
                  <span className="text-[10px]" style={{ color: isActive ? "var(--blue)" : GREY, fontWeight: isActive ? 600 : 500 }}>
                    {t.label}
                  </span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <button onClick={record} aria-label="记一笔" className="blur-pill grid h-[60px] w-[60px] flex-none place-items-center rounded-full active:opacity-80">
          <Plus size={26} />
        </button>
      </div>
    </div>
  );
}
