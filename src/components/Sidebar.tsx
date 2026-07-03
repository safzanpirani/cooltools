import { useRef, useState } from "react";
import { CATEGORIES, EFFECTS, EFFECT_BY_ID } from "../effects/list";
import { encodeState, fitToCanvas, useStore } from "../store";
import { PRESETS } from "../presets";
import { Controls } from "./Controls";
import { getCurrentRenderer } from "../gl/renderer";
import { isRecording, startRecording, stopRecording } from "../recorder";

export function Sidebar() {
  const pipeline = useStore((s) => s.pipeline);
  const expanded = useStore((s) => s.expanded);
  const addEffect = useStore((s) => s.addEffect);
  const removeNode = useStore((s) => s.removeNode);
  const toggleNode = useStore((s) => s.toggleNode);
  const moveNode = useStore((s) => s.moveNode);
  const setExpanded = useStore((s) => s.setExpanded);
  const resetNode = useStore((s) => s.resetNode);
  const surprise = useStore((s) => s.surprise);
  const clear = useStore((s) => s.clear);
  const setSource = useStore((s) => s.setSource);
  const applyPreset = useStore((s) => s.applyPreset);
  const source = useStore((s) => s.source);
  const startWebcam = useStore((s) => s.startWebcam);
  const stopWebcam = useStore((s) => s.stopWebcam);
  const audioOn = useStore((s) => s.audioOn);
  const startAudio = useStore((s) => s.startAudio);
  const stopAudio = useStore((s) => s.stopAudio);
  const seed = useStore((s) => s.seed);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState("");
  const [rec, setRec] = useState(false);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 1600);
  }

  function onUpload(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    const img = new Image();
    img.onload = () => {
      const { el, w, h } = fitToCanvas(img, img.naturalWidth, img.naturalHeight);
      setSource(el, w, h, file.name);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  function exportPNG() {
    const c = document.getElementById("glcanvas") as HTMLCanvasElement | null;
    if (!c) return;
    // no preserveDrawingBuffer — render fresh so toBlob snapshots a live frame
    getCurrentRenderer()?.render(useStore.getState().pipeline, performance.now() / 1000);
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cooltools-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  }

  async function toggleRecord() {
    if (isRecording()) {
      const blob = await stopRecording();
      setRec(false);
      if (!blob) return flash("nothing recorded");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cooltools-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(a.href);
      flash("webm saved");
    } else {
      const c = document.getElementById("glcanvas") as HTMLCanvasElement | null;
      if (!c) return;
      startRecording(c);
      setRec(true);
      flash("recording…");
    }
  }

  function share() {
    const url = `${location.origin}${location.pathname}#${encodeState(pipeline)}`;
    navigator.clipboard?.writeText(url).then(
      () => flash("link copied"),
      () => flash("copy failed"),
    );
    history.replaceState(null, "", url);
  }

  return (
    <aside className="sidebar">
      <div className="toolbar">
        <button onClick={() => fileRef.current?.click()}>↑ image</button>
        {source?.live ? (
          <button className="cam-on" onClick={stopWebcam}>
            ■ stop cam
          </button>
        ) : (
          <button
            onClick={async () => {
              try {
                await startWebcam();
              } catch {
                flash("camera unavailable");
              }
            }}
          >
            ◉ webcam
          </button>
        )}
        {audioOn ? (
          <button className="cam-on" onClick={stopAudio}>
            ■ mic
          </button>
        ) : (
          <button
            title="audio-reactive: link sliders to mic bands with ♪"
            onClick={async () => {
              try {
                await startAudio();
                flash("mic live — link sliders with ♪");
              } catch {
                flash("mic unavailable");
              }
            }}
          >
            ♪ mic
          </button>
        )}
        <button onClick={exportPNG}>↓ png</button>
        <button className={rec ? "cam-on" : ""} onClick={toggleRecord}>
          {rec ? "■ stop rec" : "● rec"}
        </button>
        <button onClick={share}>⟴ share</button>
        <button title="seeded random chain" onClick={() => surprise()}>
          ✦ remix
        </button>
        {seed && (
          <button
            className="seed"
            title="click to replay or enter a seed"
            onClick={() => {
              const s = window.prompt("remix seed", seed);
              if (s !== null) surprise(s);
            }}
          >
            #{seed}
          </button>
        )}
        <button onClick={clear} disabled={!pipeline.length}>
          ⌫ clear
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onUpload(e.target.files?.[0])}
        />
      </div>

      <div className="section-title">presets</div>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.name} onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="section-title">
        pipeline <span className="muted">{pipeline.length} effect{pipeline.length === 1 ? "" : "s"}</span>
      </div>
      <div className="pipeline">
        {pipeline.length === 0 && (
          <div className="empty">add effects below — they stack top → bottom</div>
        )}
        {pipeline.map((node, i) => {
          const effect = EFFECT_BY_ID[node.effectId];
          const open = expanded === node.uid;
          return (
            <div key={node.uid} className={`node ${node.enabled ? "" : "off"}`}>
              <div className="node-head">
                <span className="idx">{i + 1}</span>
                <button
                  className="name"
                  onClick={() => setExpanded(open ? null : node.uid)}
                >
                  {effect.name}
                  <span className="cat">{effect.category}</span>
                </button>
                <div className="node-btns">
                  <button title="up" onClick={() => moveNode(node.uid, -1)}>↑</button>
                  <button title="down" onClick={() => moveNode(node.uid, 1)}>↓</button>
                  <button
                    title="toggle"
                    className={node.enabled ? "on" : ""}
                    onClick={() => toggleNode(node.uid)}
                  >
                    ◉
                  </button>
                  <button title="remove" onClick={() => removeNode(node.uid)}>✕</button>
                </div>
              </div>
              {open && (
                <>
                  <Controls node={node} />
                  <button className="reset" onClick={() => resetNode(node.uid)}>
                    reset defaults
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="section-title">add effect</div>
      <div className="picker">
        {CATEGORIES.map((cat) => (
          <div key={cat} className="picker-group">
            <div className="picker-cat">{cat}</div>
            <div className="picker-items">
              {EFFECTS.filter((e) => e.category === cat).map((e) => (
                <button key={e.id} title={e.blurb} onClick={() => addEffect(e.id)}>
                  {e.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </aside>
  );
}
