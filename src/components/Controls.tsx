import { useState } from "react";
import { EFFECT_BY_ID } from "../effects/list";
import { useStore } from "../store";
import { MOD_SOURCES } from "../audio";
import { getShaderError } from "../gl/renderer";
import { defaultMask, type PipelineNode } from "../effects/types";

function CodeEditor({ node }: { node: PipelineNode }) {
  const setCode = useStore((s) => s.setCode);
  const [draft, setDraft] = useState(node.code ?? "");
  const [, setTick] = useState(0);
  const err = node.code ? getShaderError(node.code) : null;
  return (
    <div className="code-editor">
      <textarea
        spellCheck={false}
        rows={10}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        onClick={() => {
          setCode(node.uid, draft);
          // compile happens lazily on the next GL frame; re-read its error
          setTimeout(() => setTick((t) => t + 1), 120);
        }}
      >
        ▶ apply shader
      </button>
      {err && <pre className="code-err">{err}</pre>}
    </div>
  );
}

function MaskControls({ node }: { node: PipelineNode }) {
  const setMask = useStore((s) => s.setMask);
  const m = node.mask ?? defaultMask();
  const num = (
    label: string,
    key: "cx" | "cy" | "size" | "feather" | "angle",
    min: number,
    max: number,
    step: number,
  ) => (
    <label className="ctl">
      <span className="ctl-label">{label}</span>
      <span />
      <span className="ctl-val">{m[key].toFixed(step < 1 ? 2 : 0)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={m[key]}
        onChange={(e) => setMask(node.uid, { [key]: +e.target.value })}
      />
    </label>
  );
  return (
    <div className="mask">
      <label className="ctl ctl-row">
        <span className="ctl-label">mask</span>
        <select
          value={m.type}
          onChange={(e) => {
            const t = +e.target.value;
            setMask(node.uid, t === 0 ? null : { type: t });
          }}
        >
          <option value={0}>off</option>
          <option value={1}>radial</option>
          <option value={2}>linear</option>
        </select>
      </label>
      {m.type > 0 && (
        <>
          {num("center x", "cx", 0, 1, 0.01)}
          {num("center y", "cy", 0, 1, 0.01)}
          {m.type === 1 && num("radius", "size", 0.02, 1, 0.01)}
          {m.type === 2 && num("angle", "angle", 0, 360, 1)}
          {num("feather", "feather", 0.001, 0.5, 0.001)}
          <label className="ctl ctl-row">
            <span className="ctl-label">invert</span>
            <input
              type="checkbox"
              checked={m.invert > 0.5}
              onChange={(e) => setMask(node.uid, { invert: e.target.checked ? 1 : 0 })}
            />
          </label>
        </>
      )}
    </div>
  );
}

export function Controls({ node }: { node: PipelineNode }) {
  const effect = EFFECT_BY_ID[node.effectId];
  const setParam = useStore((s) => s.setParam);
  const cycleMod = useStore((s) => s.cycleMod);
  const audioOn = useStore((s) => s.audioOn);

  return (
    <div className="controls">
      {effect.id === "custom" && <CodeEditor key={node.uid} node={node} />}
      {effect.controls.map((c) => {
        const val = node.params[c.uniform];
        if (c.type === "slider") {
          const mod = node.mods?.[c.uniform];
          return (
            <label key={c.uniform} className="ctl">
              <span className="ctl-label">{c.label}</span>
              <button
                type="button"
                className={`mod ${mod ? "on" : ""}`}
                title={
                  mod
                    ? `modulated by ${mod} (click to cycle ${MOD_SOURCES.join(" → ")} → off)`
                    : "link to mic audio band or LFO"
                }
                style={audioOn || mod ? undefined : { opacity: 0.35 }}
                onClick={(e) => {
                  e.preventDefault();
                  cycleMod(node.uid, c.uniform);
                }}
              >
                {mod ? `♪${mod}` : "♪"}
              </button>
              <span className="ctl-val">{Number(val).toFixed(c.step < 1 ? 2 : 0)}</span>
              <input
                type="range"
                min={c.min}
                max={c.max}
                step={c.step}
                value={Number(val)}
                onChange={(e) => setParam(node.uid, c.uniform, +e.target.value)}
              />
            </label>
          );
        }
        if (c.type === "toggle") {
          return (
            <label key={c.uniform} className="ctl ctl-row">
              <span className="ctl-label">{c.label}</span>
              <input
                type="checkbox"
                checked={Number(val) > 0.5}
                onChange={(e) => setParam(node.uid, c.uniform, e.target.checked ? 1 : 0)}
              />
            </label>
          );
        }
        if (c.type === "select") {
          return (
            <label key={c.uniform} className="ctl ctl-row">
              <span className="ctl-label">{c.label}</span>
              <select
                value={Number(val)}
                onChange={(e) => setParam(node.uid, c.uniform, +e.target.value)}
              >
                {c.options.map((o, i) => (
                  <option key={o} value={i}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        // color
        return (
          <label key={c.uniform} className="ctl ctl-row">
            <span className="ctl-label">{c.label}</span>
            <input
              type="color"
              value={String(val)}
              onChange={(e) => setParam(node.uid, c.uniform, e.target.value)}
            />
          </label>
        );
      })}
      <MaskControls node={node} />
    </div>
  );
}
