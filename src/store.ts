import { create } from "zustand";
import { CUSTOM_DEFAULT, EFFECT_BY_ID, EFFECTS } from "./effects/list";
import {
  defaultMask,
  type MaskParams,
  type ModSource,
  type ParamValue,
  type PipelineNode,
} from "./effects/types";
import type { Preset } from "./presets";
import { MOD_SOURCES, startMic, stopMic } from "./audio";

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
  compare: number | null;
  startAudio: () => Promise<void>;
  stopAudio: () => void;
  cycleMod: (uid: string, uniform: string) => void;
  setCompare: (v: number | null) => void;
  setCode: (uid: string, code: string) => void;
  setMask: (uid: string, mask: Partial<MaskParams> | null) => void;
  loadVideo: (file: File) => Promise<void>;
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
let videoUrl: string | null = null;
let videoEl: HTMLVideoElement | null = null;
let mediaRequestGeneration = 0;

// stop any live media source (webcam stream or looping video file)
function releaseMedia() {
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
  }
  if (videoEl) {
    videoEl.pause();
    videoEl.srcObject = null;
    videoEl.removeAttribute("src");
    videoEl.load();
    videoEl = null;
  }
  if (videoUrl) {
    URL.revokeObjectURL(videoUrl);
    videoUrl = null;
  }
}

function releaseCandidateVideo(video: HTMLVideoElement, url?: string) {
  video.pause();
  video.srcObject = null;
  video.removeAttribute("src");
  video.load();
  if (url) URL.revokeObjectURL(url);
}

function releaseCandidateStream(video: HTMLVideoElement, stream: MediaStream) {
  releaseCandidateVideo(video);
  stream.getTracks().forEach((track) => track.stop());
}

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
  compare: null,

  setCompare: (v) => set({ compare: v }),

  setCode: (id, code) =>
    set((s) => ({
      pipeline: s.pipeline.map((n) => (n.uid === id ? { ...n, code } : n)),
    })),

  setMask: (id, mask) =>
    set((s) => ({
      pipeline: s.pipeline.map((n) =>
        n.uid === id
          ? {
              ...n,
              mask:
                mask === null
                  ? undefined
                  : { ...(n.mask ?? defaultMask()), ...mask },
            }
          : n,
      ),
    })),

  loadVideo: async (file) => {
    const generation = ++mediaRequestGeneration;
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch (error) {
      releaseCandidateVideo(video, url);
      throw error;
    }
    if (generation !== mediaRequestGeneration) {
      releaseCandidateVideo(video, url);
      return;
    }
    releaseMedia();
    videoEl = video;
    videoUrl = url;
    const iw = video.videoWidth || 1280;
    const ih = video.videoHeight || 720;
    const scale = Math.min(1, MAX_DIM / Math.max(iw, ih));
    set({
      source: {
        el: video,
        w: Math.round(iw * scale),
        h: Math.round(ih * scale),
        name: file.name,
        live: true,
      },
    });
  },

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
        const next: ModSource | undefined =
          cur === undefined
            ? MOD_SOURCES[0]
            : MOD_SOURCES[MOD_SOURCES.indexOf(cur) + 1];
        const mods = { ...(n.mods ?? {}) };
        if (next) mods[uniform] = next;
        else delete mods[uniform];
        return { ...n, mods };
      }),
    })),

  setSource: (el, w, h, name) => {
    mediaRequestGeneration++;
    releaseMedia();
    set({ source: { el, w, h, name } });
  },

  addEffect: (effectId) => {
    const node: PipelineNode = {
      uid: uid(),
      effectId,
      enabled: true,
      params: defaultParams(effectId),
      ...(effectId === "custom" ? { code: CUSTOM_DEFAULT } : {}),
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
    const pool = EFFECTS.filter((e) => e.id !== "custom");
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
    set({ pipeline: nodesFromPreset(preset), expanded: null });
  },

  startWebcam: async () => {
    const generation = ++mediaRequestGeneration;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: false,
    });
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch (error) {
      releaseCandidateStream(video, stream);
      throw error;
    }
    if (generation !== mediaRequestGeneration) {
      releaseCandidateStream(video, stream);
      return;
    }
    releaseMedia();
    webcamStream = stream;
    videoEl = video;
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
    mediaRequestGeneration++;
    releaseMedia();
    const { el, w, h } = sampleImage();
    set({ source: { el, w, h, name: "sample" } });
  },
}));

export function nodesFromPreset(preset: Preset): PipelineNode[] {
  return preset.nodes.map((n) => ({
    uid: uid(),
    effectId: n.effectId,
    enabled: true,
    params: { ...defaultParams(n.effectId), ...(n.params ?? {}) },
  }));
}

// ---- URL share (encode pipeline into the hash) ----
type Encoded = {
  e: string;
  on: number;
  p: Record<string, ParamValue>;
  m?: Record<string, ModSource>;
  c?: string;
  k?: MaskParams;
}[];

export function encodeState(pipeline: PipelineNode[]): string {
  const min: Encoded = pipeline.map((n) => ({
    e: n.effectId,
    on: n.enabled ? 1 : 0,
    p: n.params,
    ...(n.mods && Object.keys(n.mods).length ? { m: n.mods } : {}),
    ...(n.code !== undefined ? { c: n.code } : {}),
    ...(n.mask && n.mask.type > 0 ? { k: n.mask } : {}),
  }));
  return btoa(encodeURIComponent(JSON.stringify(min)));
}

const MAX_SHARED_NODES = 100;
const MAX_SHARED_CODE_LENGTH = 100_000;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function decodedParams(effectId: string, value: unknown): Record<string, ParamValue> {
  const params = defaultParams(effectId);
  if (!isRecord(value)) return params;
  for (const control of EFFECT_BY_ID[effectId].controls) {
    const candidate = value[control.uniform];
    if (control.type === "color") {
      if (typeof candidate === "string" && HEX_COLOR.test(candidate)) {
        params[control.uniform] = candidate;
      }
      continue;
    }
    const n = finiteNumber(candidate);
    if (n === null) continue;
    if (control.type === "slider") {
      params[control.uniform] = clamp(n, control.min, control.max);
    } else if (control.type === "toggle") {
      params[control.uniform] = n > 0.5 ? 1 : 0;
    } else {
      params[control.uniform] = clamp(Math.round(n), 0, control.options.length - 1);
    }
  }
  return params;
}

function decodedMods(effectId: string, value: unknown): Record<string, ModSource> | null {
  if (!isRecord(value)) return null;
  const mods: Record<string, ModSource> = {};
  for (const control of EFFECT_BY_ID[effectId].controls) {
    if (control.type !== "slider") continue;
    const candidate = value[control.uniform];
    if (MOD_SOURCES.some((source) => source === candidate)) {
      mods[control.uniform] = candidate as ModSource;
    }
  }
  return Object.keys(mods).length ? mods : null;
}

function decodedMask(value: unknown): MaskParams | null {
  if (!isRecord(value)) return null;
  const mask = defaultMask();
  const type = finiteNumber(value.type);
  const invert = finiteNumber(value.invert);
  const cx = finiteNumber(value.cx);
  const cy = finiteNumber(value.cy);
  const size = finiteNumber(value.size);
  const feather = finiteNumber(value.feather);
  const angle = finiteNumber(value.angle);
  if (type !== null) mask.type = clamp(Math.round(type), 0, 2);
  if (invert !== null) mask.invert = invert > 0.5 ? 1 : 0;
  if (cx !== null) mask.cx = clamp(cx, 0, 1);
  if (cy !== null) mask.cy = clamp(cy, 0, 1);
  if (size !== null) mask.size = clamp(size, 0.02, 1);
  if (feather !== null) mask.feather = clamp(feather, 0.001, 0.5);
  if (angle !== null) mask.angle = clamp(angle, 0, 360);
  return mask.type > 0 ? mask : null;
}

export function decodeState(hash: string): PipelineNode[] | null {
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(atob(hash)));
    if (!Array.isArray(decoded) || decoded.length > MAX_SHARED_NODES) return null;
    const pipeline: PipelineNode[] = [];
    for (const item of decoded) {
      if (!isRecord(item) || typeof item.e !== "string" || !EFFECT_BY_ID[item.e]) {
        continue;
      }
      const mods = decodedMods(item.e, item.m);
      const mask = decodedMask(item.k);
      const code =
        item.e === "custom" &&
        typeof item.c === "string" &&
        item.c.length <= MAX_SHARED_CODE_LENGTH
          ? item.c
          : null;
      pipeline.push({
        uid: uid(),
        effectId: item.e,
        enabled: item.on === 1,
        params: decodedParams(item.e, item.p),
        ...(mods ? { mods } : {}),
        ...(code !== null ? { code } : {}),
        ...(mask ? { mask } : {}),
      });
    }
    return pipeline;
  } catch {
    return null;
  }
}
