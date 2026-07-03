# cooltools

In-browser image and video effects. Stack lo-fi effects (dither, halftone, ASCII, CRT, glitch, and 30+ more) into a live pipeline, tweak every parameter, drive them with your mic, and export the result. Everything runs client-side in WebGL2, nothing is uploaded anywhere.

Inspired by [tooooools](https://www.tooooools.app).

## Features

### Sources
- **Image**: upload, drag-and-drop onto the canvas, or paste from the clipboard
- **Video file**: drop or upload an .mp4/.webm, it loops live through the pipeline
- **Webcam**: live camera feed
- A procedural sample image loads on start so the canvas is never empty

### Effect pipeline
- 36 effects across Tone, Halftone, Stylize, Color, Distort, Retro, and Custom categories
- Effects chain top to bottom through ping-pong framebuffers (half-float intermediates when supported, to avoid 8-bit banding between passes)
- Per-node: reorder, toggle, remove, reset to defaults
- **Masks**: every node can be limited to a radial or linear region (center, radius/angle, feather, invert), so an effect applies only where you want it

### Custom GLSL node
Add the "Custom GLSL" effect and write your own fragment shader body. Your code must define `vec3 effect(vec2 uv)` and can use:
- `uTexture` (the previous pipeline stage), `uResolution`, `uTime`
- `uA`, `uB`, `uC`: three generic 0..1 sliders
- Prelude helpers: `luma(c)`, `lumAt(uv)`, `hash11(f)`, `hash21(v2)`, `rot(a)`

Compile errors are shown inline and the node falls back to passthrough, so a broken shader never breaks the app. Custom code is included in share links.

### Audio-reactive + LFO modulation
Click "♪ mic" to start mic capture, then click the ♪ button next to any slider to cycle its modulation source:

```
off → level → bass → mid → treble → sine → saw → off
```

- Bands come from an FFT of the mic (fast attack, slow release smoothing)
- `sine`/`saw` are time-based LFOs and need no mic
- The slider position is the floor; modulation pushes the value toward the slider's max:
  `value = base + mod * (max - base)`

### Compare, export, share
- **⇔ compare**: before/after split wipe with a draggable divider
- **↓ png**: download the current frame
- **⧉ copy**: copy the result to the clipboard (pasting an image loads it as a source)
- **● rec**: record the canvas to WebM (30 fps, VP9/VP8), including animated, audio-reactive, and video-source output
- **⟴ share**: the whole pipeline (effects, params, mod links, custom code, masks) is serialized into the URL hash; anyone opening the link gets the exact same look
- **✦ remix**: seeded random effect chain. The `#seed` chip replays or accepts a typed seed, so remixes are reproducible and shareable

### Presets
One-click curated looks (Newsprint, Vaporwave, Blueprint, Comic, Glitch, VHS Tape, ...) rendered as live thumbnails of your actual source image.

### PWA
Installable, with cached build assets for offline use.

## Development

```bash
npm install
npm run dev       # vite dev server
npm run build     # tsc -b + vite build
npm run lint      # oxlint
npm run preview   # serve the production build
```

Stack: React 19, TypeScript, Vite, Zustand, raw WebGL2 (no GL libraries).

## Architecture

```
src/
  gl/renderer.ts        WebGL2 renderer: shader compile/cache, ping-pong FBOs,
                        mask compositing, compare wipe, custom-code programs
  effects/types.ts      Effect/control/pipeline-node type definitions
  effects/list.ts       All effects: GLSL body + control schema per effect
  effects/glyph.ts      Glyph atlas resource for the ASCII effect
  store.ts              Zustand state: pipeline ops, sources (image/video/webcam),
                        seeded remix, URL hash encode/decode
  audio.ts              Mic FFT band analysis + CPU-side param modulation
  recorder.ts           MediaRecorder WebM capture of the canvas
  presets.ts            Curated preset chains
  components/
    Preview.tsx         Canvas, render loop (dirty-flag), drop/paste, split divider
    Sidebar.tsx         Toolbar, pipeline list, effect picker
    Controls.tsx        Per-effect param controls, mod cycling, code editor, mask UI
    PresetThumbs.tsx    Offscreen-rendered preset thumbnails
```

### How an effect works

An effect is a GLSL fragment body plus a schema of controls:

```ts
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
}
```

The renderer auto-declares a uniform for every control, feeds it the current param value each frame, and wraps the body in a standard fragment shader with the shared prelude. Multi-pass effects (blur, low-poly, ...) provide a `passes: string[]` array instead of `glsl`; passes run in order through the ping-pong targets and share the same uniforms. Effects that need one-time GPU resources (e.g. the ASCII glyph atlas) provide a `resources(gl)` factory.

### Render loop

The loop is dirty-flag driven: it re-renders only when state changes, unless something needs continuous animation (live video/webcam source, `uTime`-based effects, active mic/LFO modulation, or recording). Each frame:

1. Live sources re-upload their current frame to the source texture
2. If modulation is active, linked params are rewritten on the CPU (`applyMods`)
3. The chain renders through the ping-pong FBOs; masked nodes snapshot their input first, then composite `mix(input, output, mask)`
4. The result is presented directly, or through the compare-wipe shader when split view is active

### Share-link format

The pipeline is minified to `[{e, on, p, m?, c?, k?}]` (effect id, enabled, params, mods, custom code, mask), JSON-encoded, URI-escaped, and base64'd into `location.hash`. Unknown effect ids are dropped on decode, and missing params fall back to defaults, so old links stay compatible as effects evolve.
