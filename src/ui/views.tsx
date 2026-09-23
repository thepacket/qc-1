import { useEffect, useMemo, useRef, useState } from "react";
import type { Calculator } from "../calc/calculator";
import { KET_ROWS, type ViewData } from "../calc/core";
import { formatEntry } from "../calc/steps";
import { CATALOG } from "../calc/catalog";
import { exportQasm3 } from "../qasm/fromTape";
import type { Vec3 } from "../calc/analysis";
import { complex, ket, num, pct } from "./format";

type ViewProps<M extends ViewData["mode"]> = { calc: Calculator; data: Extract<ViewData, { mode: M }> };

export function Pending() {
  return (
    <div className="view">
      <div className="view-head">…</div>
    </div>
  );
}

export function KetView({ data }: ViewProps<"ket">) {
  const { n, rows, nonzero } = data;
  return (
    <div className="view">
      <div className="view-head">
        {nonzero === 1 ? "basis state" : `${nonzero.toLocaleString()} terms`}
        {nonzero > KET_ROWS && ` · top ${KET_ROWS}`}
      </div>
      <div className="rows">
        {rows.map(({ i, re, im }) => (
          <div className="row" key={i}>
            <span className="amp">{complex(re, im)}</span>
            <span className="ket">{ket(i, n)}</span>
            <span className="dim">{pct(re * re + im * im)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bars({ items, head }: { items: { label: string; p: number; note: string }[]; head: string }) {
  const max = Math.max(1e-12, ...items.map((x) => x.p));
  return (
    <div className="view">
      <div className="view-head">{head}</div>
      <div className="rows">
        {items.map((x) => (
          <div className="bar-row" key={x.label}>
            <span className="ket">{x.label}</span>
            <span className="bar"><span style={{ width: `${(x.p / max) * 100}%` }} /></span>
            <span className="dim">{x.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProbView({ data }: ViewProps<"prob">) {
  const items = data.rows.map(({ i, p }) => ({ label: ket(i, data.n), p, note: pct(p) }));
  return <Bars items={items} head={data.complete ? "P(basis)" : `most likely ${items.length}`} />;
}

export function ShotsView({ data }: ViewProps<"shots">) {
  const items = data.rows.map(({ i, count }) => ({ label: ket(i, data.n), p: count, note: String(count) }));
  return <Bars items={items} head={`${data.shots.toLocaleString()} shots · ${data.distinct} outcomes · tap SHOTS to re-roll`} />;
}

async function copyText(calc: Calculator, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    calc.notify("QASM copied");
  } catch {
    calc.notify("copy blocked", "error");
  }
}

async function shareQasm(calc: Calculator, text: string) {
  const name = "qc1-tape.qasm";
  const file = new File([text], name, { type: "text/plain" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "QC-1 tape" });
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

export function TapeView({ calc }: { calc: Calculator }) {
  const [asQasm, setAsQasm] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const tape = calc.tape;
  const text = useMemo(() => (asQasm ? exportQasm3(calc.n, tape) : ""), [asQasm, calc.n, tape]);
  useEffect(() => {
    if (!asQasm) end.current?.scrollIntoView({ block: "end" });
  }, [tape, asQasm]);
  return (
    <div className="view">
      <div className="view-head tape-head">
        <span>{tape.length} steps</span>
        <span className="lcd-btns">
          <button className={asQasm ? "" : "on"} onClick={() => setAsQasm(false)}>LIST</button>
          <button className={asQasm ? "on" : ""} onClick={() => setAsQasm(true)}>QASM</button>
          <button onClick={() => copyText(calc, exportQasm3(calc.n, tape))}>COPY</button>
          <button onClick={() => shareQasm(calc, exportQasm3(calc.n, tape))}>SHARE</button>
        </span>
      </div>
      {asQasm ? (
        <pre className="rows qasm">{text}</pre>
      ) : (
        <div className="rows">
          {tape.length === 0 && <div className="dim">empty — every key press is recorded here</div>}
          {tape.map((e, i) => (
            <div className="row tape-row" key={i}>
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

export function CatalogView({ calc }: { calc: Calculator }) {
  const { index } = calc.catalog;
  const lit = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    lit.current?.scrollIntoView({ block: "nearest" });
  }, [index]);
  const cur = CATALOG[index];
  const partners = cur.arity - 1;
  return (
    <div className="view">
      <div className="view-head cat-head">
        {cur.note}
        {partners > 0 && ` · CTRL-mark ${partners === 1 ? "a partner" : `${partners} qubits`}`}
      </div>
      <div className="rows">
        {CATALOG.map((it, i) => (
          <div key={it.gate}>
            {(i === 0 || CATALOG[i - 1].group !== it.group) && <div className="cat-group">{it.group}</div>}
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

// Oblique projection for the Bloch sphere: x toward the viewer (lower left),
// y right, z up.
const AZ = (25 * Math.PI) / 180;
const EL = (15 * Math.PI) / 180;
function project(x: number, y: number, z: number): [number, number, number] {
  const sx = y * Math.cos(AZ) - x * Math.sin(AZ);
  const depth = x * Math.cos(AZ) + y * Math.sin(AZ);
  const sy = z * Math.cos(EL) - depth * Math.sin(EL);
  return [sx, sy, depth * Math.cos(EL) + z * Math.sin(EL)];
}

function Sphere({ v, r, labels }: { v: Vec3; r: number; labels?: boolean }) {
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
    <svg width={2 * c} height={2 * c} viewBox={`0 0 ${2 * c} ${2 * c}`} aria-hidden="true">
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
  const v = all[calc.sel] ?? { x: 0, y: 0, z: 1 };
  const len = Math.hypot(v.x, v.y, v.z);
  const theta = Math.acos(Math.max(-1, Math.min(1, len > 1e-9 ? v.z / len : 1)));
  const phi = Math.atan2(v.y, v.x);
  return (
    <div className="view bloch">
      <div className="bloch-main">
        <Sphere v={v} r={62} labels />
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
