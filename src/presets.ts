import type { ParamValue } from "./effects/types";

export interface Preset {
  name: string;
  nodes: { effectId: string; params?: Record<string, ParamValue> }[];
}

// curated one-click looks — each shows off the effect-chaining pipeline
export const PRESETS: Preset[] = [
  {
    name: "Newsprint",
    nodes: [
      { effectId: "adjust", params: { uContrast: 1.3 } },
      { effectId: "halftone", params: { uCell: 6 } },
    ],
  },
  {
    name: "Vaporwave",
    nodes: [
      { effectId: "gradientmap", params: { uShadow: "#160033", uMid: "#ff2e88", uHigh: "#22e1ff" } },
      { effectId: "chromatic", params: { uAmount: 10 } },
      { effectId: "crt", params: { uScan: 0.3, uCurve: 0.2 } },
    ],
  },
  {
    name: "Blueprint",
    nodes: [
      {
        effectId: "edge",
        params: { uStrength: 2.5, uInvert: 1, uLine: "#cfe8ff", uPaper: "#0a2a5e" },
      },
    ],
  },
  {
    name: "Comic",
    nodes: [
      { effectId: "posterize", params: { uLevels: 6 } },
      { effectId: "cmyk", params: { uCell: 6 } },
      { effectId: "edge", params: { uStrength: 3 } },
    ],
  },
  {
    name: "Pen & Ink",
    nodes: [{ effectId: "crosshatch" }],
  },
  {
    name: "Glitch",
    nodes: [
      { effectId: "chromatic", params: { uAmount: 16, uRadial: 1 } },
      { effectId: "scatter", params: { uShift: 0.08 } },
      { effectId: "crt", params: { uScan: 0.5 } },
    ],
  },
  {
    name: "Stipple",
    nodes: [{ effectId: "stipple", params: { uCell: 5 } }],
  },
  {
    name: "Oil",
    nodes: [
      { effectId: "kuwahara", params: { uRadius: 6 } },
      { effectId: "adjust", params: { uSaturation: 1.3 } },
    ],
  },
];
