import { useMutation } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Card } from "../../components/ui";
import { createInvitation } from "../../lib/api";

function inviteBase(): string {
  return import.meta.env.VITE_APP_BASE_URL || window.location.origin;
}

export function InviteSection({ circleId }: { circleId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const gen = useMutation({
    mutationFn: () => createInvitation({ circleId }),
    onSuccess: (inv) => setLink(`${inviteBase()}/#/join?token=${inv.token}`),
  });

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-medium">邀请成员</span>
        <button className="text-[15px]" style={{ color: "var(--blue)" }} disabled={gen.isPending} onClick={() => gen.mutate()}>
          {gen.isPending ? "生成中…" : link ? "重新生成" : "生成邀请链接"}
        </button>
      </div>
      {gen.error && <p className="mt-2 text-[13px]" style={{ color: "var(--red)" }}>{(gen.error as Error).message}</p>}
      {link && (
        <div className="mt-3 flex flex-col items-center gap-3">
          <div className="rounded-[12px] bg-white p-2.5" style={{ boxShadow: "inset 0 0 0 0.5px var(--separator)" }}>
            <QRCodeSVG value={link} size={148} fgColor="#1c1c1e" />
          </div>
          <div className="w-full break-all rounded-[10px] px-3 py-2.5 text-center text-[11px]" style={{ background: "var(--bg)", color: "var(--label2)" }}>{link}</div>
          <button className="h-[44px] w-full rounded-[12px] text-[16px] font-semibold text-white" style={{ background: "var(--blue)" }} onClick={copy}>
            {copied ? "已复制 ✓" : "复制链接"}
          </button>
        </div>
      )}
    </Card>
  );
}
