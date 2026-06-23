import { Link } from "react-router-dom";
import { Card, IconTile, Svg } from "../../components/ui";

const SAMPLES = ["这个月我在吃饭上花了多少？", "帮我和小红结一下账", "上周那顿火锅是谁付的？", "我在云南旅行欠了多少？"];

export function AssistantPage() {
  return (
    <div className="mx-auto max-w-md px-4 pt-3">
      <h1 className="mb-3 text-[32px] font-bold tracking-[-0.022em]">助手</h1>

      <Card className="mb-5 p-5">
        <div className="flex flex-col items-center text-center">
          <IconTile size={64} radius={18}>
            <Svg size={34} w={1.9}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.6A8.4 8.4 0 1 1 21 11.5z" /></Svg>
          </IconTile>
          <div className="mt-3.5 text-[19px] font-semibold tracking-[-0.02em]">AI 记账助手</div>
          <div className="mt-1.5 text-[14px] leading-relaxed" style={{ color: "var(--label2)" }}>
            用一句话或语音记账、查账、代结算。<br />对话式问答与代结算即将上线。
          </div>
        </div>
      </Card>

      <div className="mb-[7px] px-4 text-[13px]" style={{ color: "var(--label3)" }}>你可以问</div>
      <Card>
        {SAMPLES.map((s, i) => (
          <div key={s}>
            {i > 0 && <div style={{ height: "0.5px", background: "var(--separator)", marginLeft: 16 }} />}
            <div className="flex items-center gap-3 px-4 py-3">
              <Svg size={18} stroke="var(--blue)" w={2}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.6A8.4 8.4 0 1 1 21 11.5z" /></Svg>
              <span className="flex-1 text-[15px]" style={{ color: "var(--ink)" }}>{s}</span>
            </div>
          </div>
        ))}
      </Card>

      <div className="mt-5 text-center text-[13px] leading-relaxed" style={{ color: "var(--label2)" }}>
        现在就能用：进任意圈子点 <Link to="/" style={{ color: "var(--blue)" }}>记一笔</Link>，<br />在「✨ 一句话记账」里说一句话即可让 AI 记账。
      </div>
    </div>
  );
}
