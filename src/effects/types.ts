// An effect = a fragment-shader snippet + a schema of controls.
// The renderer auto-declares a `uniform` for every control and feeds it the
// current param value. Each effect's `glsl` must define `vec3 effect(vec2 uv)`.

export type ControlType = "slider" | "toggle" | "select" | "color";

interface ControlBase {
  type: ControlType;
  uniform: string; // also used as the param key
  label: string;
}

export interface SliderControl extends ControlBase {
  type: "slider";
  min: number;
  max: number;
  step: number;
  default: number;
}
export interface ToggleControl extends ControlBase {
  type: "toggle";
  default: number; // 0 | 1
}
export interface SelectControl extends ControlBase {
  type: "select";
  options: string[];
  default: number; // index
}
export interface ColorControl extends ControlBase {
  type: "color";
  default: string; // hex, e.g. "#ff0000"
}

export type Control =
  | SliderControl
  | ToggleControl
  | SelectControl
  | ColorControl;

export interface EffectResources {
  // extra textures (bound to units >= 1) the effect's glsl declares itself
  textures?: { uniform: string; texture: WebGLTexture }[];
  // constant uniforms the effect's glsl declares itself
  uniforms?: { name: string; value: number }[];
}

export interface Effect {
  id: string;
  name: string;
  category: string;
  blurb: string;
  controls: Control[];
  // true if the effect uses uTime — render loop keeps animating it
  animated?: boolean;
  // GLSL body: helper fns + `vec3 effect(vec2 uv)`. May read uTexture,
  // uResolution, uTime and any control uniform. Shared helpers from the
  // renderer's PRELUDE (luma, lumAt, hash11, hash21, rot, LW) are available.
  glsl?: string;
  // multi-pass variant: each entry is a full GLSL body; passes run in order
  // through the ping-pong targets, sharing the same control uniforms.
  passes?: string[];
  // optional one-time GPU resources (e.g. a glyph atlas)
  resources?: (gl: WebGL2RenderingContext) => EffectResources;
}

export type ParamValue = number | string;

export interface PipelineNode {
  uid: string;
  effectId: string;
  enabled: boolean;
  params: Record<string, ParamValue>;
}

// helpers for terse control declarations
export const slider = (
  uniform: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
): SliderControl => ({ type: "slider", uniform, label, min, max, step, default: def });

export const toggle = (uniform: string, label: string, def = 0): ToggleControl => ({
  type: "toggle",
  uniform,
  label,
  default: def,
});

export const select = (
  uniform: string,
  label: string,
  options: string[],
  def = 0,
): SelectControl => ({ type: "select", uniform, label, options, default: def });

export const color = (uniform: string, label: string, def: string): ColorControl => ({
  type: "color",
  uniform,
  label,
  default: def,
});
