import { useEffect, useState } from "react";
import type { Calculator } from "../calc/calculator";
import { evalParam } from "../calc/steps";
import { symbolGlyph } from "../calc/entry";
import { fmt } from "./charts/colors";
import { recordSweep, videoType } from "./recorder";

const TAU = 2 * Math.PI;
const SPEEDS = [0.1, 0.25, 0.5, 1];

/**
 * PARAM: one slider per symbol the circuit uses, and a field to type an
 * exact value (an expression: pi/3, 0.25, sqrt(2)). t runs over [0, 2π) and
 * can be played; the others over [−2π, 2π].
 */
export function ParamView({ calc }: { calc: Calculator }) {
  const { symbols, scope, playback } = calc;
  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={() => calc.closeParams()} aria-label="Close parameters">‹</button>
        <span>PARAM · symbols in the circuit</span>
      </div>
      <div className="rows lab-body">
        {symbols.length === 0 && (
          <p className="dim note">
            No symbols yet. Type one into a gate's angle in the Inspector: t, theta, phi, lambda… (e.g. 2*theta).
          </p>
        )}
        {symbols.map((name, i) => {
          const isT = name === "t";
          const lo = isT ? 0 : -TAU, hi = isT ? TAU : TAU;
          const v = scope[name] ?? 0;
          return (
            <div key={name} className={`param-row${i === calc.param.index ? " on" : ""}`}>
              <div className="param-top">
                <span className="param-name">{symbolGlyph(name)}</span>
                <ExactValue value={v} name={symbolGlyph(name)} onSet={(x) => calc.setSymbol(name, x)} />
                <span className="dim param-pi">= {fmt(v / Math.PI, 3)}π</span>
                {isT && (
                  <button className="lab-status" onClick={() => calc.togglePlayback("t")}>
                    {playback?.name === "t" ? "❚❚ pause" : "▶ play"}
                  </button>
                )}
                {isT && videoType() && (
                  <button className="lab-status" disabled={!!calc.recording} aria-label="Record one period of t as a video"
                    onClick={() => {
                      // Record the view behind PARAM: close it first.
                      calc.closeParams();
                      recordSweep(calc).catch((e) => calc.notify(e instanceof Error ? e.message : String(e), "error"));
                    }}>
                    ● REC
                  </button>
                )}
              </div>
              <input
                type="range" min={lo} max={hi} step={TAU / 720} value={Math.max(lo, Math.min(hi, v))}
                aria-label={`${symbolGlyph(name)} value`}
                onChange={(e) => calc.setSymbol(name, Number(e.target.value))}
              />
              {isT && playback?.name === "t" && (
                <div className="cut-picker">
                  <span className="dim">speed</span>
                  {SPEEDS.map((hz) => (
                    <button key={hz} className={`qb${playback.hz === hz ? " sel" : ""}`} onClick={() => calc.setPlaybackSpeed(hz)}>
                      {hz} Hz
                    </button>
                  ))}
                  <span className="dim">{playback.fps ? `${playback.fps.toFixed(0)} fps` : ""}</span>
                </div>
              )}
            </div>
          );
        })}
        {symbols.length > 0 && <p className="dim note">Drag a slider, or type a value (pi/3, 0.25, sqrt(2)) and press Enter.</p>}
      </div>
    </div>
  );
}

/** A symbol's value as a field: type an expression, Enter (or leaving the field) sets it. */
function ExactValue({ value, name, onSet }: { value: number; name: string; onSet: (x: number) => void }) {
  const shown = fmt(value, 4);
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [value]);
  const commit = () => {
    if (draft === null) return;
    const x = evalParam(draft.trim());
    if (draft.trim() && Number.isFinite(x)) onSet(x);
    else if (draft.trim()) return setBad(true);
    setDraft(null);
  };
  return (
    <input className={`param-val${bad ? " bad" : ""}`} value={draft ?? shown} aria-label={`${name} exact value`} inputMode="text"
      autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"
      onFocus={(e) => { setDraft(shown); e.target.select(); }} onChange={(e) => { setDraft(e.target.value); setBad(false); }} onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); } }} />
  );
}
