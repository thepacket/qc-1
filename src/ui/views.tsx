import { CircuitView } from "./CircuitView";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SHOT_RATE, type Calculator } from "../calc/calculator";
import { TOMO_MAX } from "../calc/tomography";
import type { ViewData } from "../calc/core";
import { formatEntry } from "../calc/steps";
import { exportQasm3 } from "../qasm/fromTape";
import { shareHash } from "../qasm/share";
import { makeQr, qrPath, QR_MAX } from "../qasm/qr";
import { qiskitPython } from "../qasm/toQiskit";
import { EXAMPLE_CATEGORIES, EXAMPLE_COUNT, describeProgram, loadExample } from "../examples";
import type { Vec3 } from "../calc/analysis";
import { ket, num, pct } from "./format";
import { project, DEFAULT_CAMERA } from "./charts/sphere";
import { BitOrder } from "./ResultContext";
import { blochStateLabel } from "./blochState";

type ViewProps<M extends ViewData["mode"]> = { calc: Calculator; data: Extract<ViewData, { mode: M }> };

export function Pending() {
  return (
    <div className="view">
      <div className="view-head">…</div>
    </div>
  );
}

/** Table cells of KET: sign column kept (space for +), three decimals. */
const fix = (x: number) => `${x < -5e-4 ? "−" : " "}${Math.abs(x).toFixed(3)}`;
const fixI = (x: number) => `${x < -5e-4 ? "−" : "+"}${Math.abs(x).toFixed(3)}i`;

/** Fixed row height of the long lists (13px text × 1.5). */
const ROW_H = 20;

/**
 * A scrolling list that renders only the rows in view (plus a margin), so a
 * view can list thousands of amplitudes or outcomes without re-rendering them
 * all on every key press. Short lists render plainly.
 */
function RowList<T>({ items, row }: { items: T[]; row: (x: T, i: number) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (items.length <= 200) return <div className="rows">{items.map(row)}</div>;
  const start = Math.max(0, Math.floor(top / ROW_H) - 20);
  const end = Math.min(items.length, Math.ceil((top + height) / ROW_H) + 20);
  return (
    <div className="rows" ref={box} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ position: "relative", height: items.length * ROW_H }}>
        {items.slice(start, end).map((x, k) => (
          <div key={start + k} className="vrow" style={{ top: (start + k) * ROW_H }}>{row(x, start + k)}</div>
        ))}
      </div>
    </div>
  );
}

function DensityState({ data, calc }: ViewProps<"ket">) {
  const density = data.density!, d = 2 ** data.n, shown = Math.min(d, 8);
  const labels = Array.from({ length: shown }, (_, i) => i.toString(2).padStart(data.n, "0"));
  return <div className="view"><div className="view-head">Density matrix ρ · purity Tr ρ² = {density.purity.toFixed(4)}</div>
    <BitOrder n={data.n} /><div className="rows lab-body">
      <p>Rows and columns use the same basis order.</p>
      <div className="density-key"><span className="density-probability">Probability</span><span className="density-coherence">Coherence</span></div>
      {shown < d && <p>Showing the first {shown} × {shown} entries of the {d} × {d} matrix. Purity uses the full matrix.</p>}
      <div className="density-table"><table><thead><tr><th>ρ</th>{labels.map(l => <th key={l}>|{l}⟩</th>)}</tr></thead><tbody>{labels.map((l, i) => <tr key={l}><th>⟨{l}|</th>{labels.map((_, j) => {
        const re = density.rho[2 * (i * d + j)], im = density.rho[2 * (i * d + j) + 1];
        return <td key={j} className={i === j ? "density-probability" : "density-coherence"} title={i === j ? "Probability (diagonal)" : "Coherence (off-diagonal)"}>{re.toFixed(3)}{Math.abs(im) > 0.0005 ? `${im < 0 ? " − " : " + "}${Math.abs(im).toFixed(3)}i` : ""}</td>;
      })}</tr>)}</tbody></table></div>
      {density.weight !== undefined ? <details><summary>Optional leading eigenvector · weight {density.weight.toFixed(4)}</summary>
        <p>This is one component of ρ, not the full mixed state.{density.degenerate ? " The largest eigenvalue is degenerate, so this component is not unique." : ""}</p>
        <KetView calc={calc} data={{ ...data, density: undefined, estimate: undefined }} />
      </details> : <p>The optional eigenvector view is available up to 6 qubits.</p>}
    </div></div>;
}

export function KetView({ data, calc }: ViewProps<"ket">) {
  if (data.density) return <DensityState data={data} calc={calc} />;
  const { n, rows, nonzero } = data;
  if (data.generators) {
    return (
      <div className="view">
        <div className="view-head">stabilizer state · {n} generators</div>
        <BitOrder n={n} />
        <RowList items={data.generators} row={(g, i) => <div className="row gen-row" key={i}><span className="dim">g{i + 1}</span><span className="ket">{g}</span></div>} />
      </div>
    );
  }
  // A table: real and imaginary parts in their own columns, three decimals, signs aligned;
  // the imaginary column only when some amplitude has one (a real state reads 0.707 |00⟩).
  const showIm = rows.some((r) => Math.abs(r.im) >= 5e-4);
  const showRe = !showIm || rows.some((r) => Math.abs(r.re) >= 5e-4);
  const cols = `${showRe ? "6ch " : ""}${showIm ? "7.5ch " : ""}1fr auto`;
  return (
    <div className="view">
      {data.estimate && (
        <div className="view-head estimate">
          {data.estimate.magnitudes
            ? `|amplitude| = √frequency from ${data.estimate.shots.toLocaleString()} shots · phases need state tomography, not measured above ${TOMO_MAX} qubits`
            : `reconstructed by state tomography: ${data.estimate.settings?.toLocaleString()} settings × ${data.estimate.shots.toLocaleString()} shots · leading eigenvector of ρ̂, λ₁ = ${data.estimate.lambda?.toFixed(3)} · global phase set`}
        </div>
      )}
      <div className="view-head">
        {nonzero === 1 ? "basis state" : `${nonzero.toLocaleString()} terms`}
        {nonzero > rows.length && ` · the ${rows.length.toLocaleString()} largest; the other ${(nonzero - rows.length).toLocaleString()} hold ${pct(data.restP)}`}
      </div>
      <BitOrder n={n} />
      <RowList items={rows} row={({ i, re, im }) => (
        <div className="row ket-row" key={i} style={{ gridTemplateColumns: cols }}>
          {showRe && <span className="amp">{fix(re)}</span>}
          {showIm && <span className="amp">{fixI(im)}</span>}
          <span className="ket">{ket(i, n)}</span>
          <span className="dim">{pct(re * re + im * im)}</span>
        </div>
      )} />
    </div>
  );
}

function Bars({ items, head, wide, n }: { items: { label: string; p: number; note: string }[]; head: string; n?: number; /** Notes like "3.4% ± 0.6%". */ wide?: boolean }) {
  const max = items.reduce((m, x) => Math.max(m, x.p), 1e-12); // (no spread: lists can be long)
  return (
    <div className={`view${wide ? " wide-notes" : ""}`}>
      <div className="view-head">{head}</div>
      {n !== undefined && <BitOrder n={n} />}
      <RowList items={items} row={(x) => (
        <div className="bar-row" key={x.label}>
          <span className="ket">{x.label}</span>
          <span className="bar"><span style={{ width: `${(x.p / max) * 100}%` }} /></span>
          <span className="dim">{x.note}</span>
        </div>
      )} />
    </div>
  );
}

export function ProbView({ data }: ViewProps<"prob">) {
  if (data.marginals) {
    const errs = data.marginalErrors;
    const items = data.marginals.map((p, q) => ({ label: `q${q}`, p, note: errs ? `${pct(p)} ± ${pct(errs[q])}` : pct(p) }));
    const head = `P(qᵢ = 1) · stabilizer state${data.n > items.length ? ` · first ${items.length} of ${data.n} qubits (work budget)` : ""}`;
    return <Bars items={items} wide={!!errs} head={data.estimate ? `${head} · estimated from ${data.estimate.shots.toLocaleString()} shots (± standard error)` : head} />;
  }
  const items = data.rows.map(({ i, p, se }) => ({ label: ket(i, data.n), p, note: se === undefined ? pct(p) : `${pct(p)} ± ${pct(se)}` }));
  // Every bit of probability is accounted for: what isn't listed is one last row.
  if (!data.complete && data.restP > 1e-9) items.push({ label: "all other outcomes", p: data.restP, note: pct(data.restP) });
  const head = data.complete ? "P(basis)" : `the ${data.rows.length.toLocaleString()} most likely + the rest`;
  return <Bars items={items} n={data.n} wide={!!data.estimate} head={data.estimate ? `${head} · estimated from ${data.estimate.shots.toLocaleString()} shots (± standard error)` : head} />;
}

export function ShotsView({ calc, data }: ViewProps<"shots">) {
  // Repeating runs keep the rows in basis order, so bars don't swap places a few times a second.
  const rows = calc.autoShots ? [...data.rows].sort((a, b) => (a.bits && b.bits ? (a.bits < b.bits ? -1 : a.bits > b.bits ? 1 : 0) : a.i - b.i)) : data.rows;
  const items = rows.map(({ i, count, bits }) => ({ label: bits ? (bits.length > 24 ? `${bits.slice(0, 24)}…` : bits) : ket(i, data.n), p: count, note: String(count) }));
  // Every shot is accounted for: outcomes beyond the listed ones are summed in one last row.
  if (data.other > 0) items.push({ label: `${(data.distinct - data.rows.length).toLocaleString()} other outcomes`, p: data.other, note: String(data.other) });
  const shots = data.requested ? `${data.shots.toLocaleString()} shots (of ${data.requested.toLocaleString()}: the budget at n = ${data.n})` : `${data.shots.toLocaleString()} shots`;
  return (
    <>
      <Bars items={items} n={data.n} head={`${shots} · ${data.distinct.toLocaleString()} outcomes`} />
    </>
  );
}

/** The shot count (typed), a re-roll, and periodic runs (a toggle and their rate; the Calculator runs them in any tab). */
export function ExperimentControls({ calc }: { calc: Calculator }) {
  const hardware = calc.experimentMode === "hardware";
  return <div className="experiment-controls">
    <div className="experiment-mode" role="group" aria-label="Calculation mode">
      <button className={`qb${!hardware ? " on" : ""}`} aria-pressed={!hardware} onClick={() => calc.setExperimentMode("simulation")}>Direct Calculation</button>
      <button className={`qb${hardware ? " on" : ""}`} aria-pressed={hardware} onClick={() => calc.setExperimentMode("hardware")}>Simulated Measurements</button>
      <button className="qb noise-model-button" onClick={() => { calc.openAnalysis("noisemodel"); calc.setMode("lab"); }}>Noise model</button>
    </div>
    {(hardware || calc.mode === "shots") && <ShotsBar calc={calc} />}
  </div>;
}

function ShotsBar({ calc }: { calc: Calculator }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [rate, setRate] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== "") calc.setShots(Number(draft));
    setDraft(null);
  };
  const commitRate = () => {
    if (rate !== null && rate.trim() !== "" && !calc.setShotRate(Number(rate))) { setRate(null); return; }
    setRate(null);
  };
  const { autoShots, shotRate } = calc;
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); };
  return (
    <div className="shots-bar">
      <label>shots <input type="number" inputMode="numeric" min={1} max={1000000} value={draft ?? String(calc.shots)}
        onFocus={(e) => { setDraft(String(calc.shots)); e.target.select(); }} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={keys} /></label>
      <button className="qb" disabled={calc.busy} onClick={() => calc.rerollShots()}>{calc.experimentMode === "hardware" ? "Run once" : "Sample shots"}</button>
      <label className="shots-auto"><input type="checkbox" checked={autoShots} onChange={(e) => calc.setAutoShots(e.target.checked)} /> Auto-repeat</label>
      <label>rate <input className="shots-rate" type="number" inputMode="decimal" min={SHOT_RATE[0]} max={SHOT_RATE[1]} step="any"
        value={rate ?? String(shotRate)} aria-label="Runs per second"
        onFocus={(e) => { setRate(String(shotRate)); e.target.select(); }} onChange={(e) => setRate(e.target.value)} onBlur={commitRate}
        onKeyDown={keys} /> /s</label>
      {autoShots && <span className="dim" aria-live="off">run {calc.shotRun}</span>}
      {calc.noiseOn && calc.experimentMode === "hardware" && (
        <span className="readout-controls">
        <label className="shots-auto" title="Undo the noise model's readout confusion in the estimates (quasi-probabilities)">
          <input type="checkbox" checked={calc.mitigateReadout} onChange={(e) => calc.setMitigateReadout(e.target.checked)} /> Readout mitigation
        </label>
        <button className="qb" aria-label="Readout mitigation info" onClick={() => { calc.openAnalysis("readout"); calc.setMode("lab"); }}>info</button>
        </span>
      )}
    </div>
  );
}

async function copyText(calc: Calculator, text: string, done = "QASM copied") {
  try {
    await navigator.clipboard.writeText(text);
    calc.notify(done);
  } catch {
    calc.notify("copy blocked", "error");
  }
}

async function shareQasm(calc: Calculator, text: string, name = "qc1-circuit.qasm") {
  const file = new File([text], name, { type: "text/plain" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "QC-1 circuit" });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return; // user closed the sheet
  }
  // No file sharing (desktop): save the file instead.
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  calc.notify(`saved ${name}`);
}

type TapePane = "list" | "circ" | "qasm" | "menu" | "examples" | "import" | "qr" | "memory" | "define";

export function TapeView({ calc }: { calc: Calculator }) {
  const [pane, setPane] = useState<TapePane>("circ");
  const end = useRef<HTMLDivElement>(null);
  const tape = calc.tape;
  const text = useMemo(() => (pane === "qasm" ? exportQasm3(calc.n, tape, calc.bits) : ""), [pane, calc.n, tape, calc.bits]);
  const at = calc.scrub ?? tape.length;
  const cur = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pane !== "list") return;
    (calc.scrub === null ? end : cur).current?.scrollIntoView({ block: calc.scrub === null ? "end" : "nearest" });
  }, [tape, pane, calc.scrub]);
  const tab = (p: TapePane, label: string) => (
    <button className={pane === p ? "on" : ""} onClick={() => { if (p !== "circ") calc.selectStep(null); setPane(pane === p && p === "menu" ? "circ" : p); }}>{label}</button>
  );
  return (
    <div className="view">
      <div className="view-head tape-head">
        <span>{tape.length} steps</span>
        <span className="lcd-btns">
          {tab("menu", "MENU")}
          {tab("circ", "CIRCUIT")}
          {tab("list", "STEP")}
          {tab("qasm", "QASM")}
        </span>
      </div>
      {pane === "menu" && <TapeMenu calc={calc} go={setPane} />}
      {pane === "qr" && <QrPane calc={calc} done={() => setPane("menu")} />}
      {pane === "examples" && <ExamplesPane calc={calc} done={() => setPane("circ")} />}
      {pane === "import" && <ImportPane calc={calc} done={() => setPane("circ")} />}
      {pane === "memory" && <MemoryPane calc={calc} done={() => setPane("circ")} />}
      {pane === "define" && <DefinePane calc={calc} done={() => setPane("circ")} />}
      {(pane === "list" || pane === "circ") && tape.length > 0 && (
        <div className="scrubber">
          <button onClick={() => calc.setScrub(at - 1)} disabled={at === 0} aria-label="Step back">◀</button>
          <input type="range" min={0} max={tape.length} value={at} aria-label="Show the state after step"
            onChange={(e) => calc.setScrub(Number(e.target.value))} />
          <button onClick={() => calc.setScrub(at + 1)} disabled={at >= tape.length} aria-label="Step forward">▶</button>
          <span className="dim">{calc.scrub === null ? "live" : `@${at}`}</span>
        </div>
      )}
      {pane === "circ" && <CircuitView calc={calc} />}
      {pane === "qasm" && <pre className="rows qasm">{text}</pre>}
      {pane === "list" && (
        <div className="rows">
          {tape.length === 0 && <div className="dim">empty — drag gates from the palette onto the wires (MENU for examples and import)</div>}
          {tape.map((e, i) => (
            <div className={`row tape-row${i >= at ? " ahead" : ""}${i === at - 1 && calc.scrub !== null ? " at" : ""}`} key={i}
              ref={i === Math.max(0, at - 1) ? cur : undefined} onClick={() => calc.setScrub(i + 1)}>
              <span className="dim">{String(i + 1).padStart(3, "0")}</span>
              <span>{formatEntry(e)}</span>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </div>
  );
}

/** The share link of the current tape (compressed, see qasm/share.ts). */
const shareUrl = async (calc: Calculator) => `${location.origin}${location.pathname}${await shareHash(calc.n, calc.tape, calc.scope, calc.bits)}`;

/**
 * TAPE ≡ → QR code: the share link as a QR code, full screen (it's for the
 * phones pointed at this one), dark on white whatever the theme; tap to close.
 */
function QrPane({ calc, done }: { calc: Calculator; done: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void shareUrl(calc).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [calc, calc.n, calc.tape, calc.scope]);
  const qr = useMemo(() => (url ? makeQr(url) : null), [url]);
  if (!url) return <div className="rows dim">…</div>;
  if (!qr) {
    return <div className="rows dim">This circuit's link is {url.length} characters; a QR code holds at most {QR_MAX.L}. Use Share link or Share QASM file instead.</div>;
  }
  const side = qr.size + 8;
  return (
    <div className="qr-overlay" role="dialog" aria-label="QR code of the share link" onClick={done}>
      <svg className="qr" viewBox={`0 0 ${side} ${side}`} role="img" aria-label="QR code" shapeRendering="crispEdges">
        <rect width={side} height={side} fill="#fff" />
        <path d={qrPath(qr)} fill="#000" />
      </svg>
      <p>Scan to open this circuit in QC-1: {calc.tape.length} steps, n={calc.n}.</p>
      <p className="qr-small">{url.length} characters · QR version {qr.version} · tap to close</p>
    </div>
  );
}

function TapeMenu({ calc, go }: { calc: Calculator; go: (p: TapePane) => void }) {
  const qasm = () => exportQasm3(calc.n, calc.tape, calc.bits);
  const shareLink = async () => {
    const url = await shareUrl(calc);
    try {
      if (navigator.share) {
        await navigator.share({ url, title: "QC-1 circuit" });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      calc.notify("link copied");
    } catch {
      calc.notify("copy blocked", "error");
    }
  };
  const rows: [string, string, () => void][] = [
    ["Examples…", `${EXAMPLE_COUNT} programs in ${EXAMPLE_CATEGORIES.length} topics`, () => go("examples")],
    ["Import QASM…", "paste OpenQASM 2/3 or open a file", () => go("import")],
    ["Copy QASM", "OpenQASM 3 of the circuit (Qiskit loads it)", () => { void copyText(calc, qasm()); go("circ"); }],
    ["Share QASM file", "qc1-circuit.qasm", () => { void shareQasm(calc, qasm()); go("circ"); }],
    ["Copy Qiskit (Python)", "a script that builds the QuantumCircuit", () => { void copyText(calc, qiskitPython(calc.n, calc.tape, calc.bits), "Qiskit script copied"); go("circ"); }],
    ["Share Qiskit file", "qc1-circuit.py", () => { void shareQasm(calc, qiskitPython(calc.n, calc.tape, calc.bits), "qc1-circuit.py"); go("circ"); }],
    ["Share link", "the circuit and symbol values in a URL", () => { void shareLink(); go("circ"); }],
    ["QR code", "the share link, for phones pointed at this screen", () => go("qr")],
    ["Report", `circuit, state${calc.pins.length ? `, ${calc.pins.length} pinned LAB result${calc.pins.length > 1 ? "s" : ""}` : ""}: print or save as PDF`, () => { calc.toggleReport(); go("circ"); }],
    ["Memory…", `save or load circuits in M1–M9${Object.keys(calc.memory).length ? ` (${Object.keys(calc.memory).length} used)` : ""}`, () => go("memory")],
    ["Define gate…", "the last steps (or the whole circuit) as a gate of your own", () => go("define")],
    ["Clear circuit", "back to |0…0⟩ (UNDO restores it)", () => { calc.clearCircuit(); go("circ"); }],
  ];
  return (
    <div className="rows">
      {rows.map(([label, note, act]) => (
        <button key={label} className="lab-item" onClick={act}>
          <span className="t">{label}</span>
          <span className="s">{note}</span>
        </button>
      ))}
    </div>
  );
}

/** Memory M1–M9: save the circuit in a slot, or load one (an undoable replace). */
function MemoryPane({ calc, done }: { calc: Calculator; done: () => void }) {
  return (
    <div className="rows">
      <div className="view-head lab-head"><button className="back" onClick={done} aria-label="Back">‹</button><span>Memory</span></div>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => {
        const m = calc.memory[k];
        return (
          <div key={k} className="mem-row">
            <span className="mem-name">M{k}</span>
            <span className="dim mem-what">{m ? `${m.tape.length} steps · ${m.n} qubits` : "empty"}</span>
            <button className="qb" onClick={() => { calc.store(k); }}>save here</button>
            <button className="qb" disabled={!m} onClick={() => { if (calc.recall(k)) done(); }}>load</button>
          </div>
        );
      })}
      <p className="dim note">Memory slots are kept with the session. LAB → Verification → Compare checks the circuit against a slot.</p>
    </div>
  );
}

/** Define gate: the last k steps, or the whole circuit, become a gate under the palette's "Your gates". */
function DefinePane({ calc, done }: { calc: Calculator; done: () => void }) {
  const [k, setK] = useState(String(calc.tape.length));
  const define = () => {
    const name = calc.defineGate(Number(k));
    if (name) { calc.notify(`${name} is in the palette under "Your gates"`); done(); }
  };
  return (
    <form className="rows" onSubmit={(e) => { e.preventDefault(); define(); }}>
      <div className="view-head lab-head"><button type="button" className="back" onClick={done} aria-label="Back">‹</button><span>Define a gate</span></div>
      <label className="define-row">the last <input type="number" inputMode="numeric" min={1} max={calc.tape.length} value={k}
        onChange={(e) => setK(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /> steps (of {calc.tape.length})</label>
      <button type="submit" className="qb sel" disabled={!calc.tape.length}>Define</button>
      <p className="dim note">The steps' qubits, in order, become the gate's qubits. Unitary steps only (no measurement, reset or preparation). Symbols stay symbols.</p>
    </form>
  );
}

function ExamplesPane({ calc, done }: { calc: Calculator; done: () => void }) {
  const [lit, setLit] = useState<{ file: string; text: string } | null>(null);
  const pick = async (file: string, title: string) => {
    if (lit?.file === file) {
      try {
        const notes = calc.loadQasm(lit.text, title);
        if (notes.length) calc.notify(notes[0]);
        done();
      } catch (e) {
        calc.notify(e instanceof Error ? e.message : String(e), "error");
      }
      return;
    }
    setLit({ file, text: await loadExample(file) });
  };
  // Load it scrubbed to the start, with the program's comments as captions (App's GuideBar).
  const stepThrough = (label: string) => {
    if (!lit) return;
    try {
      calc.loadQasm(lit.text, lit.file.replace(/\.qasm$/, ""), {}, { title: label, intro: describeProgram(lit.text) });
      calc.setMode("ket");
      done();
    } catch (e) {
      calc.notify(e instanceof Error ? e.message : String(e), "error");
    }
  };
  return (
    <div className="rows">
      {EXAMPLE_CATEGORIES.map((c) => (
        <div key={c.label}>
          <div className="cat-group">{c.label}</div>
          {c.items.map((it) => (
            <div key={it.file}>
              <button className={`cat-row${lit?.file === it.file ? " on" : ""}`} onClick={() => void pick(it.file, it.label)}>
                <span>{it.label}</span>
              </button>
              {lit?.file === it.file && (
                <p className="dim note example-desc" ref={(el) => el?.previousElementSibling?.scrollIntoView({ block: "start" })}>
                  <button className="guide-start" onClick={() => stepThrough(it.label)}>▶ step through</button>
                  {" "}<b>or tap the name again to load (UNDO restores)</b>
                  {"\n\n"}{describeProgram(lit.text) || lit.file}
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ImportPane({ calc, done }: { calc: Calculator; done: () => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = (src: string, label: string) => {
    try {
      const notes = calc.loadQasm(src, label);
      if (notes.length) calc.notify(notes[0]);
      done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="rows import-pane">
      <textarea value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} spellCheck={false}
        autoCapitalize="none" autoCorrect="off" placeholder={"OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[2] q;\nh q[0];\ncx q[0], q[1];"}
        aria-label="OpenQASM program" onKeyDown={(e) => e.stopPropagation()} />
      {err && <div className="lab-error">E: {err}</div>}
      <div className="lcd-btns">
        <button onClick={() => load(text, "import")} disabled={!text.trim()}>IMPORT</button>
        <button onClick={() => file.current?.click()}>FILE…</button>
        <button onClick={done}>CANCEL</button>
      </div>
      <input ref={file} type="file" accept=".qasm,.txt,text/plain" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) load(await f.text(), f.name.replace(/\.[^.]+$/, ""));
      }} />
    </div>
  );
}

/** Examples for the typed State… / Matrix… sheet. */
export const TYPED_PRESETS: Record<"state" | "matrix", [string, string][]> = {
  state: [["Bell", "(|00⟩ + |11⟩)/√2"], ["GHZ₃", "(|000⟩ + |111⟩)/√2"], ["W₃", "|001⟩ + |010⟩ + |100⟩"], ["|+i⟩", "|0⟩ + i|1⟩"]],
  matrix: [["H", "1/√2, 1/√2; 1/√2, -1/√2"], ["CZ", "1,0,0,0; 0,1,0,0; 0,0,1,0; 0,0,0,-1"], ["iSWAP", "1,0,0,0; 0,0,i,0; 0,i,0,0; 0,0,0,1"], ["√SWAP", "1,0,0,0; 0,(1+i)/2,(1-i)/2,0; 0,(1-i)/2,(1+i)/2,0; 0,0,0,1"]],
};

function Sphere({ v, ideal, r, labels, className, camera = DEFAULT_CAMERA }: { v: Vec3; ideal?: Vec3; r: number; labels?: boolean; className?: string; camera?: typeof DEFAULT_CAMERA }) {
  const c = r + (labels ? 14 : 2);
  const P = (x: number, y: number, z: number) => {
    const [sx, sy] = project(x, y, z, camera);
    return [c + sx * r, c - sy * r] as const;
  };
  // Equator as runs of points, split where it passes behind the sphere.
  const eq = (front: boolean) => {
    const runs: string[][] = [[]];
    for (let k = 0; k <= 64; k++) {
      const t = (k / 64) * 2 * Math.PI;
      const [, , d] = project(Math.cos(t), Math.sin(t), 0, camera);
      if (d >= 0 === front) runs[runs.length - 1].push(P(Math.cos(t), Math.sin(t), 0).join(","));
      else if (runs[runs.length - 1].length > 0) runs.push([]);
    }
    return runs.filter((r) => r.length > 1).map((r, i) => (
      <polyline key={i} points={r.join(" ")} className={front ? "eq" : "eq back"} />
    ));
  };
  const [tx, ty] = P(v.x, v.y, v.z);
  const reference = ideal ? P(ideal.x, ideal.y, ideal.z) : null;
  const len = Math.hypot(v.x, v.y, v.z);
  const axis = (x: number, y: number, z: number, label: string) => {
    const [ax, ay] = P(x, y, z);
    const [lx, ly] = P(x * 1.22, y * 1.22, z * 1.22);
    return (
      <g key={label}>
        <line x1={c} y1={c} x2={ax} y2={ay} className="axis" />
        {labels && <text x={lx} y={ly} className="axis-label">{label}</text>}
      </g>
    );
  };
  return (
    <svg
      className={className}
      width={className ? undefined : 2 * c}
      height={className ? undefined : 2 * c}
      viewBox={`0 0 ${2 * c} ${2 * c}`}
      aria-hidden="true"
    >
      <circle cx={c} cy={c} r={r} className="sphere" />
      {eq(false)}
      {eq(true)}
      {axis(1, 0, 0, "x")}
      {axis(0, 1, 0, "y")}
      {axis(0, 0, 1, "|0⟩")}
      {axis(0, 0, -1, "|1⟩")}
      {reference && <g className="bloch-ideal"><line x1={c} y1={c} x2={reference[0]} y2={reference[1]} /><circle cx={reference[0]} cy={reference[1]} r={5} /></g>}
      {len > 1e-6 && <line x1={c} y1={c} x2={tx} y2={ty} className="vec" />}
      <circle cx={tx} cy={ty} r={labels ? 4 : 2.5} className="tip" />
    </svg>
  );
}

/** Camera-only interaction: the simulator's vector is never edited. */
function InteractiveSphere({ v, ideal, qubit }: { v: Vec3; ideal?: Vec3; qubit: number }) {
  const [camera, setCamera] = useState(DEFAULT_CAMERA);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const rotate = (dx: number, dy: number) => setCamera(c => ({
    azimuth: c.azimuth + dx,
    elevation: Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, c.elevation + dy)),
  }));
  return <div className="bloch-sphere-row">
    <div className="sphere-controls">
      <div className="bloch-qubit-label">q{qubit}</div>
    </div>
    <div className="sphere-interactive" role="group" tabIndex={0}
      aria-label="Interactive Bloch sphere. Drag or use arrow keys to rotate the view. Home resets the view."
      onPointerDown={e => {
        if (!e.isPrimary || e.button !== 0) return;
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerMove={e => {
        const start = drag.current;
        if (!start || start.id !== e.pointerId) return;
        rotate(-(e.clientX - start.x) * 0.01, (e.clientY - start.y) * 0.01);
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={e => {
        if (drag.current?.id !== e.pointerId) return;
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={e => {
        const moves: Record<string, [number, number]> = { ArrowLeft: [0.1, 0], ArrowRight: [-0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] };
        if (e.key === "Home") { e.preventDefault(); e.stopPropagation(); setCamera(DEFAULT_CAMERA); }
        else if (moves[e.key]) { e.preventDefault(); e.stopPropagation(); rotate(...moves[e.key]); }
      }}>
      <Sphere v={v} ideal={ideal} r={62} labels className="sphere-main" camera={camera} />
    </div>
    <button className="sphere-reset" onClick={() => setCamera(DEFAULT_CAMERA)}>Reset view</button>
  </div>;
}

export function BlochView({ calc, data }: ViewProps<"bloch">) {
  const all = data.vectors;
  if (!all.length) return <div className="view"><p className="dim note">no Bloch vectors</p></div>;
  // A wide stabilizer register computes the first vectors only (work budget): never show a made-up one.
  const sel = calc.sel < all.length ? calc.sel : 0;
  const v = all[sel];
  const len = Math.hypot(v.x, v.y, v.z);
  const theta = Math.acos(Math.max(-1, Math.min(1, len > 1e-9 ? v.z / len : 1)));
  const phi = Math.atan2(v.y, v.x);
  const estimated = !!data.estimate || !!data.provenance?.method.includes("Trajectory");
  const ideal = calc.noiseOn && calc.blochCompare ? data.idealVectors?.[sel] : undefined;
  const at = calc.scrub ?? calc.tape.length;
  const shownAt = data.at ?? calc.tape.length;
  return (
    <div className="view bloch">
      <div className="bloch-main">
        {calc.tape.length > 0 && <div className="bloch-steps">
          <div className="scrubber">
            <button onClick={() => calc.setScrub(at - 1)} disabled={at === 0} aria-label="Step back">◀</button>
            <input type="range" min={0} max={calc.tape.length} value={at} aria-label="Show Bloch state after step" onChange={e => calc.setScrub(Number(e.target.value))} />
            <button onClick={() => calc.setScrub(at + 1)} disabled={at === calc.tape.length} aria-label="Step forward">▶</button>
          </div>
          <div className="note">Step {shownAt}/{calc.tape.length} · {shownAt === 0 ? "Initial state" : formatEntry(calc.tape[shownAt - 1] ?? [])}{shownAt !== at ? " · updating…" : ""}</div>
        </div>}
        <InteractiveSphere v={v} ideal={ideal} qubit={sel} />
        <div className="bloch-read">
          {data.estimate && data.errors ? <>
            <div>x {num(v.x)} <span className="dim">± {num(data.errors[sel].x)}</span></div>
            <div>y {num(v.y)} <span className="dim">± {num(data.errors[sel].y)}</span></div>
            <div>z {num(v.z)} <span className="dim">± {num(data.errors[sel].z)}</span></div>
          </> : <>
            <div>x {num(v.x)}</div>
            <div>y {num(v.y)}</div>
            <div>z {num(v.z)}</div>
          </>}
          <div>|r| {num(len)} · <strong>{blochStateLabel(len, estimated)}</strong></div>
          {!data.estimate && len > 1e-3 && <div className="dim">θ {num(theta / Math.PI)}π φ {num(phi / Math.PI)}π</div>}
          <p className="dim note">Each sphere describes one qubit. A shorter vector means a more mixed local state; the center is maximally mixed.</p>
          {data.n > 1 && <p className="dim note">Entanglement, noise, or averaging measurement outcomes can shorten the vector. A pure Bell pair has two centered vectors. These spheres alone cannot establish entanglement.</p>}
          {estimated && <p className="dim note">Sampling uncertainty prevents a definitive purity label from this vector alone.</p>}
          {calc.noiseOn && <div className="bloch-comparison">
            <label><input type="checkbox" checked={calc.blochCompare} onChange={e => calc.setBlochCompare(e.target.checked)} /> Compare ideal vector</label>
            {calc.blochCompare && (ideal ? <>
              <p className="note">Solid: {data.estimate ? "noisy estimate" : "noisy"} · dashed / ring: ideal ({data.idealMethod}, before readout)</p>
              <p className="note">Ideal x {num(ideal.x)} · y {num(ideal.y)} · z {num(ideal.z)} · |r| {num(Math.hypot(ideal.x, ideal.y, ideal.z))}</p>
            </> : <p className="note">Calculating ideal comparison…</p>)}
          </div>}
          {data.estimate && <p className="dim note">Estimated from three experiments of {data.estimate.shots.toLocaleString()} shots: every qubit measured in X, in Y and in Z (the SHOTS sample). |r| can exceed 1 by chance.</p>}
          {all.length < data.n && <p className="dim note">Bloch vectors for the first {all.length} of {data.n} qubits (each costs O(n²) on the tableau).</p>}
          <div className="minis">
            {all.map((b, q) => (
              <button key={q} className={`mini${q === sel ? " on" : ""}`} onClick={() => calc.select(q)} aria-label={`Select q${q}`}>
                <Sphere v={b} r={13} />
                <span>q{q}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
