import { type Effect, slider, toggle, color } from "./types";
import { buildGlyphAtlas } from "./glyph";

// Shared helpers (LW, luma, lumAt, hash11, hash21, rot) are injected into
// every effect's shader by the renderer — see PRELUDE in gl/renderer.ts.

const blur1D = (dir: string) => `
    vec3 effect(vec2 uv){
      vec2 t = ${dir} * (uRadius / uResolution) / 6.0;
      vec3 sum = vec3(0.0); float wsum = 0.0;
      for (int i = -6; i <= 6; i++){
        float w = exp(-float(i*i) / 18.0);
        sum += texture(uTexture, uv + t * float(i)).rgb * w;
        wsum += w;
      }
      return sum / wsum;
    }`;

// starter body for the custom shader node — editable per pipeline node
export const CUSTOM_DEFAULT = `vec3 effect(vec2 uv){
  // uA, uB, uC sliders (0..1) · uTime · uResolution · uTexture
  // helpers: luma(c), lumAt(uv), hash11(f), hash21(v2), rot(a)
  vec2 p = uv - 0.5;
  p *= rot(uA * 6.2831);
  vec3 c = texture(uTexture, p + 0.5).rgb;
  c = mix(c, c.bgr, uB);
  return c * (1.0 - uC * length(p) * 2.0);
}`;

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
    glsl: `
    vec3 hueShift(vec3 c, float h){
      const vec3 k = vec3(0.57735);
      float ca = cos(h*6.2831853), sa = sin(h*6.2831853);
      return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
    }
    vec3 effect(vec2 uv){
      vec3 c = texture(uTexture, uv).rgb;
      c = pow(max(c,0.0), vec3(1.0/uGamma));
      c = (c - 0.5) * uContrast + 0.5 + uBrightness;
      c = mix(vec3(luma(c)), c, uSaturation);
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
        float g = luma(c);
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
    vec3 effect(vec2 uv){
      vec2 px = uv * uResolution;
      float a = radians(uAngle);
      vec2 rp = rot(a) * px;
      vec2 g = floor(rp/uCell)*uCell + uCell*0.5;
      vec2 sp = (rot(-a) * g) / uResolution;
      float lum = lumAt(sp);
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
      float lum = luma(src);
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
        float g = floor(luma(c) * n) / (n - 1.0);
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
    animated: true,
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
    vec3 effect(vec2 uv){
      vec2 t = 1.0 / uResolution;
      float tl=lumAt(uv+t*vec2(-1,-1)), l=lumAt(uv+t*vec2(-1,0)), bl=lumAt(uv+t*vec2(-1,1));
      float tr=lumAt(uv+t*vec2(1,-1)),  r=lumAt(uv+t*vec2(1,0)),  br=lumAt(uv+t*vec2(1,1));
      float tm=lumAt(uv+t*vec2(0,-1)),  bm=lumAt(uv+t*vec2(0,1));
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
          float b = max(luma(s) - uThreshold, 0.0);
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
    animated: true,
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
    animated: true,
    controls: [
      slider("uBands", "Bands", 4, 120, 1, 32),
      slider("uShift", "Shift", 0, 0.3, 0.001, 0.05),
      slider("uSpeed", "Speed", 0, 5, 0.01, 1),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      float band = floor(uv.y * uBands);
      float seed = hash11(band + floor(uTime * uSpeed));
      float amt = (seed - 0.5) * 2.0 * uShift * step(0.6, seed);
      return texture(uTexture, vec2(fract(uv.x + amt), uv.y)).rgb;
    }`,
  },

  {
    id: "kuwahara",
    name: "Kuwahara",
    category: "Stylize",
    blurb: "Edge-preserving oil-paint smear.",
    controls: [slider("uRadius", "Radius", 1, 8, 1, 4)],
    // fixed 4x4 grid per quadrant (64 taps total) with spacing scaled by
    // uRadius — constant cost, no dynamic loop bounds
    glsl: `
    vec3 effect(vec2 uv){
      vec2 px = uRadius / (3.0 * uResolution);
      vec3 best = texture(uTexture, uv).rgb;
      float bestVar = 1e9;
      for (int q = 0; q < 4; q++){
        vec2 sgn = vec2((q == 0 || q == 2) ? -1.0 : 1.0, (q < 2) ? -1.0 : 1.0);
        vec3 sum = vec3(0.0); float sum2 = 0.0;
        for (int i = 0; i <= 3; i++){
          for (int j = 0; j <= 3; j++){
            vec3 c = texture(uTexture, uv + vec2(float(i)*sgn.x, float(j)*sgn.y) * px).rgb;
            sum += c; sum2 += dot(c, c);
          }
        }
        vec3 m = sum / 16.0;
        float v = sum2 / 16.0 - dot(m, m);
        if (v < bestVar){ bestVar = v; best = m; }
      }
      return best;
    }`,
  },

  {
    id: "stipple",
    name: "Stipple",
    category: "Halftone",
    blurb: "Pen-plotter dots, density follows darkness.",
    controls: [
      slider("uCell", "Spacing", 2, 16, 1, 6),
      slider("uSize", "Dot size", 0.2, 1.6, 0.05, 0.9),
      slider("uJitter", "Jitter", 0, 1, 0.01, 0.6),
      color("uInk", "Ink", "#101010"),
      color("uPaper", "Paper", "#f6f4ee"),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 cells = uResolution / uCell;
      vec2 cell = floor(uv * cells);
      float lum = lumAt((cell + 0.5)/cells);
      vec2 j = (vec2(hash21(cell), hash21(cell + 7.3)) - 0.5) * uJitter;
      vec2 dotc = (cell + 0.5 + j) / cells;
      float d = length((uv - dotc) * cells);
      float radius = sqrt(clamp(1.0 - lum, 0.0, 1.0)) * 0.5 * uSize;
      float dot = smoothstep(radius, radius - 0.12, d);
      return mix(uPaper, uInk, dot);
    }`,
  },

  {
    id: "lowpoly",
    name: "Low-poly",
    category: "Geometric",
    blurb: "Triangular-lattice flat shading.",
    controls: [
      slider("uSize", "Facet size", 8, 90, 1, 28),
      slider("uEdge", "Edge", 0, 1, 0.01, 0),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 cells = uResolution / uSize;
      vec2 p = uv * cells;
      vec2 cell = floor(p);
      vec2 f = fract(p);
      vec2 cen = f.x + f.y < 1.0
        ? cell + vec2(1.0/3.0, 1.0/3.0)
        : cell + vec2(2.0/3.0, 2.0/3.0);
      vec3 c = texture(uTexture, cen / cells).rgb;
      float edge = min(min(f.x, f.y), abs(f.x + f.y - 1.0));
      c *= 1.0 - uEdge * (1.0 - smoothstep(0.0, 0.06, edge));
      return c;
    }`,
  },

  {
    id: "voronoi",
    name: "Voronoi",
    category: "Geometric",
    blurb: "Crystallised stained-glass cells.",
    controls: [
      slider("uScale", "Cell size", 6, 70, 1, 26),
      slider("uEdge", "Leading", 0, 1, 0.01, 0.4),
    ],
    glsl: `
    vec2 h2(vec2 p){ return vec2(hash21(p), hash21(p + 19.19)); }
    vec3 effect(vec2 uv){
      vec2 cells = uResolution / uScale;
      vec2 p = uv * cells;
      vec2 g = floor(p); vec2 f = fract(p);
      float md1 = 1e9, md2 = 1e9; vec2 best = g;
      for (int y = -1; y <= 1; y++){
        for (int x = -1; x <= 1; x++){
          vec2 o = vec2(float(x), float(y));
          vec2 fp = o + h2(g + o);
          float d = length(fp - f);
          if (d < md1){ md2 = md1; md1 = d; best = g + o + h2(g + o); }
          else if (d < md2){ md2 = d; }
        }
      }
      vec3 c = texture(uTexture, best / cells).rgb;
      float line = smoothstep(0.0, uEdge * 0.16 + 0.001, md2 - md1);
      return c * mix(1.0, line, step(0.001, uEdge));
    }`,
  },

  {
    id: "crosshatch",
    name: "Crosshatch",
    category: "Stylize",
    blurb: "Pen-and-ink hatching by tone.",
    controls: [
      slider("uDensity", "Spacing", 3, 16, 0.5, 7),
      slider("uStrength", "Strength", 0.2, 2, 0.05, 1.1),
      color("uInk", "Ink", "#0c0c10"),
      color("uPaper", "Paper", "#fbfaf5"),
    ],
    glsl: `
    float hatch(vec2 px, float a, float sp){
      float v = px.x * cos(a) + px.y * sin(a);
      return abs(fract(v / sp) - 0.5) * 2.0;
    }
    vec3 effect(vec2 uv){
      vec2 px = uv * uResolution;
      float lum = clamp(lumAt(uv), 0.0, 1.0);
      float sp = uDensity;
      float ink = 0.0;
      if (lum < 0.85) ink = max(ink, 1.0 - smoothstep(0.0, 0.45, hatch(px, 0.785, sp)));
      if (lum < 0.62) ink = max(ink, 1.0 - smoothstep(0.0, 0.45, hatch(px, -0.785, sp)));
      if (lum < 0.42) ink = max(ink, 1.0 - smoothstep(0.0, 0.45, hatch(px, 0.0, sp)));
      if (lum < 0.22) ink = max(ink, 1.0 - smoothstep(0.0, 0.45, hatch(px, 1.5708, sp)));
      return mix(uPaper, uInk, clamp(ink * uStrength, 0.0, 1.0));
    }`,
  },

  {
    id: "kaleidoscope",
    name: "Kaleidoscope",
    category: "Distort",
    blurb: "Radial mirror symmetry.",
    controls: [
      slider("uSegments", "Segments", 3, 16, 1, 6),
      slider("uSpin", "Rotate", 0, 1, 0.001, 0),
      slider("uZoom", "Zoom", 0.4, 2.5, 0.01, 1),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 p = uv - 0.5;
      float r = length(p);
      float a = atan(p.y, p.x) + uSpin * 6.2831853;
      float seg = 6.2831853 / uSegments;
      a = mod(a, seg);
      a = abs(a - seg * 0.5);
      vec2 q = vec2(cos(a), sin(a)) * r * uZoom + 0.5;
      return texture(uTexture, clamp(q, 0.0, 1.0)).rgb;
    }`,
  },

  {
    id: "gradientmap",
    name: "Gradient Map",
    category: "Color",
    blurb: "Remap luminance through a 3-stop gradient.",
    controls: [
      color("uShadow", "Shadows", "#0b0033"),
      color("uMid", "Mids", "#ff2e88"),
      color("uHigh", "Highlights", "#ffe34d"),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      float l = lumAt(uv);
      return l < 0.5 ? mix(uShadow, uMid, l*2.0) : mix(uMid, uHigh, (l-0.5)*2.0);
    }`,
  },

  {
    id: "threshold",
    name: "Threshold",
    category: "Color",
    blurb: "Hard two-tone cut with a soft knee.",
    controls: [
      slider("uThreshold", "Threshold", 0, 1, 0.01, 0.5),
      slider("uKnee", "Softness", 0, 0.3, 0.005, 0.02),
      color("uDark", "Dark", "#0a0a12"),
      color("uLight", "Light", "#ffffff"),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      float l = lumAt(uv);
      return mix(uDark, uLight, smoothstep(uThreshold - uKnee, uThreshold + uKnee, l));
    }`,
  },

  {
    id: "solarize",
    name: "Solarize",
    category: "Color",
    blurb: "Sabattier — invert tones above a threshold.",
    controls: [slider("uThreshold", "Threshold", 0, 1, 0.01, 0.5)],
    glsl: `
    vec3 effect(vec2 uv){
      vec3 c = texture(uTexture, uv).rgb;
      return mix(c, 1.0 - c, step(vec3(uThreshold), c));
    }`,
  },

  {
    id: "sharpen",
    name: "Sharpen",
    category: "Tone",
    blurb: "Unsharp-mask crispening.",
    controls: [slider("uAmount", "Amount", 0, 3, 0.05, 1)],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 t = 1.0 / uResolution;
      vec3 c = texture(uTexture, uv).rgb;
      vec3 b = (texture(uTexture, uv+t*vec2(1,0)).rgb + texture(uTexture, uv+t*vec2(-1,0)).rgb
              + texture(uTexture, uv+t*vec2(0,1)).rgb + texture(uTexture, uv+t*vec2(0,-1)).rgb) * 0.25;
      return clamp(c + (c - b) * uAmount, 0.0, 1.0);
    }`,
  },

  {
    id: "neon",
    name: "Neon",
    category: "Stylize",
    blurb: "Glowing edge lines on a dark field.",
    controls: [
      slider("uStrength", "Edge", 1, 8, 0.1, 3),
      slider("uGlow", "Glow", 0, 3, 0.05, 1.3),
      color("uColor", "Glow color", "#19f0ff"),
      color("uBg", "Background", "#05060a"),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 t = 1.0 / uResolution;
      float tl=lumAt(uv+t*vec2(-1,-1)), l=lumAt(uv+t*vec2(-1,0)), bl=lumAt(uv+t*vec2(-1,1));
      float tr=lumAt(uv+t*vec2(1,-1)),  r=lumAt(uv+t*vec2(1,0)),  br=lumAt(uv+t*vec2(1,1));
      float tm=lumAt(uv+t*vec2(0,-1)),  bm=lumAt(uv+t*vec2(0,1));
      float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
      float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
      float e = clamp(length(vec2(gx,gy)) * uStrength, 0.0, 1.0);
      return uBg + uColor * pow(e, 1.4) * uGlow;
    }`,
  },

  {
    id: "sketch",
    name: "Sketch",
    category: "Stylize",
    blurb: "Pencil sketch via color-dodge.",
    controls: [slider("uRadius", "Stroke", 0, 6, 0.5, 2)],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 t = (1.0 + uRadius) / uResolution;
      float g = lumAt(uv);
      float inv = 0.0; float w = 0.0;
      for (int x=-2; x<=2; x++){
        for (int y=-2; y<=2; y++){
          inv += 1.0 - lumAt(uv + t*vec2(float(x),float(y)));
          w += 1.0;
        }
      }
      inv /= w;
      float dodge = inv >= 1.0 ? 1.0 : min(1.0, g / (1.0 - inv));
      return vec3(dodge);
    }`,
  },

  {
    id: "emboss",
    name: "Emboss",
    category: "Stylize",
    blurb: "Directional relief.",
    controls: [
      slider("uStrength", "Depth", 1, 6, 0.1, 2),
      slider("uAngle", "Angle", 0, 1, 0.001, 0.125),
      toggle("uGray", "Grayscale", 1),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 dir = vec2(cos(uAngle*6.2831853), sin(uAngle*6.2831853)) / uResolution * (1.0 + uStrength);
      vec3 e = (texture(uTexture, uv+dir).rgb - texture(uTexture, uv-dir).rgb) + 0.5;
      if (uGray > 0.5) return vec3(luma(e));
      return e;
    }`,
  },

  {
    id: "cmyk",
    name: "Color Halftone",
    category: "Halftone",
    blurb: "CMYK angled dot screens — true print color.",
    controls: [slider("uCell", "Cell size", 3, 24, 0.5, 7)],
    glsl: `
    float screen(vec2 uv, float angle, float value){
      vec2 px = uv * uResolution;
      vec2 rp = rot(radians(angle)) * px;
      vec2 g = floor(rp/uCell)*uCell + uCell*0.5;
      float d = length(rp - g) / (uCell * 0.5);
      float r = sqrt(clamp(value, 0.0, 1.0));
      return smoothstep(r + 0.05, r - 0.05, d);
    }
    vec3 effect(vec2 uv){
      vec3 rgb = texture(uTexture, uv).rgb;
      float k = 1.0 - max(max(rgb.r, rgb.g), rgb.b);
      float ik = max(1.0 - k, 0.001);
      float c = (1.0 - rgb.r - k) / ik;
      float m = (1.0 - rgb.g - k) / ik;
      float y = (1.0 - rgb.b - k) / ik;
      vec3 col = vec3(1.0);
      col -= vec3(1.0,0.0,0.0) * screen(uv, 15.0, c);
      col -= vec3(0.0,1.0,0.0) * screen(uv, 75.0, m);
      col -= vec3(0.0,0.0,1.0) * screen(uv, 0.0,  y);
      col -= vec3(1.0)         * screen(uv, 45.0, k);
      return clamp(col, 0.0, 1.0);
    }`,
  },

  {
    id: "film",
    name: "Film",
    category: "Stylize",
    blurb: "Animated grain, warm grade & vignette.",
    animated: true,
    controls: [
      slider("uGrain", "Grain", 0, 1, 0.01, 0.4),
      slider("uVignette", "Vignette", 0, 1.5, 0.01, 0.6),
      slider("uWarm", "Warmth", 0, 1, 0.01, 0.3),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec3 c = texture(uTexture, uv).rgb;
      float g = hash21(uv * uResolution + fract(uTime) * 431.0);
      c += (g - 0.5) * uGrain * 0.5;
      c += vec3(uWarm * 0.06, 0.0, -uWarm * 0.04);
      c *= clamp(1.0 - uVignette * dot(uv - 0.5, uv - 0.5) * 2.0, 0.0, 1.0);
      return clamp(c, 0.0, 1.0);
    }`,
  },

  {
    id: "swirl",
    name: "Swirl",
    category: "Distort",
    blurb: "Twist the image around its center.",
    controls: [
      slider("uAmount", "Twist", -10, 10, 0.1, 3),
      slider("uRadius", "Radius", 0.1, 1, 0.01, 0.5),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
      vec2 p = (uv - 0.5) * asp;
      float r = length(p);
      float falloff = smoothstep(uRadius, 0.0, r);
      float a = atan(p.y, p.x) + uAmount * falloff;
      vec2 q = vec2(cos(a), sin(a)) * r / asp + 0.5;
      return texture(uTexture, clamp(q, 0.0, 1.0)).rgb;
    }`,
  },

  {
    id: "fisheye",
    name: "Fisheye",
    category: "Distort",
    blurb: "Barrel / pincushion lens bulge.",
    controls: [slider("uAmount", "Bulge", -1, 1, 0.01, 0.5)],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 p = uv * 2.0 - 1.0;
      float r = length(p);
      float k = 1.0 + uAmount * r * r;
      vec2 q = p / k * (1.0 + uAmount) * 0.5 + 0.5;
      if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec3(0.0);
      return texture(uTexture, q).rgb;
    }`,
  },

  {
    id: "mirror",
    name: "Mirror",
    category: "Geometric",
    blurb: "Reflect across a movable axis.",
    controls: [
      slider("uPos", "Axis position", 0, 1, 0.005, 0.5),
      toggle("uVertical", "Vertical axis", 1),
      toggle("uFlip", "Flip side", 0),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      float t = uVertical > 0.5 ? uv.x : uv.y;
      bool second = uFlip > 0.5 ? t < uPos : t > uPos;
      if (second) t = 2.0 * uPos - t;
      t = clamp(t, 0.0, 1.0);
      vec2 q = uVertical > 0.5 ? vec2(t, uv.y) : vec2(uv.x, t);
      return texture(uTexture, q).rgb;
    }`,
  },

  {
    id: "hexpixel",
    name: "Hex Pixel",
    category: "Pixel",
    blurb: "Mosaic of hexagonal tiles.",
    controls: [
      slider("uSize", "Hex size", 4, 60, 1, 16),
      slider("uEdge", "Grout", 0, 1, 0.01, 0),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      vec2 px = uv * uResolution / uSize;
      vec2 s = vec2(1.0, 1.7320508);
      vec2 a = mod(px, s) - s * 0.5;
      vec2 b = mod(px - s * 0.5, s) - s * 0.5;
      vec2 gv = dot(a, a) < dot(b, b) ? a : b;
      vec2 cen = (px - gv) * uSize / uResolution;
      vec3 c = texture(uTexture, clamp(cen, 0.0, 1.0)).rgb;
      float d = max(abs(gv.x), dot(abs(gv), normalize(vec2(1.0, 1.7320508))));
      c *= 1.0 - uEdge * smoothstep(0.42, 0.5, d);
      return c;
    }`,
  },

  {
    id: "thermal",
    name: "Thermal",
    category: "Color",
    blurb: "False-color infrared-camera palette.",
    controls: [
      slider("uGain", "Gain", 0.5, 2, 0.01, 1),
      toggle("uBands", "Banding", 0),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      float l = clamp(lumAt(uv) * uGain, 0.0, 1.0);
      if (uBands > 0.5) l = floor(l * 8.0) / 7.0;
      vec3 c = l < 0.25 ? mix(vec3(0.0,0.0,0.2), vec3(0.1,0.0,0.6), l*4.0)
             : l < 0.5  ? mix(vec3(0.1,0.0,0.6), vec3(0.9,0.1,0.2), (l-0.25)*4.0)
             : l < 0.75 ? mix(vec3(0.9,0.1,0.2), vec3(1.0,0.7,0.0), (l-0.5)*4.0)
                        : mix(vec3(1.0,0.7,0.0), vec3(1.0,1.0,0.9), (l-0.75)*4.0);
      return c;
    }`,
  },

  {
    id: "blur",
    name: "Blur",
    category: "Tone",
    blurb: "Soft gaussian blur (separable two-pass).",
    controls: [slider("uRadius", "Radius", 0, 16, 0.5, 4)],
    passes: [blur1D("vec2(1.0, 0.0)"), blur1D("vec2(0.0, 1.0)")],
  },

  {
    id: "vhs",
    name: "VHS",
    category: "Glitch",
    blurb: "Tape wobble, tracking noise & chroma smear.",
    animated: true,
    controls: [
      slider("uWobble", "Wobble", 0, 1, 0.01, 0.3),
      slider("uNoise", "Tracking noise", 0, 1, 0.01, 0.35),
      slider("uSmear", "Chroma smear", 0, 8, 0.1, 2.5),
    ],
    glsl: `
    vec3 effect(vec2 uv){
      float wob = sin(uv.y * 320.0 + uTime * 12.0) * 0.0012 * uWobble
                + sin(uv.y * 7.0 + uTime * 2.3) * 0.003 * uWobble;
      vec2 p = vec2(uv.x + wob, uv.y);
      vec2 o = vec2(uSmear / uResolution.x, 0.0);
      vec3 c = vec3(texture(uTexture, p + o).r, texture(uTexture, p).g, texture(uTexture, p - o).b);
      float band = step(0.985, hash21(vec2(floor(uv.y * 240.0), floor(uTime * 14.0))));
      float n = hash21(uv * uResolution + fract(uTime) * 913.0);
      c = mix(c, vec3(n), band * uNoise);
      c += (n - 0.5) * 0.06 * uNoise;
      float head = smoothstep(0.06, 0.0, uv.y) * uNoise;
      c = mix(c, vec3(hash21(vec2(uv.x * 90.0, uTime * 20.0))), head * 0.6);
      return clamp(c, 0.0, 1.0);
    }`,
  },

  {
    id: "invert",
    name: "Invert",
    category: "Color",
    blurb: "Negative, with a mix amount.",
    controls: [slider("uAmount", "Amount", 0, 1, 0.01, 1)],
    glsl: `
    vec3 effect(vec2 uv){
      vec3 c = texture(uTexture, uv).rgb;
      return mix(c, 1.0 - c, uAmount);
    }`,
  },

  {
    id: "custom",
    name: "Custom GLSL",
    category: "Custom",
    blurb: "Write your own effect(uv) — uA/uB/uC sliders, uTime, PRELUDE helpers.",
    controls: [
      slider("uA", "uA", 0, 1, 0.01, 0.5),
      slider("uB", "uB", 0, 1, 0.01, 0.5),
      slider("uC", "uC", 0, 1, 0.01, 0.5),
    ],
    glsl: CUSTOM_DEFAULT,
  },
];

export const EFFECT_BY_ID: Record<string, Effect> = Object.fromEntries(
  EFFECTS.map((e) => [e.id, e]),
);

export const CATEGORIES = [...new Set(EFFECTS.map((e) => e.category))];
