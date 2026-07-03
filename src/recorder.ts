// WebM capture of the WebGL canvas via MediaRecorder.
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

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
  const stream = canvas.captureStream(30);
  chunks = [];
  recorder = new MediaRecorder(stream, {
    mimeType: pickMime() || undefined,
    videoBitsPerSecond: 8_000_000,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.start(250);
}

export function stopRecording(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const rec = recorder;
    if (!rec) return resolve(null);
    recorder = null;
    rec.onstop = () => {
      const type = rec.mimeType || "video/webm";
      resolve(chunks.length ? new Blob(chunks, { type }) : null);
      chunks = [];
    };
    rec.stop();
    rec.stream.getTracks().forEach((t) => t.stop());
  });
}
