import { useEffect, useRef, useState } from "react";
import { Renderer, setCurrentRenderer } from "../gl/renderer";
import { EFFECT_BY_ID } from "../effects/list";
import { fitToCanvas, useStore } from "../store";
import { applyMods, getBands, hasLfoMods } from "../audio";
import { isRecording } from "../recorder";

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const dirty = useRef(true);
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const loadVideo = useStore((s) => s.loadVideo);
  const compare = useStore((s) => s.compare);
  const setCompare = useStore((s) => s.setCompare);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // init renderer + render loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: Renderer;
    try {
      renderer = new Renderer(canvas);
    } catch (e) {
      setError(String(e));
      return;
    }
    rendererRef.current = renderer;
    setCurrentRenderer(renderer);

    // re-render on any state change; keep animating while an effect uses time
    const unsub = useStore.subscribe(() => {
      dirty.current = true;
    });

    let raf = 0;
    const start = performance.now();
    const loop = () => {
      const { pipeline, source, audioOn, compare } = useStore.getState();
      const live = source?.live === true;
      if (live) {
        renderer.updateSource(source.el);
        dirty.current = true;
      }
      const animated =
        live ||
        audioOn ||
        isRecording() ||
        hasLfoMods(pipeline) ||
        pipeline.some(
          (n) =>
            n.enabled &&
            (EFFECT_BY_ID[n.effectId]?.animated || n.code?.includes("uTime")),
        );
      if (dirty.current || animated) {
        const t = (performance.now() - start) / 1000;
        const frame =
          audioOn || hasLfoMods(pipeline)
            ? applyMods(pipeline, getBands(), t)
            : pipeline;
        try {
          renderer.render(frame, t, compare);
          setError(null);
        } catch (e) {
          setError(String(e));
        }
        dirty.current = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
      setCurrentRenderer(null);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // push source into renderer when it changes
  useEffect(() => {
    if (source && rendererRef.current) {
      rendererRef.current.setSource(source.el, source.w, source.h);
      dirty.current = true;
    }
  }, [source]);

  function loadFile(file: File) {
    if (file.type.startsWith("video/")) {
      loadVideo(file).catch(() => setError("could not play video"));
      return;
    }
    if (!file.type.startsWith("image/")) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const { el, w, h } = fitToCanvas(img, img.naturalWidth, img.naturalHeight);
      setSource(el, w, h, file.name);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("could not load image");
    };
    img.src = url;
  }

  // paste image from clipboard anywhere on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) =>
        i.type.startsWith("image/"),
      );
      const f = item?.getAsFile();
      if (f) loadFile(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dragSplit(e: React.PointerEvent) {
    if (compare === null) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const v = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      setCompare(v);
    };
    move(e.nativeEvent);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      className={`preview ${dragOver ? "drop" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) loadFile(f);
      }}
    >
      <div
        ref={wrapRef}
        className={`canvas-wrap ${compare !== null ? "comparing" : ""}`}
        onPointerDown={dragSplit}
      >
        <canvas id="glcanvas" ref={canvasRef} />
        {compare !== null && (
          <div className="split-handle" style={{ left: `${compare * 100}%` }}>
            <span>⇔</span>
          </div>
        )}
      </div>
      {source && (
        <div className="badge">
          {source.name} · {source.w}×{source.h}
        </div>
      )}
      {dragOver && <div className="dropHint">drop image</div>}
      {error && <pre className="glerror">{error}</pre>}
    </div>
  );
}
