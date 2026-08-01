import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, Card, Hairline, Input, Spinner } from "../../components/ui";
import { authErrorMessage } from "../../lib/authNavigation";
import { supabase } from "../../lib/supabase";

type Method = "password" | "otp";
type OtpStep = "request" | "verify";

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const RESEND_SECONDS = 60;

function Logo() {
  return (
    <div className="icon-tile relative mx-auto mb-[18px] grid place-items-center" style={{ width: 78, height: 78, borderRadius: 20 }}>
      <span className="text-[29px] font-semibold text-white">AA</span>
    </div>
  );
}

export function LoginPage() {
  const location = useLocation();
  const [method, setMethod] = useState<Method>("password");
  const [otpStep, setOtpStep] = useState<OtpStep>("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnTo = `${location.pathname}${location.search}`;
  const normalizedEmail = email.trim().toLowerCase();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function requireEmail() {
    if (!EMAIL_RE.test(normalizedEmail)) throw new Error("请输入有效的邮箱地址");
  }

  const signIn = () =>
    run(async () => {
      requireEmail();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (signInError) throw signInError;
    });

  const sendCode = () =>
    run(async () => {
      requireEmail();
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: false },
      });
      if (sendError) throw sendError;
      setOtpStep("verify");
      setCooldown(RESEND_SECONDS);
    });

  const verify = () =>
    run(async () => {
      const token = code.replace(/\D/g, "");
      if (token.length !== 6) throw new Error("请输入 6 位验证码");
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token,
        type: "email",
      });
      if (verifyError) throw verifyError;
    });

  const devLogin = (value: string) =>
    run(async () => {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: value, password: "Password123!" });
      if (signInError) throw signInError;
    });

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 pb-12">
      <div className="mb-8 text-center">
        <Logo />
        <div className="text-[28px] font-semibold tracking-[-0.024em]">AA 记账</div>
        <div className="mt-1.5 text-[15px]" style={{ color: "var(--label2)" }}>和朋友轻松 AA、记一笔、看谁欠谁</div>
      </div>

      {method === "password" && (
        <>
          <Card>
            <div className="flex h-12 items-center px-4">
              <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" inputMode="email" autoCapitalize="none" />
            </div>
            <Hairline />
            <div className="flex h-12 items-center px-4">
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" />
            </div>
          </Card>
          <div className="px-1 pt-2.5 text-right">
            <button onClick={() => { setMethod("otp"); setError(null); }} className="text-[13.5px]" style={{ color: "var(--blue)" }}>用邮箱验证码登录</button>
          </div>
          <Button className="mt-4" disabled={busy || !email || !password} onClick={signIn}>
            {busy ? "登录中…" : "登录"}
          </Button>
        </>
      )}

      {method === "otp" && otpStep === "request" && (
        <>
          <Card>
            <div className="flex h-12 items-center px-4">
              <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" inputMode="email" autoCapitalize="none" />
            </div>
          </Card>
          <div className="px-1 pt-2.5 text-right">
            <button onClick={() => { setMethod("password"); setError(null); }} className="text-[13.5px]" style={{ color: "var(--blue)" }}>用密码登录</button>
          </div>
          <Button className="mt-4" disabled={busy || !email} onClick={sendCode}>{busy ? "发送中…" : "发送 6 位验证码"}</Button>
        </>
      )}

      {method === "otp" && otpStep === "verify" && (
        <>
          <p className="mb-2 px-1 text-[13px]" style={{ color: "var(--label2)" }}>验证码已发送至 {normalizedEmail}</p>
          <Card>
            <div className="flex h-12 items-center px-4">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6 位验证码"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
          </Card>
          <Button className="mt-4" disabled={busy || code.length !== 6} onClick={verify}>{busy ? "验证中…" : "登录"}</Button>
          <div className="mt-3 flex justify-center gap-5 text-[14px]">
            <button disabled={busy || cooldown > 0} onClick={sendCode} style={{ color: cooldown > 0 ? "var(--placeholder)" : "var(--blue)" }}>
              {cooldown > 0 ? `${cooldown} 秒后可重发` : "重新发送"}
            </button>
            <button onClick={() => { setOtpStep("request"); setCode(""); setError(null); }} style={{ color: "var(--label2)" }}>更换邮箱</button>
          </div>
        </>
      )}

      <div className="mt-[18px] text-center text-[14px]" style={{ color: "var(--label2)" }}>
        还没有账号？<Link to="/register" state={{ returnTo }} style={{ color: "var(--blue)" }}>去注册</Link>
      </div>

      {error && <p className="mt-3 text-center text-[13px]" style={{ color: "var(--red)" }}>{error}</p>}
      {busy && (
        <div className="mt-3 flex justify-center">
          <Spinner />
        </div>
      )}

      {import.meta.env.DEV && (
        <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--separator)" }}>
          <p className="mb-2 text-center text-[11px]" style={{ color: "var(--label2)" }}>开发快捷登录（仅本地 dev）</p>
          <div className="flex gap-2">
            <Card className="flex-1">
              <button className="h-11 w-full text-[15px] font-medium" style={{ color: "var(--blue)" }} disabled={busy} onClick={() => devLogin("demo@aa.local")}>以「阿明」登录</button>
            </Card>
            <Card className="flex-1">
              <button className="h-11 w-full text-[15px] font-medium" style={{ color: "var(--blue)" }} disabled={busy} onClick={() => devLogin("xiaohong@aa.local")}>以「小红」登录</button>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
