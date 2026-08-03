import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  GroupLabel,
  IconTile,
  Input,
  NavBar,
  Spinner,
  Svg,
} from "../../components/ui";
import { acceptInvitation } from "../../lib/api";
import {
  invitationErrorMessage,
  inviteLink,
  isInviteToken,
  parseInviteInput,
} from "../../lib/inviteLink";
import { isNativeShell } from "../../lib/web";

const GroupGlyph = () => (
  <Svg size={40}>
    <circle cx="9" cy="8.4" r="2.9" />
    <path d="M3.4 18.8c0-3.1 2.5-5 5.6-5s5.6 1.9 5.6 5" />
    <path d="M15.8 5.8a2.9 2.9 0 0 1 0 5.5" />
    <path d="M16.8 13.9c2.4.3 4 2 4 4.9" />
  </Svg>
);

export function JoinPage() {
  const [params] = useSearchParams();
  const tokenParams = params.getAll("token");
  const hasOnlyToken = [...params.keys()].every(
    (key) => key === "token",
  );
  const urlToken =
    hasOnlyToken &&
    tokenParams.length === 1 &&
    isInviteToken(tokenParams[0])
      ? tokenParams[0]
      : null;
  const urlState =
    tokenParams.length === 0 && hasOnlyToken
      ? "manual"
      : urlToken
        ? "automatic"
        : "invalid";

  const navigate = useNavigate();
  const qc = useQueryClient();
  const attempted = useRef<string | null>(null);
  const nextAttemptId = useRef(0);
  const activeAttemptId = useRef<number | null>(null);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const join = useMutation({
    mutationFn: (value: string) => acceptInvitation(value),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["circles"] }),
        qc.invalidateQueries({ queryKey: ["my-balances"] }),
        qc.invalidateQueries({ queryKey: ["activity"] }),
      ]);
    },
  });

  const joinToken = (token: string) => {
    const attemptId = ++nextAttemptId.current;
    activeAttemptId.current = attemptId;
    join.mutate(token, {
      onSuccess: async (circleId) => {
        if (activeAttemptId.current !== attemptId) return;
        setInput("");
        if (activeAttemptId.current !== attemptId) return;
        navigate(`/circles/${circleId}`, { replace: true });
      },
    });
  };

  const leaveJoinPage = () => {
    activeAttemptId.current = null;
    navigate("/", { replace: true });
  };

  useEffect(() => {
    if (urlState !== "automatic") {
      attempted.current = null;
      return;
    }
    if (!urlToken || attempted.current === urlToken) return;
    attempted.current = urlToken;
    joinToken(urlToken);
  }, [urlState, urlToken]);

  const submitInput = () => {
    const token = parseInviteInput(input);
    if (!token) {
      setInputError("请输入有效的 24 位邀请码或完整邀请链接");
      return;
    }
    setInputError(null);
    joinToken(token);
  };

  const enterAnother = () => {
    activeAttemptId.current = null;
    join.reset();
    setInput("");
    setInputError(null);
    navigate("/join", { replace: true });
  };

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pt-3">
      <NavBar
        title="加入圈子"
        backLabel="圈子"
        onBack={leaveJoinPage}
      />

      <div className="flex flex-col items-center px-2 pb-20 pt-10 text-center">
        <IconTile size={78} radius={20}>
          <GroupGlyph />
        </IconTile>
        <h1 className="mt-5 text-[21px] font-semibold tracking-[-0.02em]">
          加入朋友的圈子
        </h1>

        {urlState === "manual" ? (
          <form
            className="mt-8 w-full text-left"
            onSubmit={(event) => {
              event.preventDefault();
              if (!join.isPending) submitInput();
            }}
          >
            <GroupLabel>邀请码或邀请链接</GroupLabel>
            <Card className="px-4 py-3.5">
              <Input
                value={input}
                onChange={(event) => {
                  activeAttemptId.current = null;
                  join.reset();
                  setInput(event.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder="粘贴邀请码或 aa:// 邀请链接"
                aria-label="邀请码或邀请链接"
                aria-describedby="invite-input-help"
                aria-invalid={Boolean(inputError || join.error)}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                disabled={join.isPending}
                autoFocus
              />
            </Card>
            <p
              id="invite-input-help"
              role={inputError || join.error ? "alert" : undefined}
              className="mt-2 px-4 text-[13px] leading-relaxed"
              style={{
                color:
                  inputError || join.error
                    ? "var(--red)"
                    : "var(--label2)",
              }}
            >
              {inputError ||
                (join.error
                  ? invitationErrorMessage(join.error)
                  : "可输入 24 位邀请码，或粘贴朋友发来的完整链接")}
            </p>
            <Button
              type="submit"
              className="mt-5"
              disabled={!input.trim() || join.isPending}
            >
              {join.isPending ? "正在加入…" : join.error ? "重试" : "加入圈子"}
            </Button>
          </form>
        ) : urlState === "invalid" ? (
          <div className="mt-8 w-full">
            <p className="text-[14px]" style={{ color: "var(--red)" }}>
              邀请链接无效或已损坏
            </p>
            <Button className="mt-6" onClick={enterAnother}>
              输入邀请码
            </Button>
            <Button
              variant="ghost"
              className="mt-3 h-10 w-full"
              onClick={leaveJoinPage}
            >
              回到圈子
            </Button>
          </div>
        ) : join.error ? (
          <div className="mt-8 w-full">
            <p className="text-[14px]" style={{ color: "var(--red)" }}>
              {invitationErrorMessage(join.error)}
            </p>
            <Button
              className="mt-6"
              disabled={join.isPending}
              onClick={() => urlToken && joinToken(urlToken)}
            >
              重试
            </Button>
            <Button
              variant="ghost"
              className="mt-3 h-10 w-full"
              onClick={enterAnother}
            >
              输入其他邀请码
            </Button>
            <Button
              variant="ghost"
              className="mt-1 h-10 w-full"
              onClick={leaveJoinPage}
            >
              回到圈子
            </Button>
          </div>
        ) : (
          <div
            role="status"
            aria-live="polite"
            className="mt-8 flex items-center gap-2 text-[14px]"
            style={{ color: "var(--label2)" }}
          >
            <Spinner size={18} />
            正在验证邀请链接…
          </div>
        )}

        {!isNativeShell() && urlToken && (
          <p className="mt-8 text-[13px]" style={{ color: "var(--label2)" }}>
            已安装 AA App？
            <a href={inviteLink(urlToken)} style={{ color: "var(--blue)" }}>
              在 App 中打开
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
