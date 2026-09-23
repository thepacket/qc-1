import type { Calculator } from "../calc/calculator";
import { symbolGlyph } from "../calc/entry";
import { fmt } from "./charts/colors";

const TAU = 2 * Math.PI;
const SPEEDS = [0.1, 0.25, 0.5, 1];

/**
 * PARAM: one slider per symbol the tape uses. t runs over [0, 2π) and can be
 * played; the others over [−2π, 2π]. ◀ ▶ pick a symbol, a keyed-in number
 * followed by = sets it exactly. AC closes.
 */
export function ParamView({ calc }: { calc: Calculator }) {
  const { symbols, scope, playback } = calc;
  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={() => calc.closeParams()} aria-label="Close parameters">‹</button>
        <span>PARAM · symbols in the tape</span>
      </div>
      <div className="rows lab-body">
        {symbols.length === 0 && (
          <p className="dim note">
            No symbols yet. Type one into an angle: 2ND . gives t, 2ND , gives θ (press again for φ, λ, …),
            e.g. 2θ then RX.
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
                <span className="param-val">{fmt(v, 4)} <span className="dim">= {fmt(v / Math.PI, 3)}π</span></span>
                {isT && (
                  <button className="lab-status" onClick={() => calc.togglePlayback("t")}>
                    {playback?.name === "t" ? "❚❚ pause" : "▶ play"}
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
        {symbols.length > 0 && <p className="dim note">◀ ▶ pick · type a value then = to set it exactly · AC closes</p>}
      </div>
    </div>
  );
}
