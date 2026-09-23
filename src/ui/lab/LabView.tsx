import { useEffect, useRef } from "react";
import type { Calculator } from "../../calc/calculator";
import { ANALYSIS_BY_ID, CATEGORIES, analysesIn, cutDefault, inputValue, pauliValue, symbolValue } from "../../analysis/catalog";
import { pauliPresets } from "../../analysis/pauliPresets";
import { symbolGlyph } from "../../calc/entry";
import { useState } from "react";
import type { AnalysisMeta, InputSpec } from "../../analysis/types";
import { ChartView } from "../charts/Charts";
import { fmt } from "../charts/colors";
import { NOISE_PRESETS, type NoiseModel } from "../../noise/model";
import { importIbmBackend } from "../../noise/ibm";

/** LAB: category list → analysis list → analysis screen. */
export function LabView({ calc }: { calc: Calculator }) {
  const { lab } = calc;
  if (lab.level === "view" && lab.id) return <AnalysisScreen calc={calc} meta={ANALYSIS_BY_ID[lab.id]} />;
  return lab.level === "cats" ? <Categories calc={calc} /> : <List calc={calc} />;
}

function useLitRow(index: number) {
  const lit = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    lit.current?.scrollIntoView({ block: "nearest" });
  }, [index]);
  return lit;
}

function Categories({ calc }: { calc: Calculator }) {
  const lit = useLitRow(calc.lab.index);
  return (
    <div className="view">
      <div className="view-head">LAB · choose a category (◀ ▶ =, or tap)</div>
      <div className="rows">
        {CATEGORIES.map((c, i) => {
          const count = analysesIn(c.id).length;
          return (
            <button key={c.id} ref={i === calc.lab.index ? lit : undefined}
              className={`cat-row${i === calc.lab.index ? " on" : ""}`} disabled={count === 0}
              onClick={() => calc.labPick("cats", i)}>
              <span>{c.label}</span>
              <span className="dim">{count || "soon"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const fits = (m: AnalysisMeta, n: number) => n <= m.maxQubits && n >= (m.minQubits ?? 1);

function List({ calc }: { calc: Calculator }) {
  const cat = CATEGORIES[calc.lab.cat];
  const items = analysesIn(cat.id);
  const lit = useLitRow(calc.lab.index);
  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={() => calc.labBack()} aria-label="Back to categories">‹</button>
        <span>{cat.label}</span>
      </div>
      <div className="rows">
        {items.map((a, i) => (
          <button key={a.id} ref={i === calc.lab.index ? lit : undefined}
            className={`lab-item${i === calc.lab.index ? " on" : ""}`} disabled={!fits(a, calc.n)}
            onClick={() => calc.labPick("list", i)}>
            <span className="t">{a.title}{!fits(a, calc.n) && <span className="dim"> · n {a.minQubits && calc.n < a.minQubits ? `≥ ${a.minQubits}` : `≤ ${a.maxQubits}`}</span>}</span>
            <span className="s">{a.summary}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AnalysisScreen({ calc, meta }: { calc: Calculator; meta: AnalysisMeta }) {
  if (meta.id === "noisemodel") return <NoiseSettings calc={calc} />;
  const a = calc.analysis?.id === meta.id ? calc.analysis : null;
  const res = a?.result;
  const stale = a && a.rev !== calc.rev;
  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={() => calc.labBack()} aria-label="Back to list">‹</button>
        <span>{meta.title}</span>
        <span className="grow" />
        {a?.status === "busy" ? (
          <button className="lab-status busy" onClick={() => calc.cancelAnalysis()}>computing · cancel</button>
        ) : meta.mode === "run" || stale ? (
          <button className="lab-status" onClick={() => calc.requestAnalysis()}>{stale ? "stale · RUN" : "RUN"}</button>
        ) : (
          a && <span className="dim">{a.ms < 1 ? "<1" : Math.round(a.ms)} ms</span>
        )}
        {a?.status === "done" && res && !res.error && !stale && (
          <button className="lab-status" onClick={() => calc.pinAnalysis()} aria-label="Pin this result to the session report">PIN</button>
        )}
      </div>
      <div className="rows lab-body">
        {meta.inputs.length > 0 && (
          <div className="lab-inputs">
            {meta.inputs.map((s) => <Input key={s.key} calc={calc} meta={meta} spec={s} />)}
          </div>
        )}
        {res?.error && <div className="lab-error">E: {res.error}</div>}
        {res?.scalars && (
          <dl className="scalars">
            {res.scalars.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd>{typeof s.value === "number" ? fmt(s.value) : s.value}{s.unit && <span className="dim"> {s.unit}</span>}</dd>
              </div>
            ))}
          </dl>
        )}
        {res?.proposal && (
          <div className={`proposal${res.proposal.verified ? "" : " bad"}`}>
            <span>{res.proposal.verified ? "✓ " : "✗ "}{res.proposal.check}</span>
            {res.proposal.verified && !stale && (
              <button className="lab-status apply" onClick={() => calc.applyProposal(res.proposal!)}>{res.proposal.label}</button>
            )}
          </div>
        )}
        {res?.apply && Object.keys(res.apply.scope).length > 0 && (
          <button className="lab-status apply" onClick={() => calc.applyScope(res.apply!.scope)}>{res.apply.label}</button>
        )}
        {res?.charts?.map((c, i) => <ChartView key={i} chart={c} />)}
        {res?.notes?.map((n) => <p key={n} className="dim note">{n}</p>)}
        <p className="dim note">{meta.summary}</p>
      </div>
    </div>
  );
}

function Input({ calc, meta, spec }: { calc: Calculator; meta: AnalysisMeta; spec: InputSpec }) {
  if (spec.kind === "cut") {
    const cur = calc.labOpts(meta.id)[spec.key];
    const sel = Array.isArray(cur) ? (cur as number[]).filter((q) => q < calc.n) : cutDefault(meta, spec.key, calc.n);
    const max = Math.min(spec.max ?? calc.n - 1, calc.n - 1);
    const toggle = (q: number) => {
      const next = sel.includes(q) ? sel.filter((x) => x !== q) : [...sel, q].sort((a, b) => a - b);
      if (next.length < (spec.min ?? 1) || next.length > max) return;
      calc.setLabOpts(meta.id, { [spec.key]: next });
    };
    return (
      <div className="cut-picker" role="group" aria-label={spec.label}>
        <span className="dim">{spec.label}</span>
        {[...Array(calc.n).keys()].map((q) => (
          <button key={q} className={`qb${sel.includes(q) ? " sel" : ""}`} aria-pressed={sel.includes(q)} onClick={() => toggle(q)}>
            q{q}
          </button>
        ))}
      </div>
    );
  }
  if (spec.kind === "pauli") return <PauliField calc={calc} meta={meta} spec={spec} />;
  if (spec.kind === "state") return <StateField calc={calc} meta={meta} spec={spec} />;
  if (spec.kind === "symbol") {
    const cur = symbolValue(spec, calc.labOpts(meta.id), calc.symbols);
    const options = [...(spec.optional ? [""] : []), ...calc.symbols];
    if (calc.symbols.length === 0) return <div className="cut-picker"><span className="dim">{spec.label}: no symbols in the tape</span></div>;
    return (
      <div className="cut-picker" role="radiogroup" aria-label={spec.label}>
        <span className="dim">{spec.label}</span>
        {options.map((o) => (
          <button key={o || "none"} role="radio" aria-checked={o === cur} className={`qb${o === cur ? " sel" : ""}`}
            onClick={() => calc.setLabOpts(meta.id, { [spec.key]: o })}>
            {o ? symbolGlyph(o) : "none"}
          </button>
        ))}
      </div>
    );
  }
  const value = inputValue(spec, calc.labOpts(meta.id), calc.n);
  const set = (v: number) => calc.setLabOpts(meta.id, { [spec.key]: v });
  if (spec.kind === "qubit") {
    return (
      <div className="cut-picker" role="radiogroup" aria-label={spec.label}>
        <span className="dim">{spec.label}</span>
        {[...Array(calc.n).keys()].map((q) => (
          <button key={q} role="radio" aria-checked={q === value} className={`qb${q === value ? " sel" : ""}`} onClick={() => set(q)}>q{q}</button>
        ))}
      </div>
    );
  }
  if (spec.kind === "int") {
    const hi = spec.max <= 0 ? calc.n + spec.max : spec.max;
    return (
      <div className="cut-picker" role="radiogroup" aria-label={spec.label}>
        <span className="dim">{spec.label}</span>
        {Array.from({ length: Math.max(0, hi - spec.min + 1) }, (_, i) => spec.min + i).map((v) => (
          <button key={v} role="radio" aria-checked={v === value} className={`qb${v === value ? " sel" : ""}`} onClick={() => set(v)}>{v}</button>
        ))}
      </div>
    );
  }
  return (
    <div className="cut-picker" role="radiogroup" aria-label={spec.label}>
      <span className="dim">{spec.label}</span>
      {spec.options.map((o) => (
        <button key={o.label} role="radio" aria-checked={o.value === value} className={`qb${o.value === value ? " sel" : ""}`} onClick={() => set(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/**
 * Observable input: a text field on the phone keyboard (characters, no
 * autocorrect) plus presets for the current n. Applied on Enter / blur so
 * the analysis doesn't rerun on every keystroke.
 */
function PauliField({ calc, meta, spec }: { calc: Calculator; meta: AnalysisMeta; spec: Extract<InputSpec, { kind: "pauli" }> }) {
  const committed = pauliValue(calc.labOpts(meta.id), spec.key, calc.n);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== committed) calc.setLabOpts(meta.id, { [spec.key]: draft.trim() });
    setDraft(null);
  };
  return (
    <div className="pauli-field">
      <input
        value={draft ?? committed} aria-label={spec.label} spellCheck={false} autoCapitalize="characters"
        autoCorrect="off" autoComplete="off" inputMode="text" enterKeyHint="done"
        onChange={(e) => setDraft(e.target.value.toUpperCase().replace(/[^IXYZ0-9.EE+\-* ]/g, ""))}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); e.stopPropagation(); }}
      />
      <div className="cut-picker">
        {pauliPresets(calc.n).map((p) => (
          <button key={p.label} className={`qb${p.text === committed ? " sel" : ""}`} onClick={() => { setDraft(null); calc.setLabOpts(meta.id, { [spec.key]: p.text }); }}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Target-state presets for n qubits (amplitude lists are normalised by the tool). */
function statePresets(n: number): { label: string; text: string }[] {
  const d = 1 << n;
  const amps = (f: (i: number) => number) => Array.from({ length: d }, (_, i) => f(i)).join(",");
  return [
    { label: "current", text: "current" },
    { label: `|${"0".repeat(n - 1)}1⟩`, text: `|${"0".repeat(n - 1)}1⟩` },
    ...(n >= 2 ? [{ label: "GHZ", text: amps((i) => (i === 0 || i === d - 1 ? 1 : 0)) }] : []),
    ...(n >= 2 ? [{ label: "W", text: amps((i) => ((i & (i - 1)) === 0 && i > 0 ? 1 : 0)) }] : []),
    { label: "uniform", text: amps(() => 1) },
  ];
}

/** Target state: |bits⟩ or amplitudes (1, 0, 0.5i, …) on the phone keyboard, with presets. */
function StateField({ calc, meta, spec }: { calc: Calculator; meta: AnalysisMeta; spec: Extract<InputSpec, { kind: "state" }> }) {
  const v = calc.labOpts(meta.id)[spec.key];
  const committed = typeof v === "string" && v.trim() ? v : "current";
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== committed) calc.setLabOpts(meta.id, { [spec.key]: draft.trim() || "current" });
    setDraft(null);
  };
  return (
    <div className="pauli-field">
      <input
        value={draft ?? committed} aria-label={spec.label} spellCheck={false} autoCapitalize="none"
        autoCorrect="off" autoComplete="off" inputMode="text" enterKeyHint="done" placeholder="|011⟩ or 1, 0, 0, i"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); e.stopPropagation(); }}
      />
      <div className="cut-picker">
        {statePresets(calc.n).map((p) => (
          <button key={p.label} className={`qb${p.text === committed ? " sel" : ""}`} onClick={() => { setDraft(null); calc.setLabOpts(meta.id, { [spec.key]: p.text }); }}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The noise model: on/off, presets, rates (phone keyboard), a device calibration file. */
function NoiseSettings({ calc }: { calc: Calculator }) {
  const m = calc.noise;
  const file = useRef<HTMLInputElement>(null);
  const fields: [keyof NoiseModel, string, string][] = [
    ["p1", "1-qubit depolarizing λ₁", "ρ → (1−λ)ρ + λ·I/2 after each 1-qubit gate"],
    ["p2", "2-qubit depolarizing λ₂", "after each 2-qubit gate (λ₂ on each qubit for 3+)"],
    ["ad", "amplitude damping γ (T1)", "after each gate, on each of its qubits"],
    ["pd", "phase damping γ (T2)", "after each gate, on each of its qubits"],
    ["readout", "readout flip p", "each measured bit flips with probability p"],
    ["crosstalk", "crosstalk λ", "depolarizing on coupling neighbours of a 2-qubit gate"],
    ["trajectories", "trajectories", "when ρ is too big, or the tape measures"],
  ];
  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={() => calc.labBack()} aria-label="Back to list">‹</button>
        <span>Noise model</span>
        <span className="grow" />
        <button className={`lab-status${m.enabled ? " apply" : ""}`} onClick={() => calc.setNoise({ enabled: !m.enabled })} aria-pressed={m.enabled}>
          {m.enabled ? "ON" : "OFF"}
        </button>
      </div>
      <div className="rows lab-body">
        <div className="cut-picker">
          <span className="dim">preset</span>
          {NOISE_PRESETS.map((p) => (
            <button key={p.id} className="qb" onClick={() => calc.setNoise({ ...p.rates, perQubit: undefined, perGate: undefined, coupling: undefined, source: p.label })}>{p.label}</button>
          ))}
        </div>
        {m.source && <p className="dim note">rates from {m.source}{m.perQubit ? ` · ${m.perQubit.length} calibrated qubits` : ""}</p>}
        {fields.map(([key, label, note]) => (
          <NumberRow key={key} label={label} note={note} value={m[key] as number}
            onCommit={(v) => calc.setNoise({ [key]: key === "trajectories" ? Math.round(v) : v } as Partial<NoiseModel>)} />
        ))}
        <div className="lcd-btns">
          <button onClick={() => file.current?.click()}>DEVICE FILE…</button>
          {(m.perQubit || m.perGate) && <button onClick={() => calc.setNoise({ perQubit: undefined, perGate: undefined, coupling: undefined, source: undefined })}>CLEAR CALIBRATION</button>}
        </div>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            calc.setNoise(importIbmBackend(await f.text()));
            calc.notify(`noise from ${f.name}`);
          } catch (err) {
            calc.notify(err instanceof Error ? err.message : String(err), "error");
          }
        }} />
        <p className="dim note">
          Qiskit Aer's conventions (depolarizing_error, amplitude/phase_damping_error). With noise on, PROB, BLOCH, SHOTS and the Noise & error
          analyses use the exact density matrix (unitary tapes, n ≤ 10) or trajectories; KET, TAPE and the other analyses stay ideal.
        </p>
      </div>
    </div>
  );
}

function NumberRow({ label, note, value, onCommit }: { label: string; note: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const v = Number(draft);
      if (Number.isFinite(v) && v >= 0) onCommit(v);
    }
    setDraft(null);
  };
  return (
    <label className="noise-row">
      <span>{label}<span className="dim"> · {note}</span></span>
      <input value={draft ?? String(value)} inputMode="decimal" enterKeyHint="done" aria-label={label}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
    </label>
  );
}
