// Canvas capture via MediaRecorder, using the best container the browser offers.
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  extension: ".webm" | ".mp4";
}

export function isRecording(): boolean {
  return recorder !== null;
}

function pickMime(): string {
  for (const m of [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export function startRecording(canvas: HTMLCanvasElement): void {
  if (recorder) return;
  if (typeof MediaRecorder === "undefined") {
    throw new Error("recording is unsupported in this browser");
  }
  if (typeof canvas.captureStream !== "function") {
    throw new Error("canvas recording is unsupported in this browser");
  }
  const stream = canvas.captureStream(30);
  chunks = [];
  try {
    const next = new MediaRecorder(stream, {
      mimeType: pickMime() || undefined,
      videoBitsPerSecond: 8_000_000,
    });
    next.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    next.start(250);
    recorder = next;
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    chunks = [];
    throw error;
  }
}

export function stopRecording(): Promise<RecordingResult | null> {
  return new Promise((resolve, reject) => {
    const rec = recorder;
    if (!rec) return resolve(null);
    recorder = null;
    const cleanup = () => {
      rec.stream.getTracks().forEach((track) => track.stop());
      chunks = [];
    };
    rec.onstop = () => {
      const type = rec.mimeType || "video/webm";
      const blob = chunks.length ? new Blob(chunks, { type }) : null;
      const mimeType = blob?.type || type;
      cleanup();
      resolve(
        blob
          ? {
              blob,
              mimeType,
              extension: mimeType.toLowerCase().startsWith("video/mp4")
                ? ".mp4"
                : ".webm",
            }
          : null,
      );
    };
    rec.onerror = () => {
      cleanup();
      reject(new Error("recording failed"));
    };
    try {
      rec.stop();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
