import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  Button,
  Card,
  Centered,
  Dialog,
  ErrorState,
  GroupLabel,
  Hairline,
  Icon,
  Input,
  NavBar,
  Spinner,
} from "../../components/ui";
import { getMyProfile, updateMyProfile } from "../../lib/api";
import { signOut, useAuth } from "../auth/AuthProvider";
export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["my-profile"], queryFn: getMyProfile });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (profile.data) {
      setName(profile.data.display_name ?? "");
      setPhone(profile.data.phone ?? "");
    }
  }, [profile.data]);
  const save = useMutation({
    mutationFn: () =>
      updateMyProfile({
        display_name: name.trim(),
        phone: phone.trim() || null,
      }),
    onSuccess: async () => {
      await Promise.all(
        ["my-profile", "activity", "members", "participants"].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  const logout = useMutation({ mutationFn: signOut });
  if (profile.isLoading)
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  if (profile.isError || !profile.data)
    return (
      <div className="page">
        <ErrorState
          message="个人资料加载失败。"
          onRetry={() => void profile.refetch()}
        />
        <Button
          className="mt-4"
          variant="ghost"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          退出登录
        </Button>
        {logout.error && (
          <p role="alert" className="mt-3 text-[var(--red)]">
            退出登录失败，请重试。
          </p>
        )}
      </div>
    );
  const dirty =
    name.trim() !== profile.data.display_name ||
    phone.trim() !== (profile.data.phone ?? "");
  return (
    <div className="page-form !px-0">
      <NavBar title="个人资料" onBack={() => navigate("/")} backLabel="圈子" />
      <Card className="mb-8">
        <div className="flex items-center gap-4 p-6">
          <Avatar name={name || "我"} seed={user?.id} me size={64} />
          <div className="min-w-0">
            <h2 className="text-[21px] font-semibold truncate">
              {name || "未命名"}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--label2)] break-all">
              {profile.data.email ?? user?.email}
            </p>
          </div>
        </div>
      </Card>
      <GroupLabel>账号信息</GroupLabel>
      <Card>
        <label className="flex min-h-14 items-center gap-4 px-4">
          <span className="text-[14px] flex-none">昵称</span>
          <Input
            aria-label="昵称"
            placeholder="你的昵称"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            className="text-right"
          />
        </label>
        <Hairline />
        <label className="flex min-h-14 items-center gap-4 px-4">
          <span className="text-[14px] flex-none">手机号</span>
          <Input
            aria-label="手机号"
            placeholder="选填"
            inputMode="tel"
            maxLength={30}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="text-right"
          />
        </label>
      </Card>
      <Button
        className="mt-5"
        disabled={!dirty || !name.trim() || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "保存中…" : "保存资料"}
      </Button>
      {save.isSuccess && !dirty && (
        <p
          className="mt-3 text-center text-[13px] text-[var(--green)]"
          role="status"
        >
          资料已保存
        </p>
      )}
      {save.error && (
        <p role="alert" className="mt-3 text-[13px] text-[var(--red)]">
          保存失败，请检查网络后重试。
        </p>
      )}
      <div className="mt-10">
        <GroupLabel>登录管理</GroupLabel>
        <Card>
          <button
            className="list-row w-full text-[var(--red)]"
            onClick={() => setConfirm(true)}
          >
            <Icon name="leave" size={20} />
            <span className="text-[14px]">退出登录</span>
          </button>
        </Card>
      </div>
      <Dialog
        title="退出登录"
        open={confirm}
        busy={logout.isPending}
        onClose={() => setConfirm(false)}
      >
        <p className="text-[14px] text-[var(--label2)]">
          退出后，你的账本仍会安全保留。下次登录即可继续查看。
        </p>
        {logout.error && (
          <p role="alert" className="text-[13px] mt-3 text-[var(--red)]">
            退出登录失败，请重试。
          </p>
        )}
        <div className="dialog-actions">
          <Button
            variant="ghost"
            disabled={logout.isPending}
            onClick={() => setConfirm(false)}
          >
            取消
          </Button>
          <Button
            variant="danger"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {logout.isPending ? "正在退出…" : "确认退出登录"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
