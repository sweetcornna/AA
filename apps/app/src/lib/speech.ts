// Pluggable speech-to-text. Android always records and sends audio to cloud ASR;
// other platforms prefer Web Speech when available and fall back to cloud capture.
import { ASR_MIME_TYPES, MAX_AUDIO_BYTES } from "./asrClient";
import { transcribeAudio } from "./api";

const MAX_RECORDING_MS = 60_000;
const DATA_SLICE_MS = 500;
const RECORDING_START_ERROR = "无法启动录音，请更新系统 WebView 后重试或直接输入文字。";

type SpeechRecognitionCtor = new () => any;

type RecorderLike = Pick<MediaRecorder, "mimeType" | "state" | "start" | "stop"> & {
  ondataavailable: MediaRecorder["ondataavailable"];
  onerror: MediaRecorder["onerror"];
  onstop: MediaRecorder["onstop"];
};

export interface RecordingDependencies {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  isTypeSupported: (mimeType: string) => boolean;
  createRecorder: (stream: MediaStream, options: MediaRecorderOptions) => RecorderLike;
  transcribe: (blob: Blob, signal?: AbortSignal) => Promise<{ text: string; provider: string }>;
  setTimeout: typeof window.setTimeout;
  clearTimeout: typeof window.clearTimeout;
}

function SRClass(): SpeechRecognitionCtor | null {
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

export function isAndroidTauri(): boolean {
  return /^android(?:eabi)?$/i.test(import.meta.env.TAURI_ENV_PLATFORM ?? "");
}

export function webSpeechAvailable(): boolean {
  return !isAndroidTauri() && SRClass() != null;
}

export function preferredRecordingMimeType(isTypeSupported = MediaRecorder.isTypeSupported): string | null {
  return ASR_MIME_TYPES.find((mimeType) => isTypeSupported(mimeType)) ?? null;
}

export function microphoneErrorMessage(error: unknown): string {
  const name = error instanceof DOMException
    ? error.name
    : typeof error === "object" && error && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "麦克风权限被拒绝。若已永久拒绝，请到 Android 设置 → 应用 → AA Ledger → 权限 → 麦克风中开启。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "未检测到可用麦克风。";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "麦克风被其他应用占用或录音已中断，请稍后重试。";
  }
  return "无法访问麦克风，请检查权限后重试或直接输入文字。";
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
  rec.onresult = (event: any) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) final += result[0].transcript;
      else interim += result[0].transcript;
    }
    cb.onText((final + interim).trim());
  };
  rec.onerror = (event: any) => cb.onError(event?.error === "not-allowed" ? "麦克风权限被拒绝" : "语音识别出错");
  rec.onend = () => cb.onEnd();
  rec.start();
  return () => {
    try {
      rec.stop();
    } catch {
      // Already stopped.
    }
  };
}

export interface Recording {
  /** Resolves when capture has stopped, including at the 60-second limit. */
  stopped: Promise<void>;
  stopAndTranscribe: () => Promise<{ text: string; provider: string }>;
  cancel: () => void;
}

function browserRecordingDependencies(): RecordingDependencies {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("当前系统 WebView 不支持录音，请更新后重试或直接输入文字。");
  }
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
    createRecorder: (stream, options) => new MediaRecorder(stream, options),
    transcribe: transcribeAudio,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  };
}

/** Start recording mic audio; resolve a handle to stop + transcribe via cloud ASR. */
export async function startCloudRecording(
  dependencies: RecordingDependencies = browserRecordingDependencies(),
): Promise<Recording> {
  const mimeType = preferredRecordingMimeType(dependencies.isTypeSupported);
  if (!mimeType) throw new Error("当前系统 WebView 不支持可上传的录音格式，请更新后重试或直接输入文字。");

  let stream: MediaStream | null = null;
  try {
    stream = await dependencies.getUserMedia({ audio: true });
  } catch (error) {
    throw new Error(microphoneErrorMessage(error));
  }

  let recorder: RecorderLike;
  try {
    recorder = dependencies.createRecorder(stream, { mimeType });
  } catch {
    for (const track of stream.getTracks()) track.stop();
    throw new Error(RECORDING_START_ERROR);
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let terminalError: Error | null = null;
  let settled = false;
  let canceled = false;
  let uploadController: AbortController | null = null;
  let stopPromise: Promise<{ text: string; provider: string }> | null = null;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const cleanup = () => {
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  };
  let limitTimer: ReturnType<typeof window.setTimeout> | null = null;
  const clearLimitTimer = () => {
    if (limitTimer === null) return;
    dependencies.clearTimeout(limitTimer);
    limitTimer = null;
  };
  const settleCapture = () => {
    if (settled) return;
    clearLimitTimer();
    cleanup();
    settled = true;
    resolveStopped();
  };
  const stopRecorder = () => {
    if (recorder.state === "inactive") {
      settleCapture();
      return;
    }
    try {
      recorder.stop();
    } catch {
      terminalError ??= new Error("录音中断，请重试或直接输入文字。");
      settleCapture();
    }
  };

  recorder.ondataavailable = (event) => {
    if (!event.data.size || canceled) return;
    bytes += event.data.size;
    if (bytes > MAX_AUDIO_BYTES) {
      terminalError = new Error("录音超过 8 MiB 限制，请缩短后重试。");
      stopRecorder();
      return;
    }
    chunks.push(event.data);
  };
  recorder.onerror = () => {
    terminalError = new Error("录音中断，请重试或直接输入文字。");
    stopRecorder();
  };
  recorder.onstop = settleCapture;
  for (const track of stream.getTracks()) {
    track.addEventListener("ended", () => {
      if (settled || canceled) return;
      terminalError = new Error("麦克风连接已中断，请重试。");
      stopRecorder();
    }, { once: true });
  }

  try {
    recorder.start(DATA_SLICE_MS);
    limitTimer = dependencies.setTimeout(() => stopRecorder(), MAX_RECORDING_MS);
  } catch {
    clearLimitTimer();
    cleanup();
    throw new Error(RECORDING_START_ERROR);
  }

  return {
    stopped,
    stopAndTranscribe() {
      if (stopPromise) return stopPromise;
      stopRecorder();
      stopPromise = stopped.then(async () => {
        if (canceled) throw new Error("语音转写已取消");
        if (terminalError) throw terminalError;

        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (blob.size === 0) throw new Error("录音为空，请重试或直接输入文字。");
        uploadController = new AbortController();
        return dependencies.transcribe(blob, uploadController.signal);
      });
      return stopPromise;
    },
    cancel() {
      if (canceled) return;
      canceled = true;
      clearLimitTimer();
      uploadController?.abort();
      stopRecorder();
      settleCapture();
    },
  };
}
