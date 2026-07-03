import { useEffect, useState } from "react";
import { Renderer } from "../gl/renderer";
import { PRESETS, type Preset } from "../presets";
import { nodesFromPreset, useStore } from "../store";

// one hidden renderer shared across re-renders
let thumbRenderer: Renderer | null = null;
let thumbCanvas: HTMLCanvasElement | null = null;

export function PresetThumbs({ onPick }: { onPick: (p: Preset) => void }) {
  const source = useStore((s) => s.source);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!source) return;
    try {
      if (!thumbRenderer) {
        thumbCanvas = document.createElement("canvas");
        thumbRenderer = new Renderer(thumbCanvas);
      }
      const w = 140;
      const h = Math.max(1, Math.round((source.h / source.w) * w));
      const small = document.createElement("canvas");
      small.width = w;
      small.height = h;
      small.getContext("2d")!.drawImage(source.el, 0, 0, w, h);
      thumbRenderer.setSource(small, w, h);
      const out: Record<string, string> = {};
      for (const p of PRESETS) {
        thumbRenderer.render(nodesFromPreset(p), 1.0);
        // toDataURL must happen synchronously after render (no preserveDrawingBuffer)
        out[p.name] = thumbCanvas!.toDataURL("image/jpeg", 0.7);
      }
      setThumbs(out);
    } catch {
      setThumbs({});
    }
  }, [source]);

  return (
    <div className="presets">
      {PRESETS.map((p) => (
        <button key={p.name} className="preset-thumb" onClick={() => onPick(p)}>
          {thumbs[p.name] && <img src={thumbs[p.name]} alt="" draggable={false} />}
          <span>{p.name}</span>
        </button>
      ))}
    </div>
  );
}
