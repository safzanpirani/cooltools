import type { Effect, EffectResources, PipelineNode } from "../effects/types";
import { EFFECT_BY_ID } from "../effects/list";

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vTexCoord;
void main(){
  vTexCoord = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const PASSTHROUGH = `#version 300 es
precision highp float;
in vec2 vTexCoord;
out vec4 outColor;
uniform sampler2D uTexture;
void main(){ outColor = texture(uTexture, vTexCoord); }`;

// split-wipe: original left of uSplit, effected right, thin divider line
const COMPARE = `#version 300 es
precision highp float;
in vec2 vTexCoord;
out vec4 outColor;
uniform sampler2D uTexture;
uniform sampler2D uOriginal;
uniform float uSplit;
uniform vec2 uResolution;
void main(){
  vec4 c = vTexCoord.x < uSplit
    ? texture(uOriginal, vTexCoord)
    : texture(uTexture, vTexCoord);
  float line = 1.0 - smoothstep(0.0, 1.5 / uResolution.x, abs(vTexCoord.x - uSplit));
  outColor = mix(c, vec4(1.0), line * 0.8);
}`;

// blends node input (uOriginal) with node output (uTexture) by a mask
const MASK_MIX = `#version 300 es
precision highp float;
in vec2 vTexCoord;
out vec4 outColor;
uniform sampler2D uTexture;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float uMaskType, uCx, uCy, uSize, uFeather, uAngle, uInvert;
void main(){
  vec2 uv = vTexCoord;
  float f = max(uFeather, 0.001);
  float m;
  if (uMaskType < 1.5) {
    vec2 p = uv - vec2(uCx, 1.0 - uCy);
    p.x *= uResolution.x / uResolution.y;
    m = 1.0 - smoothstep(uSize - f, uSize + f, length(p));
  } else {
    float a = radians(uAngle);
    float d = dot(uv - vec2(uCx, 1.0 - uCy), vec2(cos(a), sin(a)));
    m = 1.0 - smoothstep(-f, f, d);
  }
  if (uInvert > 0.5) m = 1.0 - m;
  outColor = mix(texture(uOriginal, uv), texture(uTexture, uv), m);
}`;

// shared helpers available to every effect's GLSL
const PRELUDE = `
const vec3 LW = vec3(0.299, 0.587, 0.114);
float luma(vec3 c){ return dot(c, LW); }
float lumAt(vec2 uv){ return luma(texture(uTexture, uv).rgb); }
float hash11(float n){ return fract(sin(n*78.233)*43758.5453); }
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
`;

function passBodies(effect: Effect, code?: string): string[] {
  if (code !== undefined) return [code];
  return effect.passes ?? [effect.glsl!];
}

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// compile errors for custom shader bodies, keyed by code hash
const shaderErrors = new Map<string, string>();
export function getShaderError(code: string): string | null {
  return shaderErrors.get(hashStr(code)) ?? null;
}

function buildFrag(effect: Effect, body: string): string {
  const decls = effect.controls
    .map((c) =>
      c.type === "color"
        ? `uniform vec3 ${c.uniform};`
        : `uniform float ${c.uniform};`,
    )
    .join("\n");
  return `#version 300 es
precision highp float;
in vec2 vTexCoord;
out vec4 outColor;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
${decls}
${PRELUDE}
${body}
void main(){ outColor = vec4(effect(vTexCoord), 1.0); }`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

interface Program {
  prog: WebGLProgram;
  locs: Map<string, WebGLUniformLocation | null>;
  resources: EffectResources | null;
}

// current renderer instance, so UI code (e.g. PNG export) can force a
// synchronous re-render — the canvas is created without preserveDrawingBuffer
let current: Renderer | null = null;
export function getCurrentRenderer(): Renderer | null {
  return current;
}
export function setCurrentRenderer(r: Renderer | null) {
  current = r;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private quadBuffer: WebGLBuffer;
  private programs = new Map<string, Program>();
  private codeProgramKeys = new Set<string>();
  private passthrough: Program;
  private comparer: Program;
  private masker: Program;
  private srcTex: WebGLTexture | null = null;
  private fbos: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private texs: [WebGLTexture, WebGLTexture] | null = null;
  // snapshot of a node's input while its passes run, for mask compositing
  private maskFbo: WebGLFramebuffer | null = null;
  private maskTex: WebGLTexture | null = null;
  // half-float intermediates avoid 8-bit quantization between chained passes
  private halfFloat: boolean;
  private lastFrame: { pipeline: PipelineNode[]; time: number } | null = null;
  private disposed = false;
  width = 0;
  height = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
    this.halfFloat = !!gl.getExtension("EXT_color_buffer_float");

    // fullscreen quad
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.passthrough = this.compile(PASSTHROUGH, null);
    this.comparer = this.compile(COMPARE, null);
    this.masker = this.compile(MASK_MIX, null);
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error("shader compile failed: " + log + "\n" + src);
    }
    return sh;
  }

  private compile(frag: string, effect: Effect | null): Program {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, VERT);
    let fs: WebGLShader | null = null;
    let prog: WebGLProgram | null = null;
    try {
      fs = this.compileShader(gl.FRAGMENT_SHADER, frag);
      prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, "aPos");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error("link failed: " + gl.getProgramInfoLog(prog));
      }
      const resources = effect?.resources ? effect.resources(gl) : null;
      return { prog, locs: new Map(), resources };
    } catch (error) {
      if (prog) gl.deleteProgram(prog);
      throw error;
    } finally {
      gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
    }
  }

  private programKey(effect: Effect, passIdx: number, code?: string): string {
    return code !== undefined
      ? `${effect.id}@${hashStr(code)}#${passIdx}`
      : `${effect.id}#${passIdx}`;
  }

  private deleteProgram(program: Program) {
    for (const texture of program.resources?.textures ?? []) {
      this.gl.deleteTexture(texture.texture);
    }
    this.gl.deleteProgram(program.prog);
  }

  private programFor(effect: Effect, passIdx: number, code?: string): Program {
    const key = this.programKey(effect, passIdx, code);
    let p = this.programs.get(key);
    if (!p) {
      const body = passBodies(effect, code)[passIdx];
      if (code !== undefined) {
        // custom bodies come from user input: fall back to passthrough on
        // compile failure and surface the error instead of killing the loop
        try {
          p = this.compile(buildFrag(effect, body), null);
          shaderErrors.delete(hashStr(code));
        } catch (e) {
          shaderErrors.set(hashStr(code), String(e).split("\n")[0]);
          p = this.compile(
            buildFrag(effect, `vec3 effect(vec2 uv){ return texture(uTexture, uv).rgb; }`),
            null,
          );
        }
      } else {
        // one-time resources are owned by pass 0
        p = this.compile(buildFrag(effect, body), passIdx === 0 ? effect : null);
      }
      this.programs.set(key, p);
      if (code !== undefined) this.codeProgramKeys.add(key);
    }
    return p;
  }

  private releaseUnusedCodePrograms(active: PipelineNode[]) {
    const retained = new Set<string>();
    for (const node of active) {
      if (node.code === undefined) continue;
      const effect = EFFECT_BY_ID[node.effectId];
      const passCount = passBodies(effect, node.code).length;
      for (let passIdx = 0; passIdx < passCount; passIdx++) {
        retained.add(this.programKey(effect, passIdx, node.code));
      }
    }
    for (const key of this.codeProgramKeys) {
      if (retained.has(key)) continue;
      const program = this.programs.get(key);
      if (program) this.deleteProgram(program);
      this.programs.delete(key);
      this.codeProgramKeys.delete(key);
    }
  }

  private loc(p: Program, name: string): WebGLUniformLocation | null {
    if (!p.locs.has(name)) p.locs.set(name, this.gl.getUniformLocation(p.prog, name));
    return p.locs.get(name)!;
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private uploadSrc(img: TexImageSource) {
    const gl = this.gl;
    if (!this.srcTex) this.srcTex = this.makeTex();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  private allocateTargets(w: number, h: number) {
    const gl = this.gl;
    if (!this.fbos) {
      this.fbos = [gl.createFramebuffer()!, gl.createFramebuffer()!];
      this.texs = [this.makeTex(), this.makeTex()];
      this.maskFbo = gl.createFramebuffer();
      this.maskTex = this.makeTex();
    }
    const attach = (fbo: WebGLFramebuffer, tex: WebGLTexture) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        this.halfFloat ? gl.RGBA16F : gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        this.halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    };
    for (let i = 0; i < 2; i++) attach(this.fbos![i], this.texs![i]);
    attach(this.maskFbo!, this.maskTex!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  setSource(img: TexImageSource, w: number, h: number) {
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.gl.canvas.width = w;
      this.gl.canvas.height = h;
      this.allocateTargets(w, h);
    }
    this.uploadSrc(img);
  }

  // re-upload only the source texture (per-frame webcam), dims unchanged
  updateSource(img: TexImageSource) {
    this.uploadSrc(img);
  }

  private pass(
    node: PipelineNode,
    passIdx: number,
    readTex: WebGLTexture,
    target: WebGLFramebuffer | null,
    time: number,
  ) {
    const gl = this.gl;
    const effect = EFFECT_BY_ID[node.effectId];
    const p = this.programFor(effect, passIdx, node.code);

    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(this.loc(p, "uTexture"), 0);
    gl.uniform2f(this.loc(p, "uResolution"), this.width, this.height);
    gl.uniform1f(this.loc(p, "uTime"), time);

    for (const c of effect.controls) {
      const v = node.params[c.uniform];
      if (c.type === "color") {
        const [r, g, b] = hexToRgb(typeof v === "string" ? v : c.default);
        gl.uniform3f(this.loc(p, c.uniform), r, g, b);
      } else {
        gl.uniform1f(this.loc(p, c.uniform), typeof v === "number" ? v : 0);
      }
    }

    if (p.resources) {
      let unit = 1;
      for (const t of p.resources.textures ?? []) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t.texture);
        gl.uniform1i(this.loc(p, t.uniform), unit);
        unit++;
      }
      for (const u of p.resources.uniforms ?? []) {
        gl.uniform1f(this.loc(p, u.name), u.value);
      }
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private blit(tex: WebGLTexture, target: WebGLFramebuffer | null = null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.passthrough.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc(this.passthrough, "uTexture"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // mix node input (maskTex) with node output (read) by the node's mask
  private maskPass(node: PipelineNode, read: WebGLTexture, target: WebGLFramebuffer) {
    const gl = this.gl;
    const p = this.masker;
    const m = node.mask!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read);
    gl.uniform1i(this.loc(p, "uTexture"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex!);
    gl.uniform1i(this.loc(p, "uOriginal"), 1);
    gl.uniform2f(this.loc(p, "uResolution"), this.width, this.height);
    gl.uniform1f(this.loc(p, "uMaskType"), m.type);
    gl.uniform1f(this.loc(p, "uCx"), m.cx);
    gl.uniform1f(this.loc(p, "uCy"), m.cy);
    gl.uniform1f(this.loc(p, "uSize"), m.size);
    gl.uniform1f(this.loc(p, "uFeather"), m.feather);
    gl.uniform1f(this.loc(p, "uAngle"), m.angle);
    gl.uniform1f(this.loc(p, "uInvert"), m.invert);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private comparePass(result: WebGLTexture, split: number) {
    const gl = this.gl;
    const p = this.comparer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, result);
    gl.uniform1i(this.loc(p, "uTexture"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex!);
    gl.uniform1i(this.loc(p, "uOriginal"), 1);
    gl.uniform1f(this.loc(p, "uSplit"), split);
    gl.uniform2f(this.loc(p, "uResolution"), this.width, this.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render(pipeline: PipelineNode[], time: number, split: number | null = null) {
    if (this.disposed || !this.srcTex) return;
    this.lastFrame = { pipeline, time };
    const active = pipeline.filter((n) => n.enabled && EFFECT_BY_ID[n.effectId]);
    this.releaseUnusedCodePrograms(active);
    if (active.length === 0) {
      if (split !== null) this.comparePass(this.srcTex, split);
      else this.blit(this.srcTex);
      return;
    }
    // run the whole chain through the ping-pong targets, then present
    let read: WebGLTexture = this.srcTex;
    let w = 0;
    for (const node of active) {
      const masked = node.mask !== undefined && node.mask.type > 0;
      if (masked) this.blit(read, this.maskFbo);
      const bodies = passBodies(EFFECT_BY_ID[node.effectId], node.code);
      for (let passIdx = 0; passIdx < bodies.length; passIdx++) {
        this.pass(node, passIdx, read, this.fbos![w], time);
        read = this.texs![w];
        w = 1 - w;
      }
      if (masked) {
        this.maskPass(node, read, this.fbos![w]);
        read = this.texs![w];
        w = 1 - w;
      }
    }
    if (split !== null) this.comparePass(read, split);
    else this.blit(read);
  }

  // Redraw the exact effective frame most recently presented. Captures call
  // this synchronously because the canvas does not preserve its draw buffer.
  redrawLastFrame(): boolean {
    if (this.disposed || !this.lastFrame) return false;
    this.render(this.lastFrame.pipeline, this.lastFrame.time, null);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    const deletedTextures = new Set<WebGLTexture>();
    const deleteProgram = (program: Program) => {
      for (const resource of program.resources?.textures ?? []) {
        if (!deletedTextures.has(resource.texture)) {
          gl.deleteTexture(resource.texture);
          deletedTextures.add(resource.texture);
        }
      }
      gl.deleteProgram(program.prog);
    };
    for (const program of this.programs.values()) deleteProgram(program);
    deleteProgram(this.passthrough);
    deleteProgram(this.comparer);
    deleteProgram(this.masker);
    for (const texture of [this.srcTex, ...(this.texs ?? []), this.maskTex]) {
      if (texture && !deletedTextures.has(texture)) {
        gl.deleteTexture(texture);
        deletedTextures.add(texture);
      }
    }
    for (const fbo of [...(this.fbos ?? []), this.maskFbo]) {
      if (fbo) gl.deleteFramebuffer(fbo);
    }
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quadBuffer);
    this.programs.clear();
    this.codeProgramKeys.clear();
    this.lastFrame = null;
    this.srcTex = null;
    this.fbos = null;
    this.texs = null;
    this.maskFbo = null;
    this.maskTex = null;
  }
}
