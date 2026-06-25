import { type Effect, slider, toggle, color } from "./types";
import { buildGlyphAtlas } from "./glyph";

// shared GLSL helpers available to copy into effects
const LUMA = "const vec3 LW = vec3(0.299, 0.587, 0.114);";

export const EFFECTS: Effect[] = [
  {
    id: "adjust",
    name: "Adjust",
    category: "Tone",
    blurb: "Exposure, contrast, gamma, saturation & hue.",
    controls: [
      slider("uBrightness", "Brightness", -0.5, 0.5, 0.01, 0),
      slider("uContrast", "Contrast", 0, 2, 0.01, 1),
      slider("uGamma", "Gamma", 0.2, 3, 0.01, 1),
      slider("uSaturation", "Saturation", 0, 2, 0.01, 1),
      slider("uHue", "Hue shift", 0, 1, 0.001, 0),
    ],
    glsl: `${LUMA}
    vec3 hueShift(vec3 c, float h){
      const vec3 k = vec3(0.57735);
      float ca = cos(h*6.2831853), sa = sin(h*6.2831853);
      return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
    }
    vec3 effect(vec2 uv){
      vec3 c = texture(uTexture, uv).rgb;
      c = pow(max(c,0.0), vec3(1.0/uGamma));
      c = (c - 0.5) * uContrast + 0.5 + uBrightness;
      float l = dot(c, LW);
      c = mix(vec3(l), c, uSaturation);
      c = hueShift(c, uHue);
      return clamp(c, 0.0, 1.0);
    }`,
  },

  {
    id: "dither",
    name: "Dither",
    category: "Halftone",
    blurb: "Ordered Bayer dithering at any pixel scale.",
    controls: [
      slider("uScale", "Pixel size", 1, 12, 1, 2),
      slider("uLevels", "Levels", 2, 8, 1, 2),
      toggle("uMono", "Monochrome", 0),
    ],
    glsl: `
    float bayer(vec2 p){
      int x = int(mod(p.x, 4.0));
      int y = int(mod(p.y, 4.0));
      float m[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
      return m[x + y*4] / 16.0 - 0.5;
    }
    vec3 effect(vec2 uv){
      vec2 res = uResolution / max(uScale, 1.0);
      vec2 pix = floor(uv * res);
      vec3 c = texture(uTexture, (pix + 0.5) / res).rgb;
      float t = bayer(pix);
      float n = max(uLevels, 2.0) - 1.0;
      if (uMono > 0.5){
        float g = dot(c, vec3(0.299,0.587,0.114));
        return vec3(clamp(floor(g*n + t + 0.5)/n, 0.0, 1.0));
      }
      return clamp(floor(c*n + t + 0.5)/n, 0.0, 1.0);
    }`,
  },

  {
    id: "halftone",
    name: "Halftone",
    category: "Halftone",
    blurb: "Classic print dots with adjustable cell & screen angle.",
    controls: [
      slider("uCell", "Cell size", 3, 30, 1, 8),
      slider("uAngle", "Screen angle", 0, 90, 1, 15),
      toggle("uInvert", "Invert", 0),
      color("uFg", "Ink", "#0a0a0a"),
      color("uBg", "Paper", "#f4f1ea"),
    ],
    glsl: `
    mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
    vec3 effect(vec2 uv){
      vec2 px = uv * uResolution;
      float a = radians(uAngle);
      vec2 rp = rot(a) * px;
      vec2 g = floor(rp/uCell)*uCell + uCell*0.5;
      vec2 sp = (rot(-a) * g) / uResolution;
      float lum = dot(texture(uTexture, sp).rgb, vec3(0.299,0.587,0.114));
      if (uInvert > 0.5) lum = 1.0 - lum;
      float d = length(rp - g) / (uCell * 0.5);
      float r = sqrt(clamp(1.0 - lum, 0.0, 1.0));
      float dot = smoothstep(r + 0.06, r - 0.06, d);
      return mix(uBg, uFg, dot);
    }`,
  },

  {
    id: "ascii",
    name: "ASCII",
    category: "Halftone",
    blurb: "Maps brightness to a monospace glyph ramp.",
    controls: [
      slider("uCell", "Cell size", 4, 18, 1, 8),
      toggle("uColor", "Keep color", 0),
      toggle("uInvert", "Invert", 0),
      color("uInk", "Mono ink", "#5cff7a"),
    ],
    glsl: `
    uniform sampler2D uGlyph;
    uniform float uGlyphCount;
    vec3 effect(vec2 uv){
      vec2 cells = uResolution / uCell;
      vec2 cell = floor(uv * cells);
      vec2 center = (cell + 0.5) / cells;
      vec3 src = texture(uTexture, center).rgb;
      float lum = dot(src, vec3(0.299,0.587,0.114));
      if (uInvert > 0.5) lum = 1.0 - lum;
      float gi = floor(clamp(1.0 - lum, 0.0, 0.999) * uGlyphCount);
      vec2 local = fract(uv * cells);
      float g = texture(uGlyph, vec2((gi + local.x)/uGlyphCount, local.y)).r;
      vec3 ink = uColor > 0.5 ? src : uInk;
      return ink * g;
    }`,
    resources: (gl) => {
      const atlas = buildGlyphAtlas(gl);
      return {
        textures: [{ uniform: "uGlyph", texture: atlas.texture }],
        uniforms: [{ name: "uGlyphCount", value: atlas.count }],
      };
    },
  },

  {
    id: "pixelate",
    name: "Pixelate",
    category: "Pixel",
    blurb: "Hard mosaic blocks.",
    controls: [slider("uSize", "Block size", 1, 64, 1, 8)],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 d = max(uSize, 1.0) / uResolution;
      return texture(uTexture, (floor(uv/d) + 0.5) * d).rgb;
    }`,
  },

  {
    id: "posterize",
    name: "Posterize",
    category: "Color",
    blurb: "Crush tones to N levels, optional duotone map.",
    controls: [
      slider("uLevels", "Levels", 2, 16, 1, 4),
      toggle("uDuotone", "Duotone", 0),
      color("uDark", "Shadows", "#1a1030"),
      color("uLight", "Highlights", "#ff5e7a"),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec3 c = texture(uTexture, uv).rgb;
      float n = max(uLevels, 2.0);
      if (uDuotone > 0.5){
        float g = dot(c, vec3(0.299,0.587,0.114));
        g = floor(g * n) / (n - 1.0);
        return mix(uDark, uLight, clamp(g, 0.0, 1.0));
      }
      return floor(c * n) / (n - 1.0);
    }`,
  },

  {
    id: "chromatic",
    name: "Chromatic",
    category: "Glitch",
    blurb: "RGB channel split — linear or radial.",
    controls: [
      slider("uAmount", "Amount", 0, 40, 0.5, 8),
      slider("uAngle", "Angle", 0, 1, 0.001, 0),
      toggle("uRadial", "Radial", 0),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 dir = uRadial > 0.5 ? (uv - 0.5) : vec2(cos(uAngle*6.2831853), sin(uAngle*6.2831853));
      vec2 o = dir * (uAmount / uResolution);
      return vec3(
        texture(uTexture, uv + o).r,
        texture(uTexture, uv).g,
        texture(uTexture, uv - o).b
      );
    }`,
  },

  {
    id: "crt",
    name: "CRT",
    category: "Glitch",
    blurb: "Scanlines, screen curvature, bleed & vignette.",
    controls: [
      slider("uScan", "Scanlines", 0, 1, 0.01, 0.4),
      slider("uCurve", "Curvature", 0, 1, 0.01, 0.25),
      slider("uBleed", "Color bleed", 0, 10, 0.1, 2),
      slider("uVignette", "Vignette", 0, 1.5, 0.01, 0.6),
      toggle("uFlicker", "Flicker", 1),
    ],
    glsl: `
    vec2 curve(vec2 uv, float k){
      uv = uv*2.0 - 1.0;
      uv *= 1.0 + k*0.3*dot(uv, uv);
      return uv*0.5 + 0.5;
    }
    vec3 effect(vec2 uv){
      vec2 c = curve(uv, uCurve);
      if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) return vec3(0.0);
      vec2 o = vec2(uBleed / uResolution.x, 0.0);
      vec3 col = vec3(texture(uTexture, c+o).r, texture(uTexture, c).g, texture(uTexture, c-o).b);
      float scan = sin(c.y * uResolution.y * 3.14159) * 0.5 + 0.5;
      col *= 1.0 - uScan * scan;
      float vig = 1.0 - uVignette * dot(uv-0.5, uv-0.5) * 2.0;
      col *= clamp(vig, 0.0, 1.0);
      if (uFlicker > 0.5) col *= 0.96 + 0.04 * sin(uTime * 9.0);
      return col;
    }`,
  },

  {
    id: "edge",
    name: "Edge",
    category: "Stylize",
    blurb: "Sobel edge detection — ink lines on paper.",
    controls: [
      slider("uStrength", "Strength", 0.2, 6, 0.1, 2),
      toggle("uInvert", "Invert", 0),
      color("uLine", "Line", "#000000"),
      color("uPaper", "Paper", "#ffffff"),
    ],
    glsl: `
    float lum(vec2 uv){ return dot(texture(uTexture, uv).rgb, vec3(0.299,0.587,0.114)); }
    vec3 effect(vec2 uv){
      vec2 t = 1.0 / uResolution;
      float tl=lum(uv+t*vec2(-1,-1)), l=lum(uv+t*vec2(-1,0)), bl=lum(uv+t*vec2(-1,1));
      float tr=lum(uv+t*vec2(1,-1)),  r=lum(uv+t*vec2(1,0)),  br=lum(uv+t*vec2(1,1));
      float tm=lum(uv+t*vec2(0,-1)),  bm=lum(uv+t*vec2(0,1));
      float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
      float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
      float e = clamp(length(vec2(gx,gy)) * uStrength, 0.0, 1.0);
      if (uInvert > 0.5) e = 1.0 - e;
      return mix(uPaper, uLine, e);
    }`,
  },

  {
    id: "bloom",
    name: "Bloom",
    category: "Stylize",
    blurb: "Soft glow lifted from the highlights.",
    controls: [
      slider("uThreshold", "Threshold", 0, 1, 0.01, 0.6),
      slider("uRadius", "Radius", 1, 12, 0.5, 4),
      slider("uIntensity", "Intensity", 0, 3, 0.01, 1.2),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec3 base = texture(uTexture, uv).rgb;
      vec2 t = uRadius / uResolution;
      vec3 sum = vec3(0.0);
      float wsum = 0.0;
      for (int x=-2; x<=2; x++){
        for (int y=-2; y<=2; y++){
          float w = 1.0 / (1.0 + float(x*x + y*y));
          vec3 s = texture(uTexture, uv + t*vec2(float(x), float(y))).rgb;
          float b = max(dot(s, vec3(0.299,0.587,0.114)) - uThreshold, 0.0);
          sum += s * b * w;
          wsum += w;
        }
      }
      return clamp(base + sum / wsum * uIntensity, 0.0, 1.0);
    }`,
  },

  {
    id: "wave",
    name: "Wave",
    category: "Distort",
    blurb: "Sinusoidal ripple displacement.",
    controls: [
      slider("uAmp", "Amplitude", 0, 0.1, 0.001, 0.02),
      slider("uFreq", "Frequency", 1, 60, 0.5, 18),
      slider("uSpeed", "Speed", 0, 4, 0.01, 1),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      uv.x += sin(uv.y * uFreq + uTime * uSpeed) * uAmp;
      uv.y += cos(uv.x * uFreq + uTime * uSpeed) * uAmp;
      return texture(uTexture, clamp(uv, 0.0, 1.0)).rgb;
    }`,
  },

  {
    id: "scatter",
    name: "Scatter",
    category: "Glitch",
    blurb: "Horizontal slice displacement / data-mosh bands.",
    controls: [
      slider("uBands", "Bands", 4, 120, 1, 32),
      slider("uShift", "Shift", 0, 0.3, 0.001, 0.05),
      slider("uSpeed", "Speed", 0, 5, 0.01, 1),
    ],
    glsl: `
    float hash(float n){ return fract(sin(n*78.233)*43758.5453); }
    vec3 effect(vec2 uv){
      float band = floor(uv.y * uBands);
      float seed = hash(band + floor(uTime * uSpeed));
      float amt = (seed - 0.5) * 2.0 * uShift * step(0.6, seed);
      return texture(uTexture, vec2(fract(uv.x + amt), uv.y)).rgb;
    }`,
  },
];

export const EFFECT_BY_ID: Record<string, Effect> = Object.fromEntries(
  EFFECTS.map((e) => [e.id, e]),
);

export const CATEGORIES = [...new Set(EFFECTS.map((e) => e.category))];
