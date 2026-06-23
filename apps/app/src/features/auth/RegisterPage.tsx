import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, GroupLabel, Hairline, Input, NavBar } from "../../components/ui";
import { supabase } from "../../lib/supabase";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function RegisterPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function validate(): string | null {
    if (!displayName.trim()) return "请填写昵称";
    if (!EMAIL_RE.test(email.trim())) return "请输入有效的邮箱地址";
    if (phone.trim() && !/^\+?\d{6,15}$/.test(phone.trim())) return "手机号格式不正确";
    if (password.length < 6) return "密码至少 6 位";
    if (password !== confirm) return "两次输入的密码不一致";
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) return setError(v);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: e } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (e) throw e;
      if (data.session && phone.trim()) {
        await supabase.from("profiles").update({ phone: phone.trim() }).eq("id", data.user!.id);
      }
      if (data.session) navigate("/", { replace: true });
      else setNotice("注册成功，请查收验证邮件后登录。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }

  const hint = (t: string) => <span className="flex-none whitespace-nowrap text-[15px]" style={{ color: "var(--tertiary)" }}>{t}</span>;

  return (
    <div className="mx-auto min-h-screen max-w-md">
      <NavBar title="创建账号" onBack={() => navigate("/")} backLabel="登录" />
      <div className="px-4 pb-16 pt-2">
        <GroupLabel>个人信息</GroupLabel>
        <Card>
          <div className="flex h-12 items-center gap-3 px-4">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="昵称" autoFocus />
            {hint("昵称")}
          </div>
          <Hairline />
          <div className="flex h-12 items-center gap-3 px-4">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" inputMode="email" />
            {hint("必填")}
          </div>
          <Hairline />
          <div className="flex h-12 items-center gap-3 px-4">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" inputMode="tel" />
            {hint("选填")}
          </div>
        </Card>

        <div className="h-[22px]" />
        <GroupLabel>设置密码</GroupLabel>
        <Card>
          <div className="flex h-12 items-center px-4">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" />
          </div>
          <Hairline />
          <div className="flex h-12 items-center px-4">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入密码" />
          </div>
        </Card>

        <Button className="mt-6" disabled={busy} onClick={submit}>{busy ? "注册中…" : "注册并登录"}</Button>
        {notice && <p className="mt-3 text-center text-[13px]" style={{ color: "var(--green)" }}>{notice}</p>}
        {error && <p className="mt-3 text-center text-[13px]" style={{ color: "var(--red)" }}>{error}</p>}
      </div>
    </div>
  );
}
