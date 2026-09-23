import { useEffect, useRef } from "react";
import type { Calculator } from "../../calc/calculator";
import { ANALYSIS_BY_ID, CATEGORIES, analysesIn, cutDefault } from "../../analysis/catalog";
import type { AnalysisMeta, InputSpec } from "../../analysis/types";
import { ChartView } from "../charts/Charts";
import { fmt } from "../charts/colors";

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
  return null;
}
