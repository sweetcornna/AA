import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

/* ---------- icons ---------- */
export function Svg({
  size = 22,
  stroke = "#fff",
  w = 1.9,
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
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const ChevronR = ({ stroke = "var(--tertiary)", size = 18 }: { stroke?: string; size?: number }) => (
  <Svg size={size} stroke={stroke} w={2.4}><path d="m9 18 6-6-6-6" /></Svg>
);
export const ChevronL = ({ stroke = "var(--blue)", size = 20 }: { stroke?: string; size?: number }) => (
  <Svg size={size} stroke={stroke} w={2.4}><path d="m15 18-6-6 6-6" /></Svg>
);
export const Plus = ({ stroke = "var(--blue)", size = 24 }: { stroke?: string; size?: number }) => (
  <Svg size={size} stroke={stroke} w={2}><path d="M12 5v14M5 12h14" /></Svg>
);

/** Category glyph (white stroke) to sit inside an IconTile. */
export function CategoryGlyph({ category }: { category: string | null }) {
  switch (category) {
    case "餐饮":
      return (
        <Svg size={21}><path d="M7 3.4v3.5M9.5 3.4v3.5M12 3.4v3.5" /><path d="M7 6.9c0 1.3 1.1 2.1 2.5 2.1s2.5-.8 2.5-2.1" /><path d="M9.5 9v11.6" /><path d="M16.4 3.4c1.6 1.2 1.6 5.6 0 6.8" /><path d="M16.4 3.4v17.2" /></Svg>
      );
    case "交通":
      return (
        <Svg size={21} w={1.8}><path d="M3.5 13.5 5.3 8.6c.3-.8 1-1.3 1.9-1.3h9.6c.9 0 1.6.5 1.9 1.3l1.8 4.9" /><path d="M3.5 13.5h17V17a1 1 0 0 1-1 1H18a1 1 0 0 1-1-1v-.7H7V17a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1z" /><circle cx="7" cy="15.4" r="1.1" /><circle cx="17" cy="15.4" r="1.1" /></Svg>
      );
    case "住宿":
      return <Svg size={21}><path d="M3.5 11 12 4l8.5 7" /><path d="M5.8 9.6V20h12.4V9.6" /><path d="M10 20v-5.2h4V20" /></Svg>;
    case "购物":
      return <Svg size={21}><path d="M6 8h12l-1 12H7z" /><path d="M9 8a3 3 0 0 1 6 0" /></Svg>;
    case "娱乐":
      return <Svg size={21}><path d="M4 8h16v8H4z" /><path d="M4 11a1.5 1.5 0 0 0 0 2M20 11a1.5 1.5 0 0 1 0 2" /><path d="M10 8v8M14 8v8" strokeDasharray="1 2" /></Svg>;
    default:
      return <Svg size={20}><path d="M6 3h9l3 3v15l-2-1.3L14 21l-2-1.3L10 21l-2-1.3L6 21z" /><path d="M9 8h6M9 12h6M9 16h4" /></Svg>;
  }
}

/* ---------- avatars ---------- */
const AV = ["#ff9500", "#5b5fae", "#34a0c0", "#ac5fae", "#e0457b", "#248a3d"];
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
export function Avatar({
  name,
  seed,
  me = false,
  size = 30,
}: {
  name: string;
  seed?: string;
  me?: boolean;
  size?: number;
}) {
  const bg = me ? "var(--blue)" : AV[hash(seed || name || "?") % AV.length];
  const ch = (name || "?").trim().slice(0, 1) || "?";
  return (
    <div
      className="grid flex-none place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: bg }}
    >
      {ch}
    </div>
  );
}

export function IconTile({ size = 38, radius = 11, children }: { size?: number; radius?: number; children: ReactNode }) {
  return (
    <span className="icon-tile grid flex-none place-items-center" style={{ width: size, height: size, borderRadius: radius }}>
      {children}
    </span>
  );
}

/* ---------- structural ---------- */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-[10px] bg-[var(--card)] ${className}`}>{children}</div>;
}
export function Hairline({ inset = 16 }: { inset?: number }) {
  return <div style={{ height: "0.5px", background: "var(--separator)", marginLeft: inset }} />;
}
export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="mb-[7px] px-4 text-[13px]" style={{ color: "var(--label3)" }}>{children}</div>;
}

export function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[70vh] items-center justify-center p-4">{children}</div>;
}
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: "2px solid var(--seg-bg)",
        borderTopColor: "var(--blue)",
        borderRadius: "50%",
        animation: "aaspin .9s linear infinite",
      }}
    />
  );
}

/* ---------- controls ---------- */
type Variant = "primary" | "plain" | "ghost";
export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base = "font-[inherit] transition active:opacity-70 disabled:opacity-40 disabled:pointer-events-none";
  const styles: Record<Variant, string> = {
    primary: "h-[50px] w-full rounded-[12px] text-[17px] font-semibold text-white",
    plain: "text-[17px] text-[color:var(--blue)]",
    ghost: "text-[15px] text-[color:var(--label2)]",
  };
  const inline = variant === "primary" ? { background: "var(--blue)" } : undefined;
  return <button className={`${base} ${styles[variant]} ${className}`} style={inline} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full bg-transparent text-[17px] outline-none placeholder:text-[color:var(--placeholder)] ${className}`}
      style={{ color: "var(--ink)" }}
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
    <div className={`flex rounded-[8px] p-0.5 ${className}`} style={{ background: "var(--seg-bg)" }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="flex-1 rounded-[6px] py-1.5 text-[13px] font-semibold transition"
            style={
              on
                ? { background: "#fff", color: "var(--ink)", boxShadow: "0 1px 3px rgba(0,0,0,.12),0 1px 1px rgba(0,0,0,.04)" }
                : { color: "var(--label3)", fontWeight: 500 }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- navigation chrome ---------- */
export function LargeTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between px-1 pt-2">
      <h1 className="text-[32px] font-bold tracking-[-0.022em] text-[color:var(--ink)]">{title}</h1>
      {right}
    </div>
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
    <div className="flex items-center justify-between px-2 pb-2 pt-1">
      {onBack ? (
        <button onClick={onBack} className="flex items-center gap-0.5 text-[17px] text-[color:var(--blue)]">
          <ChevronL />
          {backLabel}
        </button>
      ) : (
        <span className="w-14" />
      )}
      <div className="text-[17px] font-semibold tracking-[-0.012em]">{title}</div>
      {right ?? <span className="w-14" />}
    </div>
  );
}

/** Dark gradient balance hero shell with animated sheen. */
export function Hero({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`hero-dark relative overflow-hidden rounded-[22px] ${className}`}>
      <div
        className="pointer-events-none absolute"
        style={{
          top: "-46%",
          right: "-14%",
          width: "74%",
          height: "130%",
          background: "radial-gradient(closest-side,rgba(255,255,255,.12),rgba(255,255,255,0))",
          animation: "aasheen 7s ease-in-out infinite",
        }}
      />
      <div className="relative p-[18px]">{children}</div>
    </div>
  );
}
