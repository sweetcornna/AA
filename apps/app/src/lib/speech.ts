// Pluggable speech-to-text. Two routes, chosen at runtime by availability:
//   1. Web Speech API (webkitSpeechRecognition) — free, on-device-ish, works in
//      Chromium / most desktop webviews. Live transcription.
//   2. Cloud fallback — record with MediaRecorder, upload the blob to the
//      asr-transcribe Edge Function. The path for iOS WKWebView / webviews where
//      Web Speech is unavailable.
// Either route degrades to manual text entry on failure; voice never blocks.
import { transcribeAudio } from "./api";

// Web Speech API is non-standard / vendor-prefixed and not in lib.dom types.
type SpeechRecognitionCtor = new () => any;

function SRClass(): SpeechRecognitionCtor | null {
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

export function webSpeechAvailable(): boolean {
  return SRClass() != null;
}

/** Start live Web Speech recognition. Returns a stop() that aborts it. */
export function startWebSpeech(cb: {
  onText: (text: string) => void;
  onEnd: () => void;
  onError: (msg: string) => void;
}): () => void {
  const Ctor = SRClass();
  if (!Ctor) {
    cb.onError("不支持浏览器语音");
    cb.onEnd();
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = "zh-CN";
  rec.interimResults = true;
  rec.continuous = false;
  let final = "";
  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    cb.onText((final + interim).trim());
  };
  rec.onerror = (e: any) => cb.onError(e?.error === "not-allowed" ? "麦克风权限被拒绝" : "语音识别出错");
  rec.onend = () => cb.onEnd();
  rec.start();
  return () => {
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  };
}

export interface Recording {
  /** Stop recording and resolve the transcribed text via the cloud function. */
  stopAndTranscribe: () => Promise<string>;
  /** Abort without transcribing. */
  cancel: () => void;
}

/** Start recording mic audio; resolve a handle to stop + transcribe via cloud ASR. */
export async function startCloudRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  rec.start();

  const cleanup = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stopAndTranscribe: () =>
      new Promise<string>((resolve, reject) => {
        rec.onstop = async () => {
          cleanup();
          try {
            const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
            resolve(await transcribeAudio(blob));
          } catch (e) {
            reject(e);
          }
        };
        rec.stop();
      }),
    cancel: () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      cleanup();
    },
  };
}
