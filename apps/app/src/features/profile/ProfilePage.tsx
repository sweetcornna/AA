import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Card, Centered, GroupLabel, Hairline, Input, NavBar, Spinner } from "../../components/ui";
import { getMyProfile, updateMyProfile } from "../../lib/api";
import { signOut, useAuth } from "../auth/AuthProvider";

export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["my-profile"], queryFn: getMyProfile });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (profile.data) {
      setName(profile.data.display_name ?? "");
      setPhone(profile.data.phone ?? "");
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => updateMyProfile({ display_name: name.trim(), phone: phone.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-profile"] }),
  });

  if (profile.isLoading) return <Centered><Spinner /></Centered>;
  const email = profile.data?.email ?? user?.email ?? "—";
  const dirty = name.trim() !== (profile.data?.display_name ?? "") || phone.trim() !== (profile.data?.phone ?? "");

  return (
    <div className="mx-auto max-w-md">
      <NavBar
        title="个人资料"
        onBack={() => navigate("/")}
        backLabel="圈子"
        right={
          dirty ? (
            <button className="text-[17px] font-semibold" style={{ color: "var(--blue)" }} disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "…" : "保存"}
            </button>
          ) : (
            <span className="w-14 text-right text-[15px]" style={{ color: save.isSuccess ? "var(--green)" : "transparent" }}>已保存</span>
          )
        }
      />

      <div className="px-4 pb-6 pt-2">
        <Card className="mb-[22px]">
          <div className="flex items-center gap-3.5 p-4">
            <Avatar name={name || "我"} seed={user?.id} me size={60} />
            <div className="min-w-0 flex-1">
              <div className="text-[20px] font-semibold tracking-[-0.02em]">{name || "未命名"}</div>
              <div className="mt-0.5 text-[13.5px]" style={{ color: "var(--label2)" }}>{email}</div>
            </div>
          </div>
        </Card>

        <GroupLabel>账号</GroupLabel>
        <Card className="mb-[22px]">
          <div className="flex h-[46px] items-center justify-between gap-3 px-4">
            <span className="flex-none whitespace-nowrap text-[16px]">昵称</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="昵称" className="text-right text-[16px]" />
          </div>
          <Hairline />
          <div className="flex h-[46px] items-center justify-between gap-3 px-4">
            <span className="flex-none whitespace-nowrap text-[16px]">邮箱</span>
            <span className="truncate text-right text-[16px]" style={{ color: "var(--placeholder)" }}>{email}</span>
          </div>
          <Hairline />
          <div className="flex h-[46px] items-center justify-between gap-3 px-4">
            <span className="flex-none whitespace-nowrap text-[16px]">手机号</span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="未绑定" inputMode="tel" className="text-right text-[16px]" />
          </div>
        </Card>

        {save.error && <p className="mb-3 px-1 text-[13px]" style={{ color: "var(--red)" }}>{(save.error as Error).message}</p>}

        <Card>
          <button className="h-[50px] w-full text-[17px]" style={{ color: "var(--red)" }} onClick={() => void signOut()}>退出登录</button>
        </Card>
      </div>
    </div>
  );
}
