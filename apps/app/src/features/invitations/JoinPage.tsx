import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, IconTile, Spinner, Svg } from "../../components/ui";
import { acceptInvitation } from "../../lib/api";

export function JoinPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();

  const join = useMutation({
    mutationFn: () => acceptInvitation(token!),
    onSuccess: (circleId) => navigate(`/circles/${circleId}`, { replace: true }),
  });

  useEffect(() => {
    if (token) join.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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

      {!token ? (
        <>
          <div className="mt-1.5 text-[14px]" style={{ color: "var(--label2)" }}>邀请链接无效（缺少 token）</div>
          <Link to="/" className="mt-6"><Button className="w-auto px-6">回到圈子</Button></Link>
        </>
      ) : join.error ? (
        <>
          <div className="mt-1.5 text-[14px]" style={{ color: "var(--red)" }}>{(join.error as Error).message}</div>
          <Link to="/" className="mt-6"><Button className="w-auto px-6">回到圈子</Button></Link>
        </>
      ) : (
        <div className="mt-5 flex items-center gap-2 text-[14px]" style={{ color: "var(--label2)" }}>
          <Spinner size={18} />
          正在验证邀请链接…
        </div>
      )}

      <div className="absolute bottom-9 left-0 right-0 px-9 text-center text-[12px] leading-relaxed" style={{ color: "var(--placeholder)" }}>
        未安装 App 时链接会在浏览器打开 Web 版完成加入，已安装则通过 deep-link 唤起原生 App
      </div>
    </div>
  );
}
