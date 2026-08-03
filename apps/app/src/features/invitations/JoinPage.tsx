import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, IconTile, Spinner, Svg } from "../../components/ui";
import { acceptInvitation } from "../../lib/api";
import { inviteLink, isInviteToken } from "../../lib/inviteLink";
import { isNativeShell } from "../../lib/web";

export function JoinPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const validToken = isInviteToken(token) ? token : null;
  const navigate = useNavigate();
  const attempted = useRef<string | null>(null);

  const join = useMutation({
    mutationFn: (value: string) => acceptInvitation(value),
    onSuccess: (circleId) => navigate(`/circles/${circleId}`, { replace: true }),
  });

  useEffect(() => {
    if (!validToken || attempted.current === validToken) return;
    attempted.current = validToken;
    join.mutate(validToken);
  }, [join, validToken]);

  const invalid = validToken === null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 pb-20 text-center">
      <IconTile size={78} radius={20}>
        <Svg size={40}>
          <circle cx="9" cy="8.4" r="2.9" />
          <path d="M3.4 18.8c0-3.1 2.5-5 5.6-5s5.6 1.9 5.6 5" />
          <path d="M15.8 5.8a2.9 2.9 0 0 1 0 5.5" />
          <path d="M16.8 13.9c2.4.3 4 2 4 4.9" />
        </Svg>
      </IconTile>

      <div className="mt-5 text-[21px] font-semibold tracking-[-0.02em]">加入圈子</div>

      {invalid ? (
        <>
          <div className="mt-1.5 text-[14px]" style={{ color: "var(--label2)" }}>邀请链接无效或已损坏</div>
          <Link to="/" className="mt-6"><Button className="w-auto px-6">回到圈子</Button></Link>
        </>
      ) : join.error ? (
        <>
          <div className="mt-1.5 text-[14px]" style={{ color: "var(--red)" }}>{(join.error as Error).message}</div>
          <Link to="/" className="mt-6"><Button className="w-auto px-6">回到圈子</Button></Link>
        </>
      ) : join.isPending ? (
        <div className="mt-5 flex items-center gap-2 text-[14px]" style={{ color: "var(--label2)" }}>
          <Spinner size={18} />
          正在验证邀请链接…
        </div>
      ) : null}

      <div className="absolute bottom-9 left-0 right-0 px-9 text-center text-[12px] leading-relaxed" style={{ color: "var(--placeholder)" }}>
        {isNativeShell() ? (
          "邀请链接仅能在已安装 AA App 的设备上打开"
        ) : validToken ? (
          <>
            已安装 AA App？
            <a href={inviteLink(validToken)} style={{ color: "var(--blue)" }}>
              在 App 中打开
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}
