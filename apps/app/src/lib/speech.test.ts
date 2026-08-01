import { describe, expect, it, vi } from "vitest";
import {
  microphoneErrorMessage,
  preferredRecordingMimeType,
  startCloudRecording,
  type RecordingDependencies,
} from "./speech";

class FakeTrack {
  stopped = false;
  private ended: (() => void) | null = null;

  stop() {
    this.stopped = true;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "ended") this.ended = listener as () => void;
  }

  end() {
    this.ended?.();
  }
}

class FakeRecorder {
  mimeType = "audio/webm;codecs=opus";
  state: RecordingState = "inactive";
  ondataavailable: MediaRecorder["ondataavailable"] = null;
  onerror: MediaRecorder["onerror"] = null;
  onstop: MediaRecorder["onstop"] = null;

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") throw new DOMException("inactive", "InvalidStateError");
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.call(this as unknown as MediaRecorder, new Event("stop")));
  }

  data(blob: Blob) {
    this.ondataavailable?.call(this as unknown as MediaRecorder, { data: blob } as BlobEvent);
  }
}

function setup() {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const recorder = new FakeRecorder();
  const transcribe = vi.fn(async (blob: Blob) => ({ text: await blob.text(), provider: "test" }));
  const dependencies: RecordingDependencies = {
    getUserMedia: vi.fn(async () => stream),
    isTypeSupported: (mime) => mime === "audio/webm;codecs=opus",
    createRecorder: () => recorder,
    transcribe,
    setTimeout: vi.fn(() => 1) as unknown as typeof window.setTimeout,
    clearTimeout: vi.fn(),
  };
  return { dependencies, recorder, track, transcribe };
}

describe("recording format selection", () => {
  it("uses the first actually-supported allowlisted format", () => {
    expect(preferredRecordingMimeType((mime) => mime === "audio/mp4")).toBe("audio/mp4");
    expect(preferredRecordingMimeType(() => false)).toBeNull();
  });
});

describe("cloud recording", () => {
  it("uploads a binary Blob, stops tracks, and is idempotent", async () => {
    const { dependencies, recorder, track, transcribe } = setup();
    const recording = await startCloudRecording(dependencies);
    recorder.data(new Blob(["hello"], { type: recorder.mimeType }));

    const first = recording.stopAndTranscribe();
    const second = recording.stopAndTranscribe();
    await expect(first).resolves.toEqual({ text: "hello", provider: "test" });
    await expect(second).resolves.toEqual({ text: "hello", provider: "test" });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(track.stopped).toBe(true);
  });

  it("rejects empty recordings without uploading", async () => {
    const { dependencies, transcribe } = setup();
    const recording = await startCloudRecording(dependencies);
    await expect(recording.stopAndTranscribe()).rejects.toThrow("录音为空");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("cancels idempotently and releases tracks", async () => {
    const { dependencies, track, transcribe } = setup();
    const recording = await startCloudRecording(dependencies);
    recording.cancel();
    recording.cancel();
    await recording.stopped;
    expect(track.stopped).toBe(true);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("stops late streams returned after cancellation", async () => {
    const { dependencies, track } = setup();
    let releaseStream!: (stream: MediaStream) => void;
    const stream = await dependencies.getUserMedia({ audio: true });
    dependencies.getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
      releaseStream = resolve;
    }));

    const pending = startCloudRecording(dependencies);
    releaseStream(stream);
    const recording = await pending;
    recording.cancel();
    await recording.stopped;
    expect(track.stopped).toBe(true);
  });

  it("releases tracks when MediaRecorder construction fails", async () => {
    const { dependencies, track } = setup();
    dependencies.createRecorder = () => {
      throw new DOMException("unsupported", "NotSupportedError");
    };

    await expect(startCloudRecording(dependencies)).rejects.toThrow("无法启动录音");
    expect(track.stopped).toBe(true);
  });

  it("releases every track when MediaRecorder.start fails", async () => {
    const { dependencies, recorder, track } = setup();
    const secondTrack = new FakeTrack();
    dependencies.getUserMedia = vi.fn(async () => ({
      getTracks: () => [track, secondTrack],
    }) as unknown as MediaStream);
    recorder.start = () => {
      throw new DOMException("cannot start", "InvalidStateError");
    };

    await expect(startCloudRecording(dependencies)).rejects.toThrow("无法启动录音");
    expect(track.stopped).toBe(true);
    expect(secondTrack.stopped).toBe(true);
  });

  it("settles and releases tracks when the recorder becomes inactive without an onstop event", async () => {
    const { dependencies, recorder, track } = setup();
    const recording = await startCloudRecording(dependencies);
    recorder.state = "inactive";

    await expect(recording.stopAndTranscribe()).rejects.toThrow("录音为空");
    expect(track.stopped).toBe(true);
  });

  it("rejects when the microphone track ends", async () => {
    const { dependencies, track, transcribe } = setup();
    const recording = await startCloudRecording(dependencies);
    track.end();

    await expect(recording.stopAndTranscribe()).rejects.toThrow("麦克风连接已中断");
    expect(track.stopped).toBe(true);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects recordings over 8 MiB before upload", async () => {
    const { dependencies, recorder, transcribe } = setup();
    const recording = await startCloudRecording(dependencies);
    recorder.data(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: recorder.mimeType }));
    await expect(recording.stopAndTranscribe()).rejects.toThrow("8 MiB");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("stops automatically at the recording deadline", async () => {
    const { dependencies, recorder } = setup();
    let deadline: (() => void) | null = null;
    dependencies.setTimeout = vi.fn((callback: TimerHandler) => {
      deadline = callback as () => void;
      return 1;
    }) as unknown as typeof window.setTimeout;
    const recording = await startCloudRecording(dependencies);
    recorder.data(new Blob(["limited"], { type: recorder.mimeType }));
    (deadline as (() => void) | null)?.();
    await recording.stopped;
    await expect(recording.stopAndTranscribe()).resolves.toEqual({ text: "limited", provider: "test" });
  });
});

describe("microphone errors", () => {
  it("maps permission and hardware errors to actionable messages", () => {
    expect(microphoneErrorMessage(new DOMException("denied", "NotAllowedError"))).toMatch(/Android 设置/);
    expect(microphoneErrorMessage(new DOMException("missing", "NotFoundError"))).toMatch(/未检测到/);
    expect(microphoneErrorMessage(new DOMException("busy", "NotReadableError"))).toMatch(/占用/);
  });
});
