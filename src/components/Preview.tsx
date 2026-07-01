import { useEffect, useRef, useState } from "react";
import { Renderer, setCurrentRenderer } from "../gl/renderer";
import { EFFECT_BY_ID } from "../effects/list";
import { fitToCanvas, useStore } from "../store";

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const dirty = useRef(true);
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

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
      const { pipeline, source } = useStore.getState();
      const live = source?.live === true;
      if (live) {
        renderer.updateSource(source.el);
        dirty.current = true;
      }
      const animated =
        live ||
        pipeline.some((n) => n.enabled && EFFECT_BY_ID[n.effectId]?.animated);
      if (dirty.current || animated) {
        const t = (performance.now() - start) / 1000;
        try {
          renderer.render(pipeline, t);
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
    if (!file.type.startsWith("image/")) return;
    const img = new Image();
    img.onload = () => {
      const { el, w, h } = fitToCanvas(img, img.naturalWidth, img.naturalHeight);
      setSource(el, w, h, file.name);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
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
      <canvas id="glcanvas" ref={canvasRef} />
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
