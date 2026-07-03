# cooltools — agent instructions

In-browser WebGL2 image/video effects tool. React 19 + TypeScript + Vite + Zustand, raw WebGL2 (no GL libraries, no UI libraries). Everything is client-side; there is no backend.

## Commands

```bash
npm run dev       # vite dev server
npm run build     # tsc -b && vite build  (run this to typecheck)
npm run lint      # oxlint
npm run preview   # serve dist/
```

There is no test suite. Verify changes with `npm run build && npm run lint`, and for renderer/shader work do a browser smoke test (shader errors only surface at runtime compile).

## Layout

- `src/gl/renderer.ts` — the only file that touches WebGL. Shader build/cache, ping-pong FBOs, mask compositing, compare wipe, custom-code program cache with error fallback.
- `src/effects/list.ts` — all effect definitions (GLSL body + control schema). `src/effects/types.ts` has the types and control helper constructors (`slider`, `toggle`, `select`, `color`).
- `src/store.ts` — Zustand store: pipeline ops, sources (image/video/webcam), seeded remix, URL hash encode/decode.
- `src/audio.ts` — mic FFT bands + CPU-side param modulation (`applyMods`).
- `src/recorder.ts` — MediaRecorder WebM capture.
- `src/components/` — Preview (canvas + render loop), Sidebar (toolbar/pipeline/picker), Controls (params, mod cycling, code editor, mask UI), PresetThumbs.

See README.md for the full architecture writeup.

## Adding an effect

Append to `EFFECTS` in `src/effects/list.ts`:
- Define `vec3 effect(vec2 uv)` in the `glsl` body. Available: `uTexture`, `uResolution`, `uTime`, one auto-declared uniform per control (`float`, or `vec3` for color controls), and the PRELUDE helpers (`luma`, `lumAt`, `hash11`, `hash21`, `rot`, `LW`).
- Multi-pass: use `passes: string[]` instead of `glsl`. One-time GPU resources: `resources(gl)` factory (see the ASCII glyph atlas).
- Set `animated: true` if the effect uses `uTime`, otherwise the dirty-flag loop won't keep rendering it.
- UI (picker, controls, uniform upload) is generated from the schema; no component changes needed.

Presets live in `src/presets.ts` and reference effect ids with param overrides.

## Gotchas

- The canvas has **no `preserveDrawingBuffer`**. Any `toBlob`/`toDataURL` must synchronously follow a fresh `renderer.render(...)` (see `exportPNG`, `PresetThumbs`).
- The render loop only redraws when dirty or something is animated (live source, `uTime` effects, mic/LFO mods, recording). If you add a feature that needs continuous frames, extend the `animated` condition in `Preview.tsx`.
- Share URLs encode the pipeline as `[{e, on, p, m?, c?, k?}]` in the hash. Keep decode backward compatible: unknown effect ids are dropped, missing params fall back to defaults. Don't rename effect ids or control uniforms without considering old links.
- Param modulation happens on the CPU each frame (`applyMods`); shaders never see audio data.
- Custom GLSL nodes compile lazily per code hash; compile failures must never throw out of the render loop (fallback passthrough + `getShaderError`).
- `id="glcanvas"` is looked up by Sidebar (export/record) — don't rename it.
- Media sources (webcam stream, video object URLs) must be released via `releaseMedia()` in `store.ts` when replaced.

## Conventions

- Commit style: `vN: short feature summary` (see `git log`).
- Lo-fi terminal aesthetic: lowercase UI labels, JetBrains Mono, colors via CSS vars in `src/index.css`. No CSS frameworks.
- Keep effect GLSL bodies terse; shared logic belongs in the renderer PRELUDE.
- `pnpm-lock.yaml` may exist locally untracked; the repo uses `package-lock.json`.
