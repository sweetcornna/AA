import { useMutation } from "@tanstack/react-query";

import { lazy, Suspense, useState } from "react";
import { Button, Card, Spinner } from "../../components/ui";
import { createInvitation } from "../../lib/api";
import { inviteLink } from "../../lib/inviteLink";
import { WEB_ORIGIN } from "../../lib/web";

const QRCodeSVG = lazy(() =>
  import("qrcode.react").then((m) => ({ default: m.QRCodeSVG })),
);

export function InviteSection({ circleId }: { circleId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const gen = useMutation({
    mutationFn: () => createInvitation({ circleId }),
    onSuccess: (inv) => setLink(inviteLink(inv.token, WEB_ORIGIN)),
  });

  async function copy() {
    if (!link) return;
    try {
      setCopyError(false);
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-medium">邀请成员</span>
        <button
          className="text-[15px]"
          style={{ color: "var(--blue)" }}
          disabled={gen.isPending}
          onClick={() => gen.mutate()}
        >
          {gen.isPending ? "生成中…" : link ? "重新生成" : "生成邀请链接"}
        </button>
      </div>
      {gen.error && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--red)" }}>
          {(gen.error as Error).message}
        </p>
      )}
      {link && (
        <div className="mt-3 flex flex-col items-center gap-3">
          <div
            className="rounded-[12px] bg-white p-2.5"
            style={{ boxShadow: "inset 0 0 0 0.5px var(--separator)" }}
          >
            <Suspense fallback={<Spinner />}>
              <QRCodeSVG
                title="圈子邀请二维码"
                value={link}
                size={180}
                marginSize={2}
                fgColor="#202735"
              />
            </Suspense>
          </div>
          <input
            aria-label="邀请链接"
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
            className="select-field text-[12px]"
          />
          <Button onClick={copy}>{copied ? "已复制" : "复制链接"}</Button>
          {copyError && (
            <p role="alert" className="text-[12px] text-[var(--red)]">
              无法自动复制，请点选上方链接后手动复制。
            </p>
          )}
          <p
            className="text-center text-[12px] leading-relaxed"
            style={{ color: "var(--label2)" }}
          >
            {link.startsWith("aa://")
              ? "邀请链接只能在已安装 AA App 的设备上打开。"
              : "对方用手机相机扫码，或直接打开链接即可加入。"}
          </p>
        </div>
      )}
    </Card>
  );
}
