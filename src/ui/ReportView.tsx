import { createPortal } from "react-dom";
import type { Calculator } from "../calc/calculator";
import { formatEntry } from "../calc/steps";
import { symbolGlyph } from "../calc/entry";
import { exportQasm3 } from "../qasm/fromTape";
import { ChartView } from "./charts/Charts";
import { fmt, fmtC } from "./charts/colors";
import { CircuitDiagram } from "./CircuitView";

const KET_ROWS = 32;
const bits = (i: number, n: number) => i.toString(2).padStart(n, "0");

/**
 * The session report (TAPE ≡ → Report): the register, the circuit, the state
 * and the LAB results pinned with PIN, as a light page for printing (the
 * phone's print dialog saves a PDF). The circuit and charts keep the dark
 * display surface their colours are validated on, as figures.
 */
export function ReportView({ calc }: { calc: Calculator }) {
  const { n, tape } = calc;
  const ket = calc.reportKet;
  const syms = calc.symbols;
  // A portal under <body>: printing then needs nothing from the calculator's fixed-height layout.
  return createPortal(
    <div className="report" role="dialog" aria-label="Session report">
      <div className="report-bar">
        <button onClick={() => window.print()}>Print / save PDF</button>
        <button onClick={() => calc.toggleReport()}>Close</button>
      </div>
      <article className="report-page">
        <h1>QC-1 session report</h1>
        <p className="report-meta">
          {new Date().toLocaleString()} · {n} qubit{n > 1 ? "s" : ""}{n > 20 ? " (stabilizer mode)" : ""} · {tape.length} step{tape.length === 1 ? "" : "s"}
          {syms.length > 0 && <> · {syms.map((s) => `${symbolGlyph(s)} = ${fmt(calc.scope[s] ?? 0, 4)}`).join(", ")}</>}
          {calc.noiseOn && <> · noise model on (the circuit and state below are ideal)</>}
        </p>

        <h2>Circuit</h2>
        {tape.length === 0 ? <p>The circuit is empty.</p> : (
          <figure className="report-figure">
            <CircuitDiagram n={n} tape={tape} scrub={null} />
          </figure>
        )}

        <h2>State</h2>
        {!ket ? <p className="report-dim">…</p> : ket.generators ? (
          <>
            <p>Stabilizer generators (the state is the +1 eigenstate of each; q0 first):</p>
            <pre className="report-pre">{ket.generators.slice(0, 64).join("\n")}{ket.generators.length > 64 ? `\n… ${ket.generators.length - 64} more` : ""}</pre>
          </>
        ) : (
          <>
            <table className="report-table">
              <thead><tr><th>basis |q0…q{n - 1}⟩</th><th>amplitude</th><th>probability</th></tr></thead>
              <tbody>
                {ket.rows.slice(0, KET_ROWS).map((r) => (
                  <tr key={r.i}><td>|{bits(r.i, n)}⟩</td><td>{fmtC(r.re, r.im)}</td><td>{fmt(r.re ** 2 + r.im ** 2, 4)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="report-dim">{ket.nonzero} nonzero amplitude{ket.nonzero === 1 ? "" : "s"}{ket.nonzero > KET_ROWS ? `; the ${KET_ROWS} largest shown` : ""}.</p>
          </>
        )}

        <h2>Pinned results</h2>
        {calc.pins.length === 0 && <p className="report-dim">None. In LAB, PIN adds the result on screen here.</p>}
        {calc.pins.map((p, i) => (
          <section key={i} className="report-pin">
            <h3>
              {p.title}
              <span className="report-dim"> · {p.at}, at step {p.steps}{p.n !== n ? `, n = ${p.n}` : ""}{p.steps !== tape.length ? " (the circuit has changed since)" : ""}</span>
              <button className="report-unpin" onClick={() => calc.unpin(i)} aria-label={`Unpin ${p.title}`}>unpin</button>
            </h3>
            {p.result.scalars && (
              <table className="report-table">
                <tbody>
                  {p.result.scalars.map((s) => (
                    <tr key={s.label}><td>{s.label}</td><td>{typeof s.value === "number" ? fmt(s.value, 6) : s.value}{s.unit ? ` ${s.unit}` : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.result.charts?.map((c, k) => <figure key={k} className="report-figure">{<ChartView chart={c} />}</figure>)}
            {p.result.notes?.map((t) => <p key={t} className="report-dim">{t}</p>)}
          </section>
        ))}

        <h2>Steps</h2>
        {tape.length === 0 ? <p>Empty.</p> : (
          <ol className="report-tape">{tape.map((e, i) => <li key={i}>{formatEntry(e)}</li>)}</ol>
        )}

        <h2>OpenQASM 3</h2>
        <pre className="report-pre">{exportQasm3(n, tape)}</pre>
      </article>
    </div>,
    document.body,
  );
}
