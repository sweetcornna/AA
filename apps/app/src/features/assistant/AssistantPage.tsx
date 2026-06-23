import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, IconTile, Spinner, Svg } from "../../components/ui";
import { askAgent } from "../../lib/api";

const SAMPLES = ["这个月我花了多少？", "帮我和大家结一下账", "最近那顿火锅是谁付的？", "我现在欠谁钱？"];

interface Msg {
  role: "user" | "assistant";
  text: string;
}

const ChatBubble = ({ kind }: { kind: "user" | "assistant" }) => (
  <Svg size={16} stroke={kind === "user" ? "#fff" : "var(--blue)"} w={2}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.6A8.4 8.4 0 1 1 21 11.5z" />
  </Svg>
);

export function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (q: string) => askAgent(q),
    onSuccess: (answer) => setMsgs((m) => [...m, { role: "assistant", text: answer }]),
    onError: (e: Error) => setMsgs((m) => [...m, { role: "assistant", text: `出错了：${e.message}` }]),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, ask.isPending]);

  function send(q: string) {
    const text = q.trim();
    if (!text || ask.isPending) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    ask.mutate(text);
  }

  const empty = msgs.length === 0;

  return (
    <div className="mx-auto flex h-[calc(100dvh-104px)] max-w-md flex-col px-4 pt-3">
      <h1 className="mb-3 text-[32px] font-bold tracking-[-0.022em]">助手</h1>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
        {empty && (
          <>
            <Card className="mb-4 p-5">
              <div className="flex flex-col items-center text-center">
                <IconTile size={60} radius={17}>
                  <Svg size={32} w={1.9}>
                    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.6A8.4 8.4 0 1 1 21 11.5z" />
                  </Svg>
                </IconTile>
                <div className="mt-3 text-[18px] font-semibold tracking-[-0.02em]">AI 记账助手</div>
                <div className="mt-1.5 text-[14px] leading-relaxed" style={{ color: "var(--label2)" }}>
                  问问你的账本：花销、结余、谁付的、怎么结算。
                </div>
              </div>
            </Card>
            <div className="mb-[7px] px-4 text-[13px]" style={{ color: "var(--label3)" }}>试试这样问</div>
            <Card>
              {SAMPLES.map((s, i) => (
                <div key={s}>
                  {i > 0 && <div style={{ height: "0.5px", background: "var(--separator)", marginLeft: 16 }} />}
                  <button onClick={() => send(s)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/5">
                    <ChatBubble kind="assistant" />
                    <span className="flex-1 text-[15px]" style={{ color: "var(--ink)" }}>{s}</span>
                  </button>
                </div>
              ))}
            </Card>
            <div className="mt-4 text-center text-[13px] leading-relaxed" style={{ color: "var(--label2)" }}>
              想记账？进任意圈子点 <Link to="/" style={{ color: "var(--blue)" }}>记一笔</Link>,
              <br />在「✨ 一句话记账」里说一句话即可。
            </div>
          </>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[80%] whitespace-pre-wrap rounded-[18px] px-3.5 py-2.5 text-[15px] leading-relaxed"
              style={
                m.role === "user"
                  ? { background: "var(--blue)", color: "#fff", borderBottomRightRadius: 6 }
                  : { background: "var(--card)", color: "var(--ink)", borderBottomLeftRadius: 6, boxShadow: "0 1px 2px rgba(0,0,0,.06)" }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {ask.isPending && (
          <div className="flex justify-start">
            <div className="rounded-[18px] px-4 py-3" style={{ background: "var(--card)", borderBottomLeftRadius: 6 }}>
              <Spinner size={16} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-center gap-2 py-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="问问你的账本…"
          className="h-[42px] flex-1 rounded-full border-none px-4 text-[15px] outline-none"
          style={{ background: "var(--card)", color: "var(--ink)", boxShadow: "inset 0 0 0 0.5px var(--separator)" }}
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || ask.isPending}
          aria-label="发送"
          className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full disabled:opacity-40"
          style={{ background: "var(--blue)" }}
        >
          <Svg size={20} stroke="#fff" w={2.2}><path d="M7 11l5-5 5 5M12 6v13" /></Svg>
        </button>
      </div>
    </div>
  );
}
