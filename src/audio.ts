// Mic capture + FFT band analysis. Slider params linked to a band are
// modulated on the CPU each frame: value = base + band * (max - base),
// so the slider position acts as the floor and audio pushes toward max.
import { EFFECT_BY_ID } from "./effects/list";
import type { AudioBand, ModSource, PipelineNode } from "./effects/types";

export const BANDS: AudioBand[] = ["level", "bass", "mid", "treble"];
// audio bands + time-based oscillators (LFOs work without a mic)
export const MOD_SOURCES: ModSource[] = [...BANDS, "sine", "saw"];

export function hasLfoMods(pipeline: PipelineNode[]): boolean {
  return pipeline.some(
    (n) =>
      n.enabled &&
      n.mods &&
      Object.values(n.mods).some((m) => m === "sine" || m === "saw"),
  );
}

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let stream: MediaStream | null = null;
let bins: Uint8Array<ArrayBuffer> | null = null;

const smoothed: Record<AudioBand, number> = { level: 0, bass: 0, mid: 0, treble: 0 };

export async function startMic(): Promise<void> {
  if (analyser) return;
  stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.5;
  src.connect(analyser);
  bins = new Uint8Array(analyser.frequencyBinCount);
}

export function stopMic(): void {
  stream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  ctx = null;
  analyser = null;
  stream = null;
  bins = null;
  for (const b of BANDS) smoothed[b] = 0;
}

export function micActive(): boolean {
  return analyser !== null;
}

function avg(data: Uint8Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i];
  return sum / ((to - from) * 255);
}

export function getBands(): Record<AudioBand, number> {
  if (analyser && bins) {
    analyser.getByteFrequencyData(bins);
    const n = bins.length; // 128 bins, ~187 Hz each at 48 kHz
    const raw: Record<AudioBand, number> = {
      level: avg(bins, 0, n),
      bass: avg(bins, 0, 4),
      mid: avg(bins, 4, 26),
      treble: avg(bins, 26, Math.min(96, n)),
    };
    for (const b of BANDS) {
      const v = Math.min(1, raw[b] * 1.4);
      // fast attack, slow release
      smoothed[b] = v > smoothed[b] ? v : smoothed[b] * 0.88 + v * 0.12;
    }
  }
  return smoothed;
}

function modValue(
  src: ModSource,
  bands: Record<AudioBand, number>,
  time: number,
): number {
  if (src === "sine") return 0.5 + 0.5 * Math.sin(time * 1.5);
  if (src === "saw") return (time * 0.35) % 1;
  return bands[src];
}

export function applyMods(
  pipeline: PipelineNode[],
  bands: Record<AudioBand, number>,
  time: number,
): PipelineNode[] {
  return pipeline.map((node) => {
    if (!node.mods || Object.keys(node.mods).length === 0) return node;
    const effect = EFFECT_BY_ID[node.effectId];
    if (!effect) return node;
    const params = { ...node.params };
    for (const [uniform, src] of Object.entries(node.mods)) {
      const c = effect.controls.find(
        (ct) => ct.uniform === uniform && ct.type === "slider",
      );
      if (!c || c.type !== "slider") continue;
      const base = Number(params[uniform] ?? c.default);
      params[uniform] = Math.min(
        c.max,
        base + modValue(src, bands, time) * (c.max - base),
      );
    }
    return { ...node, params };
  });
}
