import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Card, GroupLabel, Hairline, Input, NavBar } from "../../components/ui";
import { safeReturnPath } from "../../lib/authNavigation";
import { supabase } from "../../lib/supabase";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = safeReturnPath((location.state as { returnTo?: unknown } | null)?.returnTo);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!displayName.trim()) return "请填写昵称";
    if (!EMAIL_RE.test(email.trim())) return "请输入有效的邮箱地址";
    if (password.length < 6) return "密码至少 6 位";
    if (password !== confirm) return "两次输入的密码不一致";
    return null;
  }

  async function submit() {
    const validationError = validate();
    if (validationError) return setError(validationError);
    setBusy(true);
    setError(null);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (signUpError) throw signUpError;
      if (!data.user || !data.session) {
        throw new Error("注册服务尚未配置为即时登录，请联系管理员");
      }
      navigate(returnTo, { replace: true });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "注册失败";
      setError(/rate limit|too many/i.test(message) ? "操作太频繁，请稍后再试" : message);
    } finally {
      setBusy(false);
    }
  }

  const hint = (text: string) => <span className="flex-none whitespace-nowrap text-[15px]" style={{ color: "var(--tertiary)" }}>{text}</span>;

  return (
    <div className="mx-auto min-h-screen max-w-md">
      <NavBar title="创建账号" onBack={() => navigate(-1)} backLabel="登录" />
      <div className="px-4 pb-16 pt-2">
        <GroupLabel>个人信息</GroupLabel>
        <Card>
          <div className="flex h-12 items-center gap-3 px-4">
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="昵称" autoFocus />
            {hint("必填")}
          </div>
          <Hairline />
          <div className="flex h-12 items-center gap-3 px-4">
            <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱" inputMode="email" autoCapitalize="none" />
            {hint("必填")}
          </div>
        </Card>

        <div className="h-[22px]" />
        <GroupLabel>设置密码</GroupLabel>
        <Card>
          <div className="flex h-12 items-center px-4">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" />
          </div>
          <Hairline />
          <div className="flex h-12 items-center px-4">
            <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="再次输入密码" />
          </div>
        </Card>

        <p className="mt-3 px-1 text-[12px] leading-relaxed" style={{ color: "var(--label2)" }}>
          注册后会立即登录；本版本不会额外验证邮箱所有权，请使用你可长期访问的邮箱。
        </p>
        <Button className="mt-5" disabled={busy} onClick={submit}>{busy ? "注册中…" : "注册并登录"}</Button>
        {error && <p className="mt-3 text-center text-[13px]" style={{ color: "var(--red)" }}>{error}</p>}
      </div>
    </div>
  );
}
