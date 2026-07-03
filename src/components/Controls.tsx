import { EFFECT_BY_ID } from "../effects/list";
import { useStore } from "../store";
import { BANDS } from "../audio";
import type { PipelineNode } from "../effects/types";

export function Controls({ node }: { node: PipelineNode }) {
  const effect = EFFECT_BY_ID[node.effectId];
  const setParam = useStore((s) => s.setParam);
  const cycleMod = useStore((s) => s.cycleMod);
  const audioOn = useStore((s) => s.audioOn);

  return (
    <div className="controls">
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
                    ? `audio-linked: ${mod} (click to cycle ${BANDS.join(" → ")} → off)`
                    : "link to mic audio"
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
    </div>
  );
}
