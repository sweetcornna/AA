import {
  computeSplit,
  expenseDraftSchema,
  formatMoney,
  fractionDigitsFor,
  toMinor,
} from "@aa/shared";
import type { Allocation, ExpenseDraft, ParsedExpense, SplitType } from "@aa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Card,
  Centered,
  ChevronR,
  GroupLabel,
  Hairline,
  Input,
  Segmented,
  Spinner,
  Svg,
} from "../../components/ui";
import { createExpense, getCircle, listMembers, parseExpense } from "../../lib/api";
import {
  startCloudRecording,
  startWebSpeech,
  webSpeechAvailable,
} from "../../lib/speech";
import type { Recording } from "../../lib/speech";
import { useAuth } from "../auth/AuthProvider";

const today = () => new Date().toISOString().slice(0, 10);
const CATEGORIES = ["餐饮", "交通", "住宿", "购物", "娱乐", "其他"];

function parseMajor(input: string, digits: number): number {
  const v = Number(input);
  if (!Number.isFinite(v) || v < 0) return Number.NaN;
  return toMinor(v, digits);
}

const CheckOn = () => (
  <Svg size={22} fill="var(--blue)" stroke="none"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z" /></Svg>
);
const CheckOff = () => <Svg size={22} stroke="var(--tertiary)" w={1.6}><circle cx="12" cy="12" r="10" /></Svg>;

export function AddExpensePage() {
  const { circleId } = useParams<{ circleId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const circle = useQuery({ queryKey: ["circle", circleId], queryFn: () => getCircle(circleId!), enabled: !!circleId });
  const members = useQuery({ queryKey: ["members", circleId], queryFn: () => listMembers(circleId!), enabled: !!circleId });

  const currency = circle.data?.default_currency ?? "CNY";
  const digits = fractionDigitsFor(currency);

  const [payerId, setPayerId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [spentAt, setSpentAt] = useState(today());
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [exactStr, setExactStr] = useState<Record<string, string>>({});
  const [weightStr, setWeightStr] = useState<Record<string, string>>({});

  const [nlText, setNlText] = useState("");
  const [source, setSource] = useState<"manual" | "voice" | "agent">("manual");
  const [rawText, setRawText] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  // AI provenance for the audit columns (ai_provider / asr_provider / …).
  // asrProvider is set when nlText came from voice; cleared when the user types.
  const [asrProvider, setAsrProvider] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<{ provider: string | null; confidence: number; raw: unknown } | null>(null);
  // Voice capture state machine: idle → requesting → listening/recording →
  // transcribing → idle. The ref is the synchronous lock for rapid taps.
  const [voice, setVoice] = useState<"idle" | "requesting" | "listening" | "recording" | "transcribing">("idle");
  const voiceRef = useRef<typeof voice>("idle");
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [showVoicePrivacy, setShowVoicePrivacy] = useState(false);
  const pendingVoiceStartRef = useRef(false);
  const webStopRef = useRef<(() => void) | null>(null);
  const recRef = useRef<Recording | null>(null);
  const voiceRunRef = useRef(0);

  function transitionVoice(next: typeof voice) {
    voiceRef.current = next;
    setVoice(next);
  }

  useEffect(() => {
    if (!members.data) return;
    if (!payerId && user) {
      const me = members.data.find((m) => m.user_id === user.id);
      setPayerId(me?.user_id ?? members.data[0]?.user_id ?? "");
    }
    if (participants.size === 0) setParticipants(new Set(members.data.map((m) => m.user_id)));
  }, [members.data, user, payerId, participants.size]);

  const totalMinor = parseMajor(amountStr, digits);
  const participantIds = useMemo(
    () => (members.data ?? []).map((m) => m.user_id).filter((id) => participants.has(id)),
    [members.data, participants],
  );

  function toggle(id: string) {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const draft: ExpenseDraft | null = useMemo(() => {
    if (!circleId || !payerId || !Number.isFinite(totalMinor) || totalMinor <= 0) return null;
    if (participantIds.length === 0) return null;
    const base = { circleId, payerId, amountMinor: totalMinor, currency, description, category: category || null, spentAt, participantIds };
    if (splitType === "exact")
      return { ...base, splitType, exact: participantIds.map((id) => ({ userId: id, amountMinor: parseMajor(exactStr[id] ?? "", digits) || 0 })) };
    if (splitType === "shares")
      return { ...base, splitType, weights: participantIds.map((id) => ({ userId: id, weight: Number(weightStr[id] ?? "1") || 0 })) };
    return { ...base, splitType: "equal" };
  }, [circleId, payerId, totalMinor, currency, description, category, spentAt, participantIds, splitType, exactStr, weightStr, digits]);

  let allocation: Allocation | null = null;
  let previewError: string | null = null;
  if (draft) {
    try {
      allocation = computeSplit({ total: draft.amountMinor, splitType: draft.splitType, participantIds: draft.participantIds, exact: draft.exact, weights: draft.weights });
    } catch (e) {
      previewError = e instanceof Error ? e.message : "分账计算错误";
    }
  }

  function applyParsed(p: ParsedExpense & { _provider?: string }) {
    // Voice-captured sentence → 'voice'; typed sentence + AI parse → 'agent'.
    setSource(asrProvider ? "voice" : "agent");
    setAiMeta({ provider: p._provider ?? null, confidence: p.confidence, raw: p });
    setRawText(nlText.trim());
    setUnresolved(p.unresolved ?? []);
    setAmountStr(String(p.amount));
    if (p.payerMemberId) setPayerId(p.payerMemberId);
    setSpentAt(p.spentAt);
    setSplitType(p.splitType);
    setCategory(p.category ?? "");
    if (p.description) setDescription(p.description);
    const ids = p.participants.map((x) => x.matchedMemberId).filter((id): id is string => !!id);
    if (ids.length) setParticipants(new Set(ids));
    if (p.splitType === "exact") {
      const ex: Record<string, string> = {};
      for (const part of p.participants) if (part.matchedMemberId && part.amount != null) ex[part.matchedMemberId] = String(part.amount);
      setExactStr(ex);
    }
  }

  const parse = useMutation({ mutationFn: () => parseExpense(circleId!, nlText.trim()), onSuccess: applyParsed });

  async function finishCloudRecording(rec: Recording, run: number) {
    if (voiceRef.current !== "recording" || recRef.current !== rec) return;
    transitionVoice("transcribing");
    try {
      const { text, provider } = await rec.stopAndTranscribe();
      if (voiceRunRef.current !== run) return;
      setNlText(text);
      setAsrProvider(provider);
    } catch (error) {
      if (voiceRunRef.current === run) {
        setVoiceErr(error instanceof Error ? error.message : "语音转写失败，请直接输入。");
      }
    } finally {
      if (voiceRunRef.current === run) {
        if (recRef.current === rec) recRef.current = null;
        transitionVoice("idle");
      }
    }
  }

  async function startVoiceCapture() {
    const run = ++voiceRunRef.current;
    setVoiceErr(null);
    pendingVoiceStartRef.current = false;

    if (webSpeechAvailable()) {
      transitionVoice("listening");
      setAsrProvider("web-speech");
      webStopRef.current = startWebSpeech({
        onText: (text) => {
          if (voiceRunRef.current === run) setNlText(text);
        },
        onEnd: () => {
          if (voiceRunRef.current !== run) return;
          webStopRef.current = null;
          transitionVoice("idle");
        },
        onError: (message) => {
          if (voiceRunRef.current === run) setVoiceErr(message);
        },
      });
      return;
    }

    transitionVoice("requesting");
    try {
      const rec = await startCloudRecording();
      if (voiceRunRef.current !== run || voiceRef.current !== "requesting") {
        rec.cancel();
        return;
      }
      recRef.current = rec;
      setVoiceSeconds(0);
      transitionVoice("recording");
      void rec.stopped.then(() => {
        if (voiceRunRef.current === run && recRef.current === rec) void finishCloudRecording(rec, run);
      });
    } catch (error) {
      if (voiceRunRef.current !== run) return;
      setVoiceErr(error instanceof Error ? error.message : "无法访问麦克风，请直接输入文字。");
      transitionVoice("idle");
    }
  }

  function toggleVoice() {
    if (voiceRef.current === "requesting" || voiceRef.current === "transcribing") return;
    if (voiceRef.current === "listening") {
      webStopRef.current?.();
      return;
    }
    if (voiceRef.current === "recording") {
      const rec = recRef.current;
      if (rec) void finishCloudRecording(rec, voiceRunRef.current);
      return;
    }
    if (!webSpeechAvailable() && localStorage.getItem("aa.voice-cloud-consent") !== "1") {
      pendingVoiceStartRef.current = true;
      setShowVoicePrivacy(true);
      return;
    }
    void startVoiceCapture();
  }

  useEffect(() => {
    if (voice !== "recording") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setVoiceSeconds(Math.min(60, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [voice]);

  // Backgrounding or leaving invalidates callbacks and releases the microphone.
  useEffect(() => {
    const cancelVoice = () => {
      voiceRunRef.current += 1;
      webStopRef.current?.();
      webStopRef.current = null;
      recRef.current?.cancel();
      recRef.current = null;
      transitionVoice("idle");
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelVoice();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", cancelVoice);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", cancelVoice);
      voiceRunRef.current += 1;
      webStopRef.current?.();
      recRef.current?.cancel();
    };
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = expenseDraftSchema.safeParse(draft);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "表单校验失败");
      return createExpense(parsed.data, {
        source,
        rawText,
        aiProvider: aiMeta?.provider ?? null,
        asrProvider: source === "voice" ? asrProvider : null,
        aiConfidence: aiMeta?.confidence ?? null,
        aiRaw: aiMeta?.raw ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses", circleId] });
      qc.invalidateQueries({ queryKey: ["balances", circleId] });
      qc.invalidateQueries({ queryKey: ["my-balances"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      navigate(`/circles/${circleId}`);
    },
  });

  if (members.isLoading) return <Centered><Spinner /></Centered>;

  const memberName = (id: string) => members.data?.find((m) => m.user_id === id)?.profile?.display_name ?? (id === user?.id ? "我" : "成员");
  const canSave = !!draft && !previewError && !save.isPending;
  const amtParts = Number.isFinite(totalMinor) && totalMinor > 0 ? (totalMinor / 100).toFixed(digits) : "";

  const selectRow = (label: string, control: ReactNode) => (
    <div className="flex h-12 items-center justify-between px-4">
      <span className="text-[16px]">{label}</span>
      <div className="flex items-center gap-1.5" style={{ color: "var(--label2)" }}>
        {control}
        <ChevronR size={17} />
      </div>
    </div>
  );

  return (
    <div className="mx-auto min-h-screen max-w-md">
      <div className="flex items-center justify-between px-4 pb-2 pt-2">
        <button className="text-[17px]" style={{ color: "var(--blue)" }} onClick={() => navigate(-1)}>取消</button>
        <div className="text-[17px] font-semibold">记一笔</div>
        <button className="text-[17px] font-semibold disabled:opacity-40" style={{ color: "var(--blue)" }} disabled={!canSave} onClick={() => save.mutate()}>保存</button>
      </div>

      <div className="px-4 pb-10 pt-2">
        {showVoicePrivacy && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-4 pb-[max(24px,env(safe-area-inset-bottom))]" role="dialog" aria-modal="true" aria-labelledby="voice-privacy-title">
            <Card className="w-full max-w-md p-5">
              <h2 id="voice-privacy-title" className="text-[18px] font-semibold">使用云端语音转写</h2>
              <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--label2)" }}>
                录音会加密上传到 AA 配置的语音识别服务，转写完成后即丢弃，不写入数据库或设备文件。转写文字仅在你核对并保存账单后按账单审计规则保存。
              </p>
              <div className="mt-5 flex gap-3">
                <button className="h-11 flex-1 rounded-[10px] text-[16px]" style={{ background: "var(--seg-bg)" }} onClick={() => { pendingVoiceStartRef.current = false; setShowVoicePrivacy(false); }}>
                  取消
                </button>
                <button
                  className="h-11 flex-1 rounded-[10px] text-[16px] font-semibold text-white"
                  style={{ background: "var(--blue)" }}
                  onClick={() => {
                    const shouldStart = pendingVoiceStartRef.current;
                    pendingVoiceStartRef.current = false;
                    localStorage.setItem("aa.voice-cloud-consent", "1");
                    setShowVoicePrivacy(false);
                    if (shouldStart) void startVoiceCapture();
                  }}
                >
                  同意并录音
                </button>
              </div>
            </Card>
          </div>
        )}

        {/* AI quick entry */}
        <Card className="mb-5 p-3">
          <div className="mb-1 px-1 text-[12px] font-semibold" style={{ color: "var(--label3)" }}>✨ 一句话记账</div>
          <div className="flex h-11 items-center px-1">
            <Input
              value={nlText}
              onChange={(e) => {
                setNlText(e.target.value);
                setAsrProvider(null); // typed/edited by hand — no longer a voice transcript
              }}
              placeholder="如：昨晚和小红吃火锅 360 三人平摊"
              className="text-[15px]"
            />
          </div>
          <Hairline inset={4} />
          <div className="flex gap-2 px-1 pt-2">
            <button
              className="flex-1 rounded-[9px] py-2 text-[14px] font-medium disabled:opacity-50"
              style={
                voice === "listening" || voice === "recording"
                  ? { background: "var(--red)", color: "#fff" }
                  : { background: "var(--seg-bg)", color: "var(--ink)" }
              }
              disabled={voice === "requesting" || voice === "transcribing"}
              onClick={toggleVoice}
            >
              {voice === "requesting"
                ? "正在请求麦克风…"
                : voice === "listening"
                  ? "● 聆听中，点按停止"
                  : voice === "recording"
                    ? `● 录音 ${voiceSeconds}s / 60s，点按结束`
                    : voice === "transcribing"
                      ? "转写中…"
                      : "🎤 语音"}
            </button>
            <button className="flex-1 rounded-[9px] py-2 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: "var(--blue)" }} disabled={!nlText.trim() || parse.isPending} onClick={() => parse.mutate()}>
              {parse.isPending ? "解析中…" : "AI 解析"}
            </button>
          </div>
          {voiceErr && <p className="px-1 pt-1.5 text-[12px]" style={{ color: "var(--red)" }}>{voiceErr}</p>}
          {parse.error && <p className="px-1 pt-1.5 text-[12px]" style={{ color: "var(--red)" }}>{(parse.error as Error).message}</p>}
          {source === "agent" && (
            <p className="px-1 pt-1.5 text-[12px]" style={{ color: "var(--green)" }}>
              ✓ 已由 AI 预填，请核对{unresolved.length ? ` · 未识别：${unresolved.join("、")}` : ""}
            </p>
          )}
        </Card>

        {/* amount */}
        <div className="py-3.5 text-center">
          <div className="text-[13px]" style={{ color: "var(--label2)" }}>金额 · {currency}</div>
          <div className="tnum mt-1 flex items-center justify-center text-[52px] font-semibold leading-none">
            <span>¥</span>
            <input
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              autoFocus
              className="w-[170px] bg-transparent text-center outline-none placeholder:text-[color:var(--tertiary)]"
            />
          </div>
          {amtParts && <div className="tnum mt-1 text-[13px]" style={{ color: "var(--tertiary)" }}>= ¥{amtParts}</div>}
        </div>

        {/* meta */}
        <Card className="mb-[22px]">
          {selectRow("付款人", (
            <span className="flex items-center gap-1.5">
              <Avatar name={memberName(payerId)} seed={payerId} me={payerId === user?.id} size={22} />
              <select value={payerId} onChange={(e) => setPayerId(e.target.value)} className="appearance-none bg-transparent text-right text-[16px]" style={{ color: "var(--label2)" }}>
                {members.data?.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m.user_id)}</option>)}
              </select>
            </span>
          ))}
          <Hairline />
          {selectRow("分类", (
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="appearance-none bg-transparent text-right text-[16px]" style={{ color: "var(--label2)" }}>
              <option value="">未分类</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ))}
          <Hairline />
          <div className="flex h-12 items-center justify-between px-4">
            <span className="text-[16px]">日期</span>
            <input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} className="bg-transparent text-right text-[16px]" style={{ color: "var(--label2)" }} />
          </div>
        </Card>

        {/* description */}
        <Card className="mb-[22px]">
          <div className="flex h-12 items-center px-4">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="备注，如 火锅、打车" className="text-[16px]" />
          </div>
        </Card>

        {/* split */}
        <div className="mb-[7px] flex items-center justify-between px-4">
          <span className="text-[13px]" style={{ color: "var(--label3)" }}>如何分摊</span>
          <Segmented
            className="w-[180px]"
            value={splitType}
            onChange={setSplitType}
            options={[{ value: "equal", label: "平均" }, { value: "exact", label: "精确" }, { value: "shares", label: "份额" }]}
          />
        </div>
        <Card>
          {members.data?.map((m, i) => {
            const checked = participants.has(m.user_id);
            const owed = allocation?.get(m.user_id);
            return (
              <div key={m.user_id}>
                {i > 0 && <Hairline inset={53} />}
                <div className="flex items-center gap-[11px] px-4 py-[9px]">
                  <button onClick={() => toggle(m.user_id)} aria-label="toggle">{checked ? <CheckOn /> : <CheckOff />}</button>
                  <Avatar name={memberName(m.user_id)} seed={m.user_id} me={m.user_id === user?.id} size={30} />
                  <span className="flex-1 text-[16px] font-medium tracking-[-0.01em]" style={checked ? undefined : { color: "var(--label2)" }}>{memberName(m.user_id)}</span>
                  {checked && splitType === "exact" && (
                    <input value={exactStr[m.user_id] ?? ""} onChange={(e) => setExactStr((p) => ({ ...p, [m.user_id]: e.target.value }))} inputMode="decimal" placeholder="0.00" className="w-20 rounded-md bg-[var(--bg)] px-2 py-1 text-right text-[15px] outline-none" />
                  )}
                  {checked && splitType === "shares" && (
                    <input value={weightStr[m.user_id] ?? "1"} onChange={(e) => setWeightStr((p) => ({ ...p, [m.user_id]: e.target.value }))} inputMode="numeric" placeholder="1" className="w-14 rounded-md bg-[var(--bg)] px-2 py-1 text-right text-[15px] outline-none" />
                  )}
                  {checked && owed != null && <span className="tnum text-[15px] font-medium" style={{ color: "var(--label2)" }}>{formatMoney(owed, currency)}</span>}
                </div>
              </div>
            );
          })}
        </Card>

        {previewError && <p className="px-4 pt-2 text-[13px]" style={{ color: "var(--red)" }}>{previewError}</p>}
        {save.error && <p className="px-4 pt-2 text-[13px]" style={{ color: "var(--red)" }}>{(save.error as Error).message}</p>}
      </div>
    </div>
  );
}
