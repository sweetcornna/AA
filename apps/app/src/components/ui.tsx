import { useEffect, useId, useRef, useState } from "react";
import brandSymbol from "../assets/brand-symbol.svg?raw";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

export function Svg({
  size = 24,
  stroke = "currentColor",
  w = 1.75,
  fill = "none",
  children,
}: {
  size?: number;
  stroke?: string;
  w?: number;
  fill?: string;
  children: ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill}
      stroke={stroke}
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
export type IconName =
  | "circles"
  | "activity"
  | "profile"
  | "plus"
  | "back"
  | "chevron"
  | "more"
  | "invite"
  | "leave"
  | "close"
  | "check"
  | "receipt"
  | "mic"
  | "sparkles"
  | "arrow-up"
  | "arrow-down"
  | "shield"
  | "copy";
const paths: Record<IconName, ReactNode> = {
  circles: (
    <>
      <circle cx="8.5" cy="9" r="3.5" />
      <circle cx="15.5" cy="15" r="3.5" />
      <path d="M12 5.8A7 7 0 0 1 21 13M12 18.2A7 7 0 0 1 3 11" />
    </>
  ),
  activity: (
    <>
      <path d="M5 3.5h14v17H5zM8.5 8h7M8.5 12h7M8.5 16h4" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 21v-1.5a7.5 7.5 0 0 1 15 0V21" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="m14.5 5-7 7 7 7" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  invite: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20v-1a6.5 6.5 0 0 1 13 0v1M19 7v6M16 10h6" />
    </>
  ),
  leave: (
    <>
      <path d="M10 4H5v16h5M10 12h12m-4-4 4 4-4 4" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  receipt: (
    <>
      <path d="M6 3.5h12v17l-3-1.5-3 1.5-3-1.5-3 1.5zM9 8h6M9 12h6M9 16h3" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11v1a6.5 6.5 0 0 0 13 0v-1M12 18.5V22M9 22h6" />
    </>
  ),
  sparkles: (
    <>
      <path d="m10 4 2.3 5.7L18 12l-5.7 2.3L10 20l-2.3-5.7L2 12l5.7-2.3zM19 2v5m-2.5-2.5h5" />
    </>
  ),
  "arrow-up": <path d="M12 19V5m-5 5 5-5 5 5" />,
  "arrow-down": <path d="M12 5v14m-5-5 5 5 5-5" />,
  shield: (
    <>
      <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M15 8V3H3v13h5" />
    </>
  ),
};
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <Svg size={size}>{paths[name]}</Svg>;
}
export function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
      // Static, bundled SVG is also the source for every platform icon.
      dangerouslySetInnerHTML={{ __html: brandSymbol }}
    />
  );
}
export const ChevronR = ({
  stroke = "var(--tertiary)",
  size = 18,
}: {
  stroke?: string;
  size?: number;
}) => (
  <Svg size={size} stroke={stroke}>
    {paths.chevron}
  </Svg>
);
export const ChevronL = ({
  stroke = "currentColor",
  size = 20,
}: {
  stroke?: string;
  size?: number;
}) => (
  <Svg size={size} stroke={stroke}>
    {paths.back}
  </Svg>
);
export const Plus = ({
  stroke = "currentColor",
  size = 24,
}: {
  stroke?: string;
  size?: number;
}) => (
  <Svg size={size} stroke={stroke}>
    {paths.plus}
  </Svg>
);
export function CategoryGlyph({ category }: { category: string | null }) {
  const categories: Record<string, ReactNode> = {
    餐饮: (
      <>
        <path d="M5 3v5a3 3 0 0 0 6 0V3M8 3v18M18 21V3c-3 2-4 6-4 9h4" />
      </>
    ),
    交通: (
      <>
        <path d="m4 11 2-6h12l2 6M4 11h16v8H4zM7 19v2m10-2v2M7 15h1m8 0h1" />
      </>
    ),
    住宿: (
      <>
        <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7" />
      </>
    ),
    购物: (
      <>
        <path d="M5 8h14l1 13H4zM9 9V6a3 3 0 0 1 6 0v3" />
      </>
    ),
    娱乐: (
      <>
        <path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM15 7v2m0 3v2m0 3v2" />
      </>
    ),
  };
  return <Svg size={22}>{categories[category ?? ""] ?? paths.receipt}</Svg>;
}
const AV = ["#876ba3", "#b87847", "#538b87", "#6582b4", "#a5657d"];
export function Avatar({
  name,
  seed,
  me = false,
  size = 32,
}: {
  name: string;
  seed?: string;
  me?: boolean;
  size?: number;
}) {
  let h = 0;
  for (const c of seed || name || "?") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: me ? "var(--blue)" : AV[h % AV.length],
      }}
    >
      {Array.from(name.trim())[0] || "?"}
    </span>
  );
}
export function IconTile({
  size = 42,
  radius = 13,
  children,
}: {
  size?: number;
  radius?: number;
  children: ReactNode;
}) {
  return (
    <span
      className="icon-tile"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {children}
    </span>
  );
}
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}
export function Hairline({ inset = 16 }: { inset?: number }) {
  return (
    <div
      aria-hidden="true"
      className="hairline"
      style={{ marginLeft: inset }}
    />
  );
}
export function GroupLabel({ children }: { children: ReactNode }) {
  return <h2 className="group-label">{children}</h2>;
}
export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      {children}
    </div>
  );
}
export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className="spinner"
      style={{ width: size, height: size }}
    />
  );
}
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="加载中" className="skeleton-stack">
      {Array.from({ length: lines }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon = "circles",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={32} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorState({
  message = "加载失败，请检查网络后重试。",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <Button variant="plain" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}
type Variant = "primary" | "plain" | "ghost" | "danger" | "secondary";
export function Button({
  className = "",
  variant = "primary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`button button-${variant} ${className}`}
      {...props}
    />
  );
}
export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      aria-label={props["aria-label"] ?? props.placeholder}
      className={`field-input ${className}`}
      {...props}
    />
  );
}
export interface SegOption<T extends string> {
  value: T;
  label: string;
}
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="group" className={`segmented ${className}`}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function LargeTitle({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {right}
    </header>
  );
}
export function NavBar({
  title,
  onBack,
  backLabel = "返回",
  right,
}: {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
}) {
  return (
    <header className="nav-bar">
      <div>
        {onBack && (
          <button className="back-button" onClick={onBack}>
            <ChevronL />
            {backLabel}
          </button>
        )}
      </div>
      <h1>{title}</h1>
      <div className="nav-right">{right}</div>
    </header>
  );
}
export function Hero({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section tabIndex={0} className={`balance-hero ${className}`}>
      {children}
    </section>
  );
}

/** Native dialog supplies focus trapping, background inertness and focus return. */
export function Dialog({
  open,
  onClose,
  onClosed,
  title,
  children,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onClosed?: () => void;
  title: string;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [present, setPresent] = useState(open);
  const titleId = useId();
  const lastContent = useRef({ title, children });
  if (open) lastContent.current = { title, children };
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      setPresent(true);
      if (!dialog.open) {
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        dialog.showModal();
      }
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }
    const timer = window.setTimeout(
      () => {
        if (dialog.open) {
          dialog.close();
          if (returnFocus.current?.isConnected)
            returnFocus.current.focus({ preventScroll: true });
        }
        setPresent(false);
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    );
    return () => window.clearTimeout(timer);
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      data-state={open ? "open" : "closed"}
      aria-labelledby={titleId}
      onClose={onClosed}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {(open || present) && (
        <div className="dialog-content">
          <div className="dialog-heading">
            <h2 id={titleId}>{lastContent.current.title}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭"
              disabled={busy}
              onClick={onClose}
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          {lastContent.current.children}
        </div>
      )}
    </dialog>
  );
}
