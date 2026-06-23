import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Centered, Hairline, Input, Segmented, Spinner } from "../../components/ui";
import { supabase } from "../../lib/supabase";

type Channel = "email" | "phone";
type Method = "password" | "otp";
type OtpStep = "request" | "verify";

function Logo() {
  return (
    <div className="icon-tile relative mx-auto mb-[18px] grid place-items-center" style={{ width: 78, height: 78, borderRadius: 20 }}>
      <span className="text-[29px] font-semibold text-white">AA</span>
    </div>
  );
}

export function LoginPage() {
  const [channel, setChannel] = useState<Channel>("email");
  const [method, setMethod] = useState<Method>("password");
  const [otpStep, setOtpStep] = useState<OtpStep>("request");
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = () => contact.trim();
  const ph = channel === "email" ? "you@example.com" : "+8613800138000";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  const signIn = () =>
    run(async () => {
      const creds = channel === "email" ? { email: trimmed(), password } : { phone: trimmed(), password };
      const { error: e } = await supabase.auth.signInWithPassword(creds);
      if (e) throw e;
    });
  const sendCode = () =>
    run(async () => {
      const t = channel === "email" ? { email: trimmed() } : { phone: trimmed() };
      const { error: e } = await supabase.auth.signInWithOtp(t);
      if (e) throw e;
      setOtpStep("verify");
    });
  const verify = () =>
    run(async () => {
      const res =
        channel === "email"
          ? await supabase.auth.verifyOtp({ email: trimmed(), token: code.trim(), type: "email" })
          : await supabase.auth.verifyOtp({ phone: trimmed(), token: code.trim(), type: "sms" });
      if (res.error) throw res.error;
    });
  const devLogin = (email: string) =>
    run(async () => {
      const { error: e } = await supabase.auth.signInWithPassword({ email, password: "Password123!" });
      if (e) throw e;
    });

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 pb-12">
      <div className="mb-8 text-center">
        <Logo />
        <div className="text-[28px] font-semibold tracking-[-0.024em]">AA 记账</div>
        <div className="mt-1.5 text-[15px]" style={{ color: "var(--label2)" }}>和朋友轻松 AA、记一笔、看谁欠谁</div>
      </div>

      <Segmented
        className="mb-4"
        value={channel}
        onChange={setChannel}
        options={[{ value: "email", label: "邮箱" }, { value: "phone", label: "手机号" }]}
      />

      {method === "password" && (
        <>
          <Card>
            <div className="flex h-12 items-center px-4">
              <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder={ph} inputMode={channel === "email" ? "email" : "tel"} />
            </div>
            <Hairline />
            <div className="flex h-12 items-center px-4">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
            </div>
          </Card>
          <div className="px-1 pt-2.5 text-right">
            <button onClick={() => setMethod("otp")} className="text-[13.5px]" style={{ color: "var(--blue)" }}>用验证码登录</button>
          </div>
          <Button className="mt-4" disabled={busy || !contact || !password} onClick={signIn}>
            {busy ? "登录中…" : "登录"}
          </Button>
        </>
      )}

      {method === "otp" && otpStep === "request" && (
        <>
          <Card>
            <div className="flex h-12 items-center px-4">
              <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder={ph} inputMode={channel === "email" ? "email" : "tel"} />
            </div>
          </Card>
          <div className="px-1 pt-2.5 text-right">
            <button onClick={() => setMethod("password")} className="text-[13.5px]" style={{ color: "var(--blue)" }}>用密码登录</button>
          </div>
          <Button className="mt-4" disabled={busy || !contact} onClick={sendCode}>{busy ? "发送中…" : "发送验证码"}</Button>
        </>
      )}

      {method === "otp" && otpStep === "verify" && (
        <>
          <Card>
            <div className="flex h-12 items-center px-4">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" autoFocus />
            </div>
          </Card>
          <Button className="mt-4" disabled={busy || !code} onClick={verify}>{busy ? "验证中…" : "登录"}</Button>
          <button onClick={() => setOtpStep("request")} className="mt-3 text-center text-[14px]" style={{ color: "var(--label2)" }}>← 换一个</button>
        </>
      )}

      <div className="mt-[18px] text-center text-[14px]" style={{ color: "var(--label2)" }}>
        还没有账号？<Link to="/register" style={{ color: "var(--blue)" }}>去注册</Link>
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
