import { create } from "zustand";
import { EFFECT_BY_ID, EFFECTS } from "./effects/list";
import type { AudioBand, ParamValue, PipelineNode } from "./effects/types";
import type { Preset } from "./presets";
import { BANDS, startMic, stopMic } from "./audio";

export interface Source {
  el: HTMLCanvasElement | HTMLVideoElement;
  w: number;
  h: number;
  name: string;
  live?: boolean;
}

interface State {
  source: Source | null;
  pipeline: PipelineNode[];
  expanded: string | null;
  audioOn: boolean;
  seed: string | null;
  startAudio: () => Promise<void>;
  stopAudio: () => void;
  cycleMod: (uid: string, uniform: string) => void;
  setSource: (el: HTMLCanvasElement, w: number, h: number, name: string) => void;
  addEffect: (effectId: string) => void;
  removeNode: (uid: string) => void;
  toggleNode: (uid: string) => void;
  moveNode: (uid: string, dir: -1 | 1) => void;
  setParam: (uid: string, uniform: string, value: ParamValue) => void;
  resetNode: (uid: string) => void;
  setExpanded: (uid: string | null) => void;
  clear: () => void;
  surprise: (seed?: string) => void;
  applyPreset: (preset: Preset) => void;
  startWebcam: () => Promise<void>;
  stopWebcam: () => void;
}

let webcamStream: MediaStream | null = null;

const MAX_DIM = 1600;
let counter = 0;
const uid = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`;

function defaultParams(effectId: string): Record<string, ParamValue> {
  const e = EFFECT_BY_ID[effectId];
  const p: Record<string, ParamValue> = {};
  for (const c of e.controls) p[c.uniform] = c.default;
  return p;
}

export function fitToCanvas(
  img: CanvasImageSource,
  iw: number,
  ih: number,
): { el: HTMLCanvasElement; w: number; h: number } {
  const scale = Math.min(1, MAX_DIM / Math.max(iw, ih));
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  cv.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return { el: cv, w, h };
}

// a colourful procedural sample so the canvas is never empty
export function sampleImage(): { el: HTMLCanvasElement; w: number; h: number } {
  const w = 1200;
  const h = 800;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#10183a");
  g.addColorStop(0.5, "#6b1f6b");
  g.addColorStop(1, "#ff6b3d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 7; i++) {
    const rg = ctx.createRadialGradient(
      120 + i * 150,
      h * (0.3 + 0.4 * Math.sin(i)),
      0,
      120 + i * 150,
      h * (0.3 + 0.4 * Math.sin(i)),
      220,
    );
    rg.addColorStop(0, `hsla(${i * 50}, 90%, 65%, 0.85)`);
    rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "bold 160px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("cool", w / 2, h / 2);
  return { el: cv, w, h };
}

// seeded RNG (xmur3 string hash -> mulberry32) so remixes are reproducible
function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const useStore = create<State>((set) => ({
  source: null,
  pipeline: [],
  expanded: null,
  audioOn: false,
  seed: null,

  startAudio: async () => {
    await startMic();
    set({ audioOn: true });
  },

  stopAudio: () => {
    stopMic();
    set({ audioOn: false });
  },

  cycleMod: (id, uniform) =>
    set((s) => ({
      pipeline: s.pipeline.map((n) => {
        if (n.uid !== id) return n;
        const cur = n.mods?.[uniform];
        const next: AudioBand | undefined =
          cur === undefined ? BANDS[0] : BANDS[BANDS.indexOf(cur) + 1];
        const mods = { ...(n.mods ?? {}) };
        if (next) mods[uniform] = next;
        else delete mods[uniform];
        return { ...n, mods };
      }),
    })),

  setSource: (el, w, h, name) => set({ source: { el, w, h, name } }),

  addEffect: (effectId) => {
    const node: PipelineNode = {
      uid: uid(),
      effectId,
      enabled: true,
      params: defaultParams(effectId),
    };
    set((s) => ({ pipeline: [...s.pipeline, node], expanded: node.uid }));
  },

  removeNode: (id) =>
    set((s) => ({ pipeline: s.pipeline.filter((n) => n.uid !== id) })),

  toggleNode: (id) =>
    set((s) => ({
      pipeline: s.pipeline.map((n) =>
        n.uid === id ? { ...n, enabled: !n.enabled } : n,
      ),
    })),

  moveNode: (id, dir) =>
    set((s) => {
      const i = s.pipeline.findIndex((n) => n.uid === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.pipeline.length) return s;
      const p = [...s.pipeline];
      [p[i], p[j]] = [p[j], p[i]];
      return { pipeline: p };
    }),

  setParam: (id, uniform, value) =>
    set((s) => ({
      pipeline: s.pipeline.map((n) =>
        n.uid === id ? { ...n, params: { ...n.params, [uniform]: value } } : n,
      ),
    })),

  resetNode: (id) =>
    set((s) => ({
      pipeline: s.pipeline.map((n) =>
        n.uid === id ? { ...n, params: defaultParams(n.effectId) } : n,
      ),
    })),

  setExpanded: (id) => set({ expanded: id }),

  clear: () => set({ pipeline: [], expanded: null }),

  surprise: (seedArg?: string) => {
    const seed = seedArg?.trim() || Math.random().toString(36).slice(2, 8);
    const rng = seededRng(seed);
    const n = 2 + Math.floor(rng() * 3);
    const pool = [...EFFECTS];
    const nodes: PipelineNode[] = [];
    for (let i = 0; i < n && pool.length; i++) {
      const e = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const params: Record<string, ParamValue> = {};
      for (const c of e.controls) {
        if (c.type === "slider")
          params[c.uniform] = +(c.min + rng() * (c.max - c.min)).toFixed(3);
        else if (c.type === "toggle") params[c.uniform] = rng() < 0.5 ? 0 : 1;
        else if (c.type === "select")
          params[c.uniform] = Math.floor(rng() * c.options.length);
        else params[c.uniform] = c.default;
      }
      nodes.push({ uid: uid(), effectId: e.id, enabled: true, params });
    }
    set({ pipeline: nodes, expanded: null, seed });
  },

  applyPreset: (preset) => {
    const nodes: PipelineNode[] = preset.nodes.map((n) => ({
      uid: uid(),
      effectId: n.effectId,
      enabled: true,
      params: { ...defaultParams(n.effectId), ...(n.params ?? {}) },
    }));
    set({ pipeline: nodes, expanded: null });
  },

  startWebcam: async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: false,
    });
    webcamStream = stream;
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    set({
      source: {
        el: video,
        w: video.videoWidth || 1280,
        h: video.videoHeight || 720,
        name: "webcam",
        live: true,
      },
    });
  },

  stopWebcam: () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      webcamStream = null;
    }
    const { el, w, h } = sampleImage();
    set({ source: { el, w, h, name: "sample" } });
  },
}));

// ---- URL share (encode pipeline into the hash) ----
type Encoded = {
  e: string;
  on: number;
  p: Record<string, ParamValue>;
  m?: Record<string, AudioBand>;
}[];

export function encodeState(pipeline: PipelineNode[]): string {
  const min: Encoded = pipeline.map((n) => ({
    e: n.effectId,
    on: n.enabled ? 1 : 0,
    p: n.params,
    ...(n.mods && Object.keys(n.mods).length ? { m: n.mods } : {}),
  }));
  return btoa(encodeURIComponent(JSON.stringify(min)));
}

export function decodeState(hash: string): PipelineNode[] | null {
  try {
    const min: Encoded = JSON.parse(decodeURIComponent(atob(hash)));
    return min
      .filter((m) => EFFECT_BY_ID[m.e])
      .map((m) => ({
        uid: uid(),
        effectId: m.e,
        enabled: m.on === 1,
        params: { ...defaultParams(m.e), ...m.p },
        ...(m.m ? { mods: m.m } : {}),
      }));
  } catch {
    return null;
  }
}
