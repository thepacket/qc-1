import { CircuitView } from "./CircuitView";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Calculator } from "../calc/calculator";
import type { ViewData } from "../calc/core";
import { formatEntry } from "../calc/steps";
import { exportQasm3 } from "../qasm/fromTape";
import { shareHash } from "../qasm/share";
import { makeQr, qrPath, QR_MAX } from "../qasm/qr";
import { qiskitPython } from "../qasm/toQiskit";
import { EXAMPLE_CATEGORIES, EXAMPLE_COUNT, describeProgram, loadExample } from "../examples";
import type { Vec3 } from "../calc/analysis";
import { complex, ket, num, pct } from "./format";
import { project } from "./charts/sphere";

type ViewProps<M extends ViewData["mode"]> = { calc: Calculator; data: Extract<ViewData, { mode: M }> };

export function Pending() {
  return (
    <div className="view">
      <div className="view-head">…</div>
    </div>
  );
}

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

export function KetView({ data }: ViewProps<"ket">) {
  const { n, rows, nonzero } = data;
  if (data.generators) {
    return (
      <div className="view">
        <div className="view-head">stabilizer state · {n} generators</div>
        <RowList items={data.generators} row={(g, i) => <div className="row gen-row" key={i}><span className="dim">g{i + 1}</span><span className="ket">{g}</span></div>} />
      </div>
    );
  }
  return (
    <div className="view">
      <div className="view-head">
        {nonzero === 1 ? "basis state" : `${nonzero.toLocaleString()} terms`}
        {nonzero > rows.length && ` · the ${rows.length.toLocaleString()} largest; the other ${(nonzero - rows.length).toLocaleString()} hold ${pct(data.restP)}`}
      </div>
      <RowList items={rows} row={({ i, re, im }) => (
        <div className="row" key={i}>
          <span className="amp">{complex(re, im)}</span>
          <span className="ket">{ket(i, n)}</span>
          <span className="dim">{pct(re * re + im * im)}</span>
        </div>
      )} />
    </div>
  );
}

function Bars({ items, head }: { items: { label: string; p: number; note: string }[]; head: string }) {
  const max = items.reduce((m, x) => Math.max(m, x.p), 1e-12); // (no spread: lists can be long)
  return (
    <div className="view">
      <div className="view-head">{head}</div>
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
    const items = data.marginals.map((p, q) => ({ label: `q${q}`, p, note: pct(p) }));
    return <Bars items={items} head={`P(qᵢ = 1) · stabilizer state${data.n > items.length ? ` · first ${items.length} of ${data.n} qubits (work budget)` : ""}`} />;
  }
  const items = data.rows.map(({ i, p }) => ({ label: ket(i, data.n), p, note: pct(p) }));
  // Every bit of probability is accounted for: what isn't listed is one last row.
  if (!data.complete && data.restP > 1e-9) items.push({ label: "all other outcomes", p: data.restP, note: pct(data.restP) });
  return <Bars items={items} head={data.complete ? "P(basis)" : `the ${data.rows.length.toLocaleString()} most likely + the rest`} />;
}

export function ShotsView({ data }: ViewProps<"shots">) {
  const items = data.rows.map(({ i, count, bits }) => ({ label: bits ? (bits.length > 24 ? `${bits.slice(0, 24)}…` : bits) : ket(i, data.n), p: count, note: String(count) }));
  // Every shot is accounted for: outcomes beyond the listed ones are summed in one last row.
  if (data.other > 0) items.push({ label: `${(data.distinct - data.rows.length).toLocaleString()} other outcomes`, p: data.other, note: String(data.other) });
  const shots = data.requested ? `${data.shots.toLocaleString()} shots (of ${data.requested.toLocaleString()}: the budget at n = ${data.n})` : `${data.shots.toLocaleString()} shots`;
  return <Bars items={items} head={`${shots} · ${data.distinct.toLocaleString()} outcomes · tap SHOTS to re-roll`} />;
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

type TapePane = "list" | "circ" | "qasm" | "menu" | "examples" | "import" | "qr";

export function TapeView({ calc }: { calc: Calculator }) {
  const [pane, setPane] = useState<TapePane>("list");
  const end = useRef<HTMLDivElement>(null);
  const tape = calc.tape;
  const text = useMemo(() => (pane === "qasm" ? exportQasm3(calc.n, tape) : ""), [pane, calc.n, tape]);
  const at = calc.scrub ?? tape.length;
  const cur = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pane !== "list") return;
    (calc.scrub === null ? end : cur).current?.scrollIntoView({ block: calc.scrub === null ? "end" : "nearest" });
  }, [tape, pane, calc.scrub]);
  const tab = (p: TapePane, label: string) => (
    <button className={pane === p ? "on" : ""} onClick={() => setPane(pane === p && p === "menu" ? "list" : p)}>{label}</button>
  );
  return (
    <div className="view">
      <div className="view-head tape-head">
        <span>{tape.length} steps</span>
        <span className="lcd-btns">
          {tab("list", "LIST")}
          {tab("circ", "DRAW")}
          {tab("qasm", "QASM")}
          {tab("menu", "≡")}
        </span>
      </div>
      {pane === "menu" && <TapeMenu calc={calc} go={setPane} />}
      {pane === "qr" && <QrPane calc={calc} done={() => setPane("menu")} />}
      {pane === "examples" && <ExamplesPane calc={calc} done={() => setPane("list")} />}
      {pane === "import" && <ImportPane calc={calc} done={() => setPane("list")} />}
      {(pane === "list" || pane === "circ") && tape.length > 0 && (
        <div className="scrubber">
          <button onClick={() => calc.setScrub(at - 1)} disabled={at === 0} aria-label="Step back">◀</button>
          <input type="range" min={0} max={tape.length} value={at} aria-label="Show the state after step"
            onChange={(e) => calc.setScrub(Number(e.target.value))} />
          <button onClick={() => calc.setScrub(at + 1)} disabled={at >= tape.length} aria-label="Step forward">▶</button>
          <span className="dim">{calc.scrub === null ? "live" : `@${at} · insert`}</span>
          <button className="del" onClick={() => calc.deleteStep()} disabled={at === 0} aria-label={`Delete step ${at}`}>DEL</button>
        </div>
      )}
      {pane === "circ" && <CircuitView calc={calc} />}
      {pane === "qasm" && <pre className="rows qasm">{text}</pre>}
      {pane === "list" && (
        <div className="rows">
          {tape.length === 0 && <div className="dim">empty — every key press is recorded here (≡ for examples and import)</div>}
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
const shareUrl = async (calc: Calculator) => `${location.origin}${location.pathname}${await shareHash(calc.n, calc.tape, calc.scope)}`;

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
  const qasm = () => exportQasm3(calc.n, calc.tape);
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
    ["Copy QASM", "OpenQASM 3 of the circuit (Qiskit loads it)", () => { void copyText(calc, qasm()); go("list"); }],
    ["Share QASM file", "qc1-circuit.qasm", () => { void shareQasm(calc, qasm()); go("list"); }],
    ["Copy Qiskit (Python)", "a script that builds the QuantumCircuit", () => { void copyText(calc, qiskitPython(calc.n, calc.tape), "Qiskit script copied"); go("list"); }],
    ["Share Qiskit file", "qc1_tape.py", () => { void shareQasm(calc, qiskitPython(calc.n, calc.tape), "qc1_tape.py"); go("list"); }],
    ["Share link", "the circuit and symbol values in a URL", () => { void shareLink(); go("list"); }],
    ["QR code", "the share link, for phones pointed at this screen", () => go("qr")],
    ["Report", `circuit, state${calc.pins.length ? `, ${calc.pins.length} pinned LAB result${calc.pins.length > 1 ? "s" : ""}` : ""}: print or save as PDF`, () => { calc.toggleReport(); go("list"); }],
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

function ExamplesPane({ calc, done }: { calc: Calculator; done: () => void }) {
  const [lit, setLit] = useState<{ file: string; text: string } | null>(null);
  const pick = async (file: string) => {
    if (lit?.file === file) {
      try {
        const notes = calc.loadQasm(lit.text, file.replace(/\.qasm$/, ""));
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
              <button className={`cat-row${lit?.file === it.file ? " on" : ""}`} onClick={() => void pick(it.file)}>
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

export function CatalogView({ calc }: { calc: Calculator }) {
  const { index } = calc.catalog;
  const lit = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    lit.current?.scrollIntoView({ block: "nearest" });
  }, [index]);
  const items = calc.catalogItems;
  const cur = items[index];
  const partners = cur.arity - 1;
  if (calc.catalog.typing) return <TypedField calc={calc} kind={calc.catalog.typing} />;
  return (
    <div className="view">
      <div className="view-head cat-head">
        {cur.note}
        {partners > 0 && ` · CTRL-mark ${partners === 1 ? "a partner" : `${partners} qubits`}`}
      </div>
      <div className="rows">
        {items.map((it, i) => (
          <div key={it.gate}>
            {(i === 0 || items[i - 1].group !== it.group) && <div className="cat-group">{it.group}</div>}
            <button
              ref={i === index ? lit : undefined}
              className={`cat-row${i === index ? " on" : ""}`}
              onClick={() => calc.pickCatalog(i)}
            >
              <span>{it.label}{it.argNames.length > 0 && `(${it.argNames.join(",")})`}</span>
              <span className="dim">{it.arity > 1 ? `${it.arity}q` : ""}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const TYPED_PRESETS: Record<"state" | "matrix", [string, string][]> = {
  state: [["Bell", "(|00⟩ + |11⟩)/√2"], ["GHZ₃", "(|000⟩ + |111⟩)/√2"], ["W₃", "|001⟩ + |010⟩ + |100⟩"], ["|+i⟩", "|0⟩ + i|1⟩"]],
  matrix: [["H", "1/√2, 1/√2; 1/√2, -1/√2"], ["CZ", "1,0,0,0; 0,1,0,0; 0,0,1,0; 0,0,0,-1"], ["iSWAP", "1,0,0,0; 0,0,i,0; 0,i,0,0; 0,0,0,1"], ["√SWAP", "1,0,0,0; 0,(1+i)/2,(1-i)/2,0; 0,(1-i)/2,(1+i)/2,0; 0,0,0,1"]],
};

/** CATALOG → STATE… / MATRIX…: the phone keyboard's text becomes a gate (calc/typed.ts). */
function TypedField({ calc, kind }: { calc: Calculator; kind: "state" | "matrix" }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ok = () => {
    try {
      calc.enterTyped(text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="view">
      <div className="view-head lab-head">
        <button className="back" onClick={() => calc.cancelTyped()} aria-label="Back to the catalog">‹</button>
        <span>{kind === "state" ? "Type a state" : "Type a matrix"}</span>
      </div>
      <div className="rows typed">
        <textarea value={text} rows={kind === "matrix" ? 4 : 2} autoFocus spellCheck={false} autoCapitalize="off" autoCorrect="off"
          placeholder={kind === "state" ? "(|00⟩ + |11⟩)/√2   or   1, 0, 0, i" : "rows by ; or new lines, entries by ,\n0, 1; 1, 0"}
          aria-label={kind === "state" ? "State" : "Matrix"}
          onChange={(e) => { setText(e.target.value); setErr(null); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && kind === "state") { e.preventDefault(); ok(); } }} />
        <div className="cut-picker">
          {TYPED_PRESETS[kind].map(([label, t]) => <button key={label} className="qb" onClick={() => { setText(t); setErr(null); }}>{label}</button>)}
          <span className="grow" />
          <button className="qb sel" onClick={ok}>OK</button>
        </div>
        {err && <div className="lab-error">E: {err}</div>}
        <p className="dim note">{kind === "state"
          ? "Kets |bits⟩ with coefficients (i, √2, fractions), or 2ⁿ amplitudes. Normalised. Goes on the CTRL-marked qubits and the selected one, else q0…, after resetting them."
          : "A unitary up to 16×16, complex entries like 0.5+0.5i. Close to unitary (1e−3) is enough: it is made exact. Becomes a gate on the CTRL-marked qubits and the selected one, else q0…; the first is the most significant."}</p>
      </div>
    </div>
  );
}

function Sphere({ v, r, labels, className }: { v: Vec3; r: number; labels?: boolean; className?: string }) {
  const c = r + (labels ? 14 : 2);
  const P = (x: number, y: number, z: number) => {
    const [sx, sy] = project(x, y, z);
    return [c + sx * r, c - sy * r] as const;
  };
  // Equator as runs of points, split where it passes behind the sphere.
  const eq = (front: boolean) => {
    const runs: string[][] = [[]];
    for (let k = 0; k <= 64; k++) {
      const t = (k / 64) * 2 * Math.PI;
      const [, , d] = project(Math.cos(t), Math.sin(t), 0);
      if (d >= 0 === front) runs[runs.length - 1].push(P(Math.cos(t), Math.sin(t), 0).join(","));
      else if (runs[runs.length - 1].length > 0) runs.push([]);
    }
    return runs.filter((r) => r.length > 1).map((r, i) => (
      <polyline key={i} points={r.join(" ")} className={front ? "eq" : "eq back"} />
    ));
  };
  const [tx, ty] = P(v.x, v.y, v.z);
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
      {len > 1e-6 && <line x1={c} y1={c} x2={tx} y2={ty} className="vec" />}
      <circle cx={tx} cy={ty} r={labels ? 4 : 2.5} className="tip" />
    </svg>
  );
}

export function BlochView({ calc, data }: ViewProps<"bloch">) {
  const all = data.vectors;
  // A wide stabilizer register computes the first vectors only (work budget): never show a made-up one.
  if (calc.sel >= all.length) {
    return <div className="view"><p className="dim note">q{calc.sel}: Bloch vectors are computed for the first {all.length} of {data.n} qubits here (each costs O(n²) on the tableau). Select q0–q{all.length - 1}.</p></div>;
  }
  const v = all[calc.sel];
  const len = Math.hypot(v.x, v.y, v.z);
  const theta = Math.acos(Math.max(-1, Math.min(1, len > 1e-9 ? v.z / len : 1)));
  const phi = Math.atan2(v.y, v.x);
  return (
    <div className="view bloch">
      <div className="bloch-main">
        <Sphere v={v} r={62} labels className="sphere-main" />
        <div className="bloch-read">
          <div className="big">q{calc.sel}</div>
          <div>x {num(v.x)}</div>
          <div>y {num(v.y)}</div>
          <div>z {num(v.z)}</div>
          <div className="dim">|r| {num(len)}{len < 0.999 ? " mixed" : ""}</div>
          {len > 1e-3 && <div className="dim">θ {num(theta / Math.PI)}π φ {num(phi / Math.PI)}π</div>}
        </div>
      </div>
      <div className="minis">
        {all.map((b, q) => (
          <button key={q} className={`mini${q === calc.sel ? " on" : ""}`} onClick={() => calc.select(q)} aria-label={`Select q${q}`}>
            <Sphere v={b} r={13} />
            <span>q{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
