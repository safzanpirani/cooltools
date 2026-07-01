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

function passBodies(effect: Effect): string[] {
  return effect.passes ?? [effect.glsl!];
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
  private programs = new Map<string, Program>();
  private passthrough: Program;
  private srcTex: WebGLTexture | null = null;
  private fbos: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private texs: [WebGLTexture, WebGLTexture] | null = null;
  // half-float intermediates avoid 8-bit quantization between chained passes
  private halfFloat: boolean;
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
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
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
    const fs = this.compileShader(gl.FRAGMENT_SHADER, frag);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("link failed: " + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const resources = effect?.resources ? effect.resources(gl) : null;
    return { prog, locs: new Map(), resources };
  }

  private programFor(effect: Effect, passIdx: number): Program {
    const key = `${effect.id}#${passIdx}`;
    let p = this.programs.get(key);
    if (!p) {
      // one-time resources are owned by pass 0
      p = this.compile(
        buildFrag(effect, passBodies(effect)[passIdx]),
        passIdx === 0 ? effect : null,
      );
      this.programs.set(key, p);
    }
    return p;
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
    }
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.texs![i]);
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos![i]);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.texs![i],
        0,
      );
    }
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
    const p = this.programFor(effect, passIdx);

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

  private blit(tex: WebGLTexture) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.passthrough.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc(this.passthrough, "uTexture"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render(pipeline: PipelineNode[], time: number) {
    if (!this.srcTex) return;
    const active = pipeline.filter((n) => n.enabled && EFFECT_BY_ID[n.effectId]);
    if (active.length === 0) {
      this.blit(this.srcTex);
      return;
    }
    // expand nodes into (node, passIdx) draw calls
    const draws = active.flatMap((node) =>
      passBodies(EFFECT_BY_ID[node.effectId]).map((_, passIdx) => ({ node, passIdx })),
    );
    let read = this.srcTex;
    let w = 0;
    for (let i = 0; i < draws.length; i++) {
      const last = i === draws.length - 1;
      const target = last ? null : this.fbos![w];
      this.pass(draws[i].node, draws[i].passIdx, read, target, time);
      if (!last) {
        read = this.texs![w];
        w = 1 - w;
      }
    }
  }
}
