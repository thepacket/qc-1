import { useEffect, useMemo, useRef } from "react";
import type { Calculator } from "../calc/calculator";
import { layoutTape, usedQubits, type Placed } from "../calc/diagram";
import { gateLabel, MEASURE_IDS, type Entry } from "../calc/steps";
import { elementToSvg, saveSvg } from "./svgExport";

/** Diagram limits: beyond these the LIST pane is the readable form. */
export const DIAGRAM_MAX_QUBITS = 128; // wires; the pane scrolls both ways
const MAX_STEPS = 4000;

const ROW = 24; // wire spacing
const TOP = 14; // room for IF labels
const CH = 6.6; // mono character width at 11px
const BOX_H = 18;

/** Width a step needs in its column. */
function need(s: Placed["step"]): number {
  if (s.gateId === "x" && s.controls.length) return 20;
  if (s.gateId === "swap") return 20;
  const text = label(s);
  return Math.max(20, text.length * CH + 10);
}

const label = (s: Placed["step"]) => (s.gateId === "measure" ? "M" : gateLabel(s));

/** TAPE's CIRC pane: the tape drawn as a circuit; tap a gate to scrub to it. */
export function CircuitView({ calc }: { calc: Calculator }) {
  return <CircuitDiagram n={calc.n} tape={calc.tape} scrub={calc.scrub} onTap={(k) => calc.setScrub(k)} />;
}

/** The diagram itself (also the session report's figure): `scrub` dims what lies ahead; `onTap` gets the step count to scrub to. */
export function CircuitDiagram({ n, tape, scrub, onTap }: { n: number; tape: Entry[]; scrub: number | null; onTap?: (k: number) => void }) {
  const at = scrub ?? tape.length;
  const steps = useMemo(() => tape.reduce((k, e) => k + e.length, 0), [tape]);
  // A wide register draws only the wires the tape touches.
  const wires = useMemo(() => (n <= DIAGRAM_MAX_QUBITS ? null : usedQubits(tape)), [n, tape]);
  const tooWide = wires !== null && wires.length > DIAGRAM_MAX_QUBITS;
  const lay = useMemo(() => (!tooWide && steps <= MAX_STEPS ? layoutTape(n, tape, wires ?? undefined) : null), [n, tape, wires, tooWide, steps]);
  const geo = useMemo(() => {
    if (!lay) return null;
    const w = new Array<number>(lay.cols).fill(20);
    for (const it of lay.items) w[it.col] = Math.max(w[it.col], need(it.step));
    const x = [8];
    for (let c = 0; c < lay.cols; c++) x.push(x[c] + w[c] + 8);
    return { w, x };
  }, [lay]);
  const box = useRef<HTMLDivElement>(null);
  const curCol = lay?.items.filter((it) => it.entry === at - 1).reduce((m, it) => Math.max(m, it.col), -1) ?? -1;
  useEffect(() => {
    const el = box.current;
    if (!el || !geo) return;
    // The current step's column; before the first step, the start.
    const cx = curCol >= 0 ? geo.x[curCol] + geo.w[curCol] / 2 : at === 0 ? 0 : geo.x[geo.x.length - 1];
    if (cx < el.scrollLeft + 20 || cx > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = cx - el.clientWidth / 2;
  }, [curCol, geo, at]);

  if (tape.length === 0) return <div className="rows dim">empty: key some gates</div>;
  if (!lay || !geo) {
    return <div className="rows dim">{tooWide ? `the diagram shows up to ${DIAGRAM_MAX_QUBITS} wires (the circuit uses ${wires!.length})` : `the diagram shows up to ${MAX_STEPS} steps`}: see LIST</div>;
  }
  const rows = lay.wires.length;
  const H = TOP + rows * ROW;
  const W = geo.x[geo.x.length - 1];
  const y = (r: number) => TOP + r * ROW + ROW / 2;
  const rowOf = new Map(lay.wires.map((q, r) => [q, r]));
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<SVGSVGElement>(null);
  const save = () => root.current && main.current && void saveSvg(elementToSvg(root.current, [main.current]), "qc1-circuit.svg");
  return (
    <div className="circ" ref={root}>
      <button className="svg-btn" onClick={save} aria-label="Save the circuit as SVG">SVG</button>
      <svg className="circ-labels" width={30} height={H} aria-hidden>
        {lay.wires.map((q, r) => (
          <text key={q} x={26} y={y(r) + 4} textAnchor="end">q{q}</text>
        ))}
      </svg>
      <div className="circ-scroll" ref={box}>
        <svg ref={main} width={W} height={H} role="img" aria-label={`Circuit: ${tape.length} steps on ${n} qubits`}>
          {lay.wires.map((q, r) => (
            <line key={q} className="wire" x1={0} x2={W} y1={y(r)} y2={y(r)} />
          ))}
          {lay.items.map((it, k) => (
            <Gate key={k} it={it} row={(q) => rowOf.get(q)!} x={geo.x[it.col] + geo.w[it.col] / 2} y={y}
              state={it.entry >= at ? "ahead" : it.entry === at - 1 && scrub !== null ? "at" : ""}
              onTap={() => onTap?.(it.entry + 1)} />
          ))}
        </svg>
      </div>
    </div>
  );
}

function Gate({ it, x, y: yRow, row, state, onTap }: { it: Placed; x: number; y: (r: number) => number; row: (q: number) => number; state: string; onTap: () => void }) {
  const s = it.step;
  const y = (q: number) => yRow(row(q)); // by qubit
  const yr = yRow; // by row
  const ctrl = new Set(s.controls);
  const cnot = s.gateId === "x" && s.controls.length > 0;
  const text = label(s);
  const bw = Math.max(20, text.length * CH + 10);
  return (
    <g className={`gate ${state}`} onClick={onTap}>
      <title>{`${it.entry + 1}: ${text}`}</title>
      {/* a hit area wider than the marks */}
      <rect className="hit" x={x - bw / 2 - 3} y={yr(it.lo) - ROW / 2} width={bw + 6} height={(it.hi - it.lo + 1) * ROW} />
      {it.hi > it.lo && <line className="link" x1={x} x2={x} y1={yr(it.lo)} y2={yr(it.hi)} />}
      {s.controls.map((q, i) => (
        <circle key={`c${q}`} className={s.controlStates?.[i] === false ? "ctl open" : "ctl"} cx={x} cy={y(q)} r={4} />
      ))}
      {s.targets.map((q) => {
        if (ctrl.has(q)) return null;
        if (cnot) return (
          <g key={q}>
            <circle className="oplus" cx={x} cy={y(q)} r={8} />
            <line className="oplus" x1={x - 8} x2={x + 8} y1={y(q)} y2={y(q)} />
            <line className="oplus" x1={x} x2={x} y1={y(q) - 8} y2={y(q) + 8} />
          </g>
        );
        if (s.gateId === "swap") return <text key={q} className="swapx" x={x} y={y(q) + 5} textAnchor="middle">×</text>;
        const measured = MEASURE_IDS.has(s.gateId) && s.gateId !== "reset";
        return (
          <g key={q}>
            <rect className={`box${measured ? " meas" : ""}${s.condition ? " cond" : ""}`} x={x - bw / 2} y={y(q) - BOX_H / 2} width={bw} height={BOX_H} rx={3} />
            <text className="glabel" x={x} y={y(q) + 4} textAnchor="middle">{text}</text>
            {measured && s.outcome !== undefined && <text className="outcome" x={x + bw / 2 - 1} y={y(q) + BOX_H / 2 + 8} textAnchor="end">{s.outcome}</text>}
          </g>
        );
      })}
      {s.condition && <text className="iflabel" x={x} y={yr(it.lo) - BOX_H / 2 - 2} textAnchor="middle">c{s.condition.clbit}={s.condition.value}</text>}
    </g>
  );
}
