import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { Calculator } from "../calc/calculator";
import { layoutTape, usedQubits, type Placed } from "../calc/diagram";
import { insertionIndex } from "../calc/diagEdit";
import { formatEntry, gateLabel, MEASURE_IDS, type Entry } from "../calc/steps";
import { elementToSvg, saveSvg } from "./svgExport";

/** Diagram limits: beyond these the STEP pane is the readable form. */
export const DIAGRAM_MAX_QUBITS = 1024; // wires; the pane scrolls both ways
const MAX_STEPS = 20000;

const ROW = 24; // wire spacing
const TOP = 14; // room for IF labels
const CH = 6.6; // mono character width at 11px
const BOX_H = 18;
const LONG_PRESS_MS = 350;

/** Width a step needs in its column. */
function need(s: Placed["step"]): number {
  if (s.gateId === "x" && s.controls.length) return 20;
  if (s.gateId === "swap") return 20;
  const text = label(s);
  return Math.max(20, text.length * CH + 10);
}

const label = (s: Placed["step"]) => (s.gateId === "measure" ? "M" : gateLabel(s));

/** What the editor needs from the diagram (absent in the report's read-only copy). */
type Edit = {
  sel: number | null; ctrlPick: boolean; cursorQubit: number;
  onGate: (entry: number) => void;
  onWire: (q: number, at: number) => void;
  onDrop: (entry: number, items: Placed[], col: number, dq: number) => void;
};

/**
 * CIRC → DIAG: the circuit drawn, and edited. Tap a wire to place the
 * insertion point there (the next gate key goes there); tap a gate to select
 * it (the action bar moves, re-targets, re-parameterises or deletes it; a
 * gate key changes it); long-press a gate and drag it to move it in time or
 * to another wire. Every edit is one UNDO.
 */
export function CircuitView({ calc }: { calc: Calculator }) {
  const sel = calc.diagSel;
  const e = sel !== null ? calc.tape[sel] : undefined;
  return (
    <>
      {e && (
        <div className="diag-bar" role="toolbar" aria-label="Selected gate">
          <span className="diag-sel">{sel! + 1}: {formatEntry(e)}</span>
          <button onClick={() => calc.moveSelected(-1)} aria-label="Move earlier">◀</button>
          <button onClick={() => calc.moveSelected(1)} aria-label="Move later">▶</button>
          <button onClick={() => calc.shiftSelected(-1)} aria-label="Move up a wire">▲</button>
          <button onClick={() => calc.shiftSelected(1)} aria-label="Move down a wire">▼</button>
          {e[0].params.length > 0 && <button onClick={() => calc.setSelectedParams()} aria-label="Set the angle from the typed number">angle</button>}
          <button className={calc.ctrlPick ? "on" : ""} onClick={() => calc.toggleCtrlPick()} aria-pressed={calc.ctrlPick} aria-label="Add or remove a control: then tap a wire">± ctrl</button>
          <button className="del" onClick={() => calc.deleteSelected()} aria-label="Delete the gate">DEL</button>
          <button onClick={() => calc.selectStep(null)} aria-label="Deselect">✕</button>
        </div>
      )}
      {e && <div className="diag-hint dim">{calc.ctrlPick ? "tap a wire to add or remove a control" : "a gate key replaces it · type a number, then angle · long-press a gate to drag"}</div>}
      <CircuitDiagram n={calc.n} tape={calc.tape} scrub={calc.scrub}
        edit={{
          sel, ctrlPick: calc.ctrlPick, cursorQubit: calc.sel,
          onGate: (i) => calc.selectStep(sel === i ? null : i),
          onWire: (q, at) => calc.tapWire(q, at),
          onDrop: (i, items, col, dq) => calc.dropStep(i, items, col, dq),
        }} />
    </>
  );
}

/** The diagram (also the session report's read-only figure): `scrub` dims what lies ahead. */
export function CircuitDiagram({ n, tape, scrub, edit }: { n: number; tape: Entry[]; scrub: number | null; edit?: Edit }) {
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
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ entry: number; dx: number; dy: number } | null>(null);
  const press = useRef<{ entry: number; x0: number; y0: number; timer: number; dragging: boolean; moved: boolean } | null>(null);

  const curCol = lay?.items.filter((it) => it.entry === at - 1).reduce((m, it) => Math.max(m, it.col), -1) ?? -1;
  useEffect(() => {
    const el = box.current;
    if (!el || !geo) return;
    // The current step's column; before the first step, the start.
    const cx = curCol >= 0 ? geo.x[curCol] + geo.w[curCol] / 2 : at === 0 ? 0 : geo.x[geo.x.length - 1];
    if (cx < el.scrollLeft + 20 || cx > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = cx - el.clientWidth / 2;
  }, [curCol, geo, at]);

  // While a gate is dragged, the page must not scroll under the finger (only a non-passive listener can say so).
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const stop = (ev: TouchEvent) => { if (press.current?.dragging) ev.preventDefault(); };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  });

  if (!lay || !geo) {
    return <div className="rows dim">{tooWide ? `the diagram shows up to ${DIAGRAM_MAX_QUBITS} wires (the circuit uses ${wires!.length})` : `the diagram shows up to ${MAX_STEPS} steps`}: see STEP</div>;
  }
  if (!edit && tape.length === 0) return <div className="rows dim">empty</div>;
  const rows = lay.wires.length;
  const H = TOP + rows * ROW;
  // Room after the last gate to tap (append) when editing.
  const W = edit ? Math.max(geo.x[geo.x.length - 1] + 60, 240) : geo.x[geo.x.length - 1];
  const y = (r: number) => TOP + r * ROW + ROW / 2;
  const rowOf = new Map(lay.wires.map((q, r) => [q, r]));
  const save = () => root.current && main.current && void saveSvg(elementToSvg(root.current, [main.current]), "qc1-circuit.svg");

  /** The insertion column an x falls at: before the first column whose middle is to its right. */
  const colAt = (x: number) => {
    for (let c = 0; c < lay.cols; c++) if (x < geo.x[c] + geo.w[c] / 2) return c;
    return lay.cols;
  };
  const svgX = (clientX: number) => clientX - main.current!.getBoundingClientRect().left;

  // The insertion point, on the selected wire: after its last gate before `at` (the next gate key lands there).
  const curRow = edit ? rowOf.get(edit.cursorQubit) : undefined;
  const lastBefore = lay.items.filter((it) => it.entry < at && curRow !== undefined && it.lo <= curRow && curRow <= it.hi).reduce((m, it) => Math.max(m, it.col), -1);
  const markX = geo.x[lastBefore + 1] - 4;
  const showMark = !!edit && edit.sel === null && (scrub !== null || tape.length === 0);

  const onDown = (ev: RPointerEvent, entry: number) => {
    if (!edit) return;
    const timer = window.setTimeout(() => {
      if (!press.current || press.current.moved) return;
      press.current.dragging = true;
      setDrag({ entry, dx: 0, dy: 0 });
      try { navigator.vibrate?.(10); } catch { /* none */ }
    }, LONG_PRESS_MS);
    press.current = { entry, x0: ev.clientX, y0: ev.clientY, timer, dragging: false, moved: false };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  };
  const onMove = (ev: RPointerEvent) => {
    const p = press.current;
    if (!p) return;
    const dx = ev.clientX - p.x0, dy = ev.clientY - p.y0;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) > 8) { p.moved = true; clearTimeout(p.timer); } // a scroll, not a press
      return;
    }
    setDrag({ entry: p.entry, dx, dy });
  };
  const onUp = (ev: RPointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p || !edit) return;
    clearTimeout(p.timer);
    if (p.dragging) {
      setDrag(null);
      edit.onDrop(p.entry, lay.items, colAt(svgX(ev.clientX)), Math.round((ev.clientY - p.y0) / ROW));
    } else if (!p.moved) edit.onGate(p.entry);
  };
  const onCancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    setDrag(null);
  };

  return (
    <div className="circ" ref={root}>
      <button className="svg-btn" onClick={save} aria-label="Save the circuit as SVG">SVG</button>
      <svg className="circ-labels" width={30} height={H} aria-hidden>
        {lay.wires.map((q, r) => (
          <text key={q} x={26} y={y(r) + 4} textAnchor="end" className={edit && q === edit.cursorQubit && edit.sel === null ? "cursor" : ""}>q{q}</text>
        ))}
      </svg>
      <div className="circ-scroll" ref={box}>
        <svg ref={main} width={W} height={H} role="img" aria-label={`Circuit: ${tape.length} steps on ${n} qubits`}
          className={edit?.ctrlPick ? "ctrl-pick" : undefined}>
          {lay.wires.map((q, r) => (
            <g key={q}>
              {/* the wire's tap target: a place for the next gate, or a control to toggle */}
              {edit && <rect className="wire-hit" x={0} y={y(r) - ROW / 2} width={W} height={ROW}
                onClick={(ev) => edit.onWire(q, insertionIndex(lay.items, colAt(svgX(ev.clientX)), r, r))} />}
              <line className="wire" x1={0} x2={W} y1={y(r)} y2={y(r)} />
            </g>
          ))}
          {showMark && (
            <g className="insert-mark" pointerEvents="none">
              <line x1={markX} x2={markX} y1={TOP} y2={H} />
              {rowOf.has(edit!.cursorQubit) && <circle cx={markX} cy={y(rowOf.get(edit!.cursorQubit)!)} r={3.5} />}
            </g>
          )}
          {lay.items.map((it, k) => (
            <Gate key={k} it={it} row={(q) => rowOf.get(q)!} x={geo.x[it.col] + geo.w[it.col] / 2} y={y}
              state={[
                it.entry >= at ? "ahead" : it.entry === at - 1 && scrub !== null && !edit ? "at" : "",
                edit?.sel === it.entry ? "sel" : "",
                drag?.entry === it.entry ? "dragging" : "",
              ].join(" ")}
              offset={drag?.entry === it.entry ? drag : null}
              onDown={edit ? (ev) => onDown(ev, it.entry) : undefined} onMove={onMove} onUp={onUp} onCancel={onCancel} />
          ))}
        </svg>
      </div>
    </div>
  );
}

function Gate({ it, x, y: yRow, row, state, offset, onDown, onMove, onUp, onCancel }: {
  it: Placed; x: number; y: (r: number) => number; row: (q: number) => number; state: string;
  offset: { dx: number; dy: number } | null;
  onDown?: (ev: RPointerEvent) => void; onMove: (ev: RPointerEvent) => void; onUp: (ev: RPointerEvent) => void; onCancel: () => void;
}) {
  const s = it.step;
  const y = (q: number) => yRow(row(q)); // by qubit
  const yr = yRow; // by row
  const ctrl = new Set(s.controls);
  const cnot = s.gateId === "x" && s.controls.length > 0;
  const text = label(s);
  const bw = Math.max(20, text.length * CH + 10);
  return (
    <g className={`gate ${state}`} transform={offset ? `translate(${offset.dx},${offset.dy})` : undefined}
      onPointerDown={onDown} onPointerMove={onDown && onMove} onPointerUp={onDown && onUp} onPointerCancel={onDown && onCancel}>
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
