import { useEffect, useRef, useState } from "react";
import { Renderer } from "../gl/renderer";
import { fitToCanvas, useStore } from "../store";

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
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

    let raf = 0;
    const start = performance.now();
    const loop = () => {
      const t = (performance.now() - start) / 1000;
      try {
        renderer.render(useStore.getState().pipeline, t);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // push source into renderer when it changes
  useEffect(() => {
    if (source && rendererRef.current) {
      rendererRef.current.setSource(source.el, source.w, source.h);
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
