import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Calculator } from "../calc/calculator";
import { layoutTape, usedQubits, type Placed } from "../calc/diagram";
import { freeColumn, shape, shiftEntry, moveEntries } from "../calc/grid";
import { CUSTOM_PREFIX, expandCustom } from "../calc/custom";
import { placementHint } from "./circuitPlacement";
import { gateLabel, measuredBit, MEASURE_IDS, NONUNITARY, writesBit, type Entry } from "../calc/steps";
import { groupOf, itemWidth, spanFrom } from "../calc/gateSpecs";
import { elementToSvg, saveSvg } from "./svgExport";
import { LONG_PRESS, pressToDrag, setDropHandler, setDropZone, useDrag, type DragPayload, type Hover } from "./dnd";
import { DiagramMenu, type MenuAt } from "./DiagramMenu";

/** Diagram limits: beyond these the STEP pane is the readable form. */
export const DIAGRAM_MAX_QUBITS = 1024; // wires; the pane scrolls both ways
const MAX_STEPS = 20000;

const ROW = 34; // wire spacing (gates are 18 px tall: room to tell wires apart and tap them)
const TOP = 14; // room for IF labels
const CH = 6.6; // mono character width at 11px
const BOX_H = 18;
const GAP = 8; // between columns
const CELL = 28; // an empty column's width while editing (a drop target)
const EXTRA_W = 380; // while editing, empty columns fill at least this width
const FOLD_W = 34; // a folded range of columns
const LABEL_W = 30; // the wire labels, pinned at the left of the scroller
const LANE = 20; // classical lanes (one per bit) under the qubit wires

/** Width a step needs in its column. */
function need(s: Placed["step"]): number {
  if (s.gateId === "x" && s.controls.length) return 20;
  if (s.gateId === "swap") return 20;
  const text = label(s);
  return Math.max(20, text.length * CH + 10);
}

const label = (s: Placed["step"]) => (s.gateId === "measure" ? "M" : gateLabel(s));

type Cell = { row: number; col: number };
const NO_FOLDS: { from: number; to: number }[] = [];

/**
 * The Circuit tab's diagram, edited with fingers or a mouse as in Quantiom's
 * editor: drag a palette tile into a cell (the gate lands in that column, or
 * the first free one right of it, and stays there); drag a gate to another
 * column or wire; drag a control dot (or a selected gate's target) to another
 * wire, onto the trash to remove it; drag the selected gate's "● +" onto a
 * wire to add a control. Long-press (right-click) a gate for its menu:
 * angles, duplicate, invert, controls, condition, delete. Long-press empty
 * space for paste / select all / compact, then drag to select a rectangle.
 * Tap a gate to select it; tap an empty cell to choose where tapped tiles go.
 * Every edit is one UNDO.
 */
export function CircuitView({ calc }: { calc: Calculator }) {
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const sel = calc.diagSel;
  return (
    <>
      <CircuitDiagram n={calc.n} tape={calc.tape} scrub={calc.scrub} bits={calc.bits}
        edit={{
          sel, set: calc.diagSet, cursor: calc.cursor, folds: calc.folds, onUnfold: (from) => calc.unfold(from),
          onGate: (i) => calc.selectStep(sel === i ? null : i),
          onCell: (c) => calc.tapCell(calc.cursor && c && calc.cursor.row === c.row && calc.cursor.col === c.col ? null : c),
          onBox: (a, b) => calc.selectBox(a.col, b.col, a.row, b.row),
          onMenu: (m) => setMenu((cur) => cur ?? (m.kind === "gate" && calc.diagSet.size && calc.diagSet.has(calc.tape.findIndex((e) => e[0]?.id === m.id))
            ? { x: m.x, y: m.y, kind: "selection" }
            : m.kind === "canvas" && calc.diagSet.size ? { x: m.x, y: m.y, kind: "selection" } : m)),
          onDrop: (payload, cell) => {
            const hint = placementHint(calc.n, calc.tape, payload, cell, calc.diagSet);
            if (hint.error) return void calc.notify(hint.error, "error");
            switch (payload.kind) {
              case "new": return void calc.placeItem(payload.item, cell.row, cell.col);
              case "move": {
                if (calc.diagSet.size > 1 && calc.diagSet.has(payload.entry)) {
                  const items = layoutTape(calc.n, calc.tape).items;
                  const anchor = Math.min(...items.filter(it => it.entry === payload.entry).map(it => it.col));
                  const left = Math.min(...items.filter(it => calc.diagSet.has(it.entry)).map(it => it.col));
                  return void calc.moveSelection(cell.col - anchor + left, cell.row - payload.grabRow);
                }
                return void calc.moveGate(payload.entry, cell.col, cell.row - payload.grabRow);
              }
              case "dot": {
                // Along its own wire a dot carries the whole gate to another column; onto another wire it moves alone.
                const s = calc.tape[payload.entry]?.[0];
                const own = s && (payload.role === "target" ? s.targets : s.controls)[payload.index];
                if (own === cell.row) return void calc.moveGate(payload.entry, cell.col, 0);
                return void calc.reassignQubit(payload.entry, payload.role, payload.index, cell.row);
              }
              case "addctl": return void calc.addControl(payload.entry, cell.row);
              case "bit": {
                // Dropped on classical lane k: the measurement writes c[k], or the IF step reads it.
                const k = cell.row - calc.n;
                if (k < 0) return;
                if (payload.role === "write") return void calc.setMeasureBit(payload.entry, k);
                const cond = calc.tape[payload.entry]?.[0].condition;
                return void calc.setGateCondition(payload.entry, { clbit: k, value: (cond?.value ?? 1) as 0 | 1 });
              }
            }
          },
          onTrash: (p) => {
            if (p.kind === "move") calc.diagSet.has(p.entry) ? calc.deleteSelection() : calc.removeGate(p.entry);
            else if (p.kind === "dot" && p.role === "control") calc.removeControl(p.entry, calc.tape[p.entry]?.[0].controls[p.index]);
            else if (p.kind === "dot") calc.notify("a target can't be removed: drag the whole gate to delete it", "error");
          },
        }} />
      {sel !== null && calc.tape[sel] && <div className="circuit-inspector">
        <BlockInspection calc={calc} entry={calc.tape[sel]} />
        <DiagramMenu key={calc.tape[sel][0].id} calc={calc} menu={{ kind: "gate", id: calc.tape[sel][0].id, x: 0, y: 0 }} close={() => calc.selectStep(null)} inline />
      </div>}
      {menu && <DiagramMenu calc={calc} menu={menu} close={close} />}
    </>
  );
}

function BlockInspection({ calc, entry }: { calc: Calculator; entry: Entry }) {
  const s = entry[0], def = calc.customGates.find(d => CUSTOM_PREFIX + d.name === s.gateId);
  if (!def || entry.length !== 1) return null;
  const expanded = expandCustom(s, def).map(step => [{ ...step, pin: undefined, condition: s.condition }] as Entry);
  return <details className="block-inspection"><summary>Inspect {def.name} · {expanded.length} gates</summary>
    <p className="note">{def.about}</p>
    <p className="note">{s.targets.map((q, j) => `local q${j} → q${q}`).join(" · ")}</p>
    {s.controls.length > 0 && <p className="note">Controls: {s.controls.map((q, j) => `q${q}=${s.controlStates?.[j] === false ? 0 : 1}`).join(", ")}</p>}
    {calc.symbols.length > 0 && <p className="note">Circuit parameters: {calc.symbols.map(name => `${name}=${calc.scope[name] ?? 0}`).join(" · ")}</p>}
    <p className="note">Preview only. Parameters use the current circuit values.</p>
    <CircuitDiagram n={calc.n} tape={expanded} scrub={null} bits={calc.bits} />
  </details>;
}

/** What the editor needs from the diagram (absent in the report's read-only copy). */
type Edit = {
  sel: number | null; set: Set<number>; cursor: Cell | null;
  /** Column ranges drawn as one box; tap it to unfold. */
  folds: { from: number; to: number }[];
  onUnfold: (from: number) => void;
  /** Tap on a gate. */
  onGate: (entry: number) => void;
  /** Tap on an empty cell (null: outside the grid). */
  onCell: (cell: Cell | null) => void;
  /** A rectangle dragged from cell a to cell b. */
  onBox: (a: Cell, b: Cell) => void;
  /** Long-press or right-click: a gate's menu (by its first step's id), or the canvas's. */
  onMenu: (m: MenuAt) => void;
  /** Something dropped in a cell. */
  onDrop: (payload: DragPayload, cell: Cell) => void;
  /** Something dropped on the trash area. */
  onTrash: (payload: DragPayload) => void;
};

/**
 * The diagram (also the session report's read-only figure): `scrub` dims what
 * lies ahead. With `bits` classical bits, one classical lane per bit runs
 * under the wires (c0, c1, …): each measurement's link comes down to the lane
 * of the bit it writes, and each step under IF hangs (dotted) from the lane
 * of the bit it reads. Editing, their dots drag to another lane.
 */
export function CircuitDiagram({ n, tape, scrub, edit, bits = 0 }: { n: number; tape: Entry[]; scrub: number | null; edit?: Edit; bits?: number }) {
  const at = scrub ?? tape.length;
  const folds = edit?.folds ?? NO_FOLDS;
  const folded = (c: number) => folds.some((f) => c >= f.from && c <= f.to);
  const steps = useMemo(() => tape.reduce((k, e) => k + e.length, 0), [tape]);
  // A wide register draws only the wires the tape touches.
  const wires = useMemo(() => (n <= DIAGRAM_MAX_QUBITS ? null : usedQubits(tape)), [n, tape]);
  const tooWide = wires !== null && wires.length > DIAGRAM_MAX_QUBITS;
  const lay = useMemo(() => (!tooWide && steps <= MAX_STEPS ? layoutTape(n, tape, wires ?? undefined) : null), [n, tape, wires, tooWide, steps]);
  const geo = useMemo(() => {
    if (!lay) return null;
    const min = edit ? CELL : 20;
    const w = new Array<number>(lay.cols).fill(min);
    for (const it of lay.items) w[it.col] = Math.max(w[it.col], need(it.step));
    // A folded range: its first column is the box, the others take no room.
    for (const f of folds) for (let c = f.from; c <= Math.min(f.to, lay.cols - 1); c++) w[c] = c === f.from ? FOLD_W : 0;
    const x = [GAP];
    for (let c = 0; c < lay.cols; c++) x.push(x[c] + w[c] + (w[c] ? GAP : 0));
    // Editing: empty columns after the circuit to drop into.
    if (edit) {
      const end = x[x.length - 1];
      const extra = Math.max(4, Math.ceil((EXTRA_W - end) / (CELL + GAP)));
      for (let k = 0; k < extra; k++) { w.push(CELL); x.push(x[x.length - 1] + CELL + GAP); }
    }
    return { w, x, cols: w.length };
  }, [lay, edit !== undefined, folds]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<SVGSVGElement>(null);
  const zoom = 1;
  const drag = useDrag();
  const [band, setBand] = useState<{ a: Cell; b: Cell } | null>(null);
  const banding = useRef(false);

  const curCol = lay?.items.filter((it) => it.entry === at - 1).reduce((m, it) => Math.max(m, it.col), -1) ?? -1;
  useEffect(() => {
    const el = box.current;
    if (!el || !geo) return;
    // The current step's column; before the first step, the start.
    const cx = curCol >= 0 ? geo.x[curCol] + geo.w[curCol] / 2 : at === 0 ? 0 : geo.x[lay!.cols];
    const px = (cx + LABEL_W) * zoom;
    if (px < el.scrollLeft + LABEL_W + 20 || px > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = px - el.clientWidth / 2;
  }, [curCol, geo, at, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecting a rectangle with a finger: the page mustn't scroll meanwhile (listeners that can cancel it).
  useEffect(() => {
    const el = root.current;
    if (!el || !edit) return;
    const f = (e: TouchEvent) => { if (banding.current) e.preventDefault(); };
    el.addEventListener("touchmove", f, { passive: false });
    return () => el.removeEventListener("touchmove", f);
  }, [edit !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = lay?.wires.length ?? 0;
  /** A column's left edge and width, including the empty ones past the drawn grid. */
  const colX = (c: number) => (!geo ? 0 : c < geo.cols ? geo.x[c] : geo.x[geo.cols] + (c - geo.cols) * (CELL + GAP));
  const colW = (c: number) => (geo && c < geo.cols ? geo.w[c] : CELL);
  /** The column an x falls in (each column's cell includes half the gaps around it). */
  const colAt = (px: number) => {
    if (!geo) return 0;
    for (let c = 0; c < geo.cols; c++) if (px < geo.x[c] + geo.w[c] + GAP / 2) return c;
    return geo.cols + Math.max(0, Math.floor((px - geo.x[geo.cols] + GAP / 2) / (CELL + GAP)));
  };
  const rowAt = (py: number) => Math.max(0, Math.min(rows - 1, Math.floor((py - TOP) / ROW)));
  const cellAt = (clientX: number, clientY: number): Cell => {
    const r = main.current!.getBoundingClientRect();
    return { row: rowAt((clientY - r.top) / zoom), col: colAt((clientX - r.left) / zoom) };
  };

  // The drop zone (the grid) and what a drop does: registered while this diagram edits.
  const lanesTopRef = TOP + rows * ROW + 6;
  const latest = useRef({ edit, rows, colAt, bits, zoom, lanesTop: lanesTopRef });
  latest.current = { edit, rows, colAt, bits, zoom, lanesTop: lanesTopRef };
  useEffect(() => {
    if (!edit) return;
    setDropZone({
      resolve: (x, yy) => {
        const svg = main.current, L = latest.current;
        if (!svg) return null;
        const visible = box.current?.getBoundingClientRect();
        if (visible && (x < visible.left || x > visible.right || yy < visible.top || yy > visible.bottom)) return null;
        const r = svg.getBoundingClientRect();
        if (x < r.left - 24 || x > r.right + 60 || yy < r.top - ROW / 2 || yy > r.bottom + ROW / 2) return null;
        const py = (yy - r.top) / L.zoom;
        // Below the wires: classical lane k is row rows + k (only a bit's dot drops there; the rest clamp to the last wire).
        const row = py >= L.lanesTop && L.bits > 0
          ? L.rows + Math.max(0, Math.min(L.bits - 1, Math.floor((py - L.lanesTop) / LANE)))
          : Math.max(0, Math.min(L.rows - 1, Math.floor((py - TOP) / ROW)));
        return { row, col: L.colAt((x - r.left) / L.zoom) };
      },
    });
    setDropHandler((payload: DragPayload, hover: Hover) => {
      const L = latest.current;
      if (!L.edit || !hover) return;
      if ("trash" in hover) return L.edit.onTrash(payload);
      const { row, col } = hover.spot;
      L.edit.onDrop(payload, { row, col });
    });
    return () => { setDropZone(null); setDropHandler(null); };
  }, [edit !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lay || !geo) {
    return <div className="rows dim">{tooWide ? `the diagram shows up to ${DIAGRAM_MAX_QUBITS} wires (the circuit uses ${wires!.length})` : `the diagram shows up to ${MAX_STEPS} steps`}: see STEP</div>;
  }
  if (!edit && tape.length === 0) return <div className="rows dim">empty</div>;
  // The classical lanes, then (editing) room for the selected gate's "● +" handle.
  const bus = bits > 0;
  const lanesTop = TOP + rows * ROW + 6;
  const laneY = (k: number) => lanesTop + k * LANE + LANE / 2;
  const H = lanesTop + bits * LANE + (edit ? 16 : 0);
  const W = geo.x[geo.cols];
  const y = (r: number) => TOP + r * ROW + ROW / 2;
  const rowOf = new Map(lay.wires.map((q, r) => [q, r]));
  const save = () => root.current && main.current && void saveSvg(elementToSvg(root.current, [main.current]), "qc1-circuit.svg");
  const firstId = (entry: number) => tape[entry]?.[0]?.id ?? "";

  /** Empty space: tap a cell; long-press for the menu, then drag to select a rectangle (a mouse drags at once). */
  const bgDown = (ev: React.PointerEvent) => {
    if (!edit || (ev.target as Element).closest(".gate, button, input, .circ-labels")) return;
    const mouse = ev.pointerType === "mouse";
    if (mouse && ev.button !== 0) return;
    const x0 = ev.clientX, y0 = ev.clientY, id = ev.pointerId, a = cellAt(x0, y0);
    const r0 = main.current!.getBoundingClientRect();
    const inGrid = y0 >= r0.top + TOP * zoom && y0 < r0.top + (TOP + rows * ROW) * zoom && x0 >= r0.left;
    let mode: "press" | "armed" | "band" | "off" = "press";
    const timer = mouse ? undefined : setTimeout(() => {
      if (mode !== "press") return;
      mode = "armed";
      banding.current = true;
      try { navigator.vibrate?.(12); } catch { /* none */ }
    }, LONG_PRESS);
    const done = () => {
      clearTimeout(timer);
      banding.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const d = Math.hypot(e.clientX - x0, e.clientY - y0);
      if (mode === "press") {
        if (mouse && d > 4) mode = "band";
        else if (!mouse && d > 8) { mode = "off"; done(); return; } // a swipe: the pane scrolls
      } else if (mode === "armed" && d > 6) mode = "band";
      if (mode === "band") { e.preventDefault(); setBand({ a, b: cellAt(e.clientX, e.clientY) }); }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const m = mode;
      done();
      if (m === "band") { setBand(null); edit.onBox(a, cellAt(e.clientX, e.clientY)); }
      else if (m === "armed") edit.onMenu({ kind: "canvas", x: x0, y: y0 });
      else if (m === "press") edit.onCell(inGrid ? a : null);
    };
    const cancel = (e: PointerEvent) => { if (e.pointerId === id) { done(); setBand(null); } };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // The drop preview: the cells the dragged thing would take (the first free column at or right of the pointer's).
  const raw = drag?.hover && "spot" in drag.hover ? drag.hover.spot : null;
  const spot = raw;
  const hint = edit && drag && spot ? placementHint(n, tape, drag.payload, spot, edit.set) : null;
  const preview = (() => {
    if (!edit || !drag || !spot) return null;
    const p = drag.payload;
    if (hint?.error) return <g className="drop-preview bad"><rect x={colX(spot.col)} y={spot.row >= rows ? laneY(spot.row - rows) - 8 : y(spot.row) - 12} width={colW(spot.col)} height={24} rx={4} /></g>;
    if (p.kind === "bit") {
      const it = lay.items.find((x) => x.entry === p.entry);
      if (!it || spot.row < rows) return null;
      const gx = colX(it.col) + colW(it.col) / 2;
      return <g className="drop-preview"><circle cx={gx} cy={laneY(spot.row - rows)} r={6} /></g>;
    }
    const rect = (c: number, lo: number, hi: number, k: number, bad = false) => (
      <rect key={k} className={bad ? "bad" : undefined} x={colX(c) - 2} y={y(lo) - BOX_H / 2 - 3} width={colW(c) + 4} height={y(hi) - y(lo) + BOX_H + 6} rx={4} />
    );
    if (p.kind === "new") {
      const span = spanFrom(spot.row, Math.max(1, itemWidth(p.item)), rows);
      const controls = p.item.kind === "gate" ? p.item.controls : 0;
      const fake: Entry = [{ id: "", gateId: p.item.kind === "gate" || p.item.kind === "custom" ? p.item.gate : "x", column: 0, controls: span.slice(0, controls), targets: span.slice(controls), clbits: [], params: [] }];
      const c = freeColumn(lay.items, fake, [0], spot.col, -1, rows);
      return <g className="drop-preview">{rect(c, span[0], span[span.length - 1], 0)}</g>;
    }
    const s0 = p.kind === "dot" ? tape[p.entry]?.[0] : undefined;
    const alongWire = p.kind === "dot" && s0 && (p.role === "target" ? s0.targets : s0.controls)[p.index] === spot.row;
    if (p.kind === "move" || alongWire) {
      if (p.kind === "move" && edit.set.size > 1 && edit.set.has(p.entry)) {
        const anchor = Math.min(...lay.items.filter(it => it.entry === p.entry).map(it => it.col));
        const left = Math.min(...lay.items.filter(it => edit.set.has(it.entry)).map(it => it.col));
        const result = moveEntries(n, tape, edit.set, spot.col - anchor + left, spot.row - p.grabRow);
        if (!result) return null;
        return <g className="drop-preview">{layoutTape(n, result.tape).items.filter(it => result.selected.has(it.entry)).map((it, j) => rect(it.col, it.lo, it.hi, j))}</g>;
      }
      const moved = p.kind === "move" ? shiftEntry(tape[p.entry], spot.row - p.grabRow, rows) : tape[p.entry];
      if (!moved) return <g className="drop-preview">{rect(spot.col, spot.row, spot.row, 0, true)}</g>;
      const rel = shape(n, moved);
      const c = freeColumn(lay.items, moved, rel, spot.col, p.entry, rows);
      return <g className="drop-preview">{moved.map((s, k) => {
        const qs = [...s.controls, ...s.targets].map((q) => rowOf.get(q)!);
        return rect(c + rel[k], Math.min(...qs), Math.max(...qs), k);
      })}</g>;
    }
    const it = lay.items.find((x) => x.entry === p.entry);
    if (!it) return null;
    const gx = colX(it.col) + colW(it.col) / 2;
    return <g className="drop-preview"><line x1={gx} x2={gx} y1={y(Math.min(it.lo, spot.row))} y2={y(Math.max(it.hi, spot.row))} /><circle cx={gx} cy={y(spot.row)} r={6} /></g>;
  })();

  const bandRect = band && (() => {
    const c0 = Math.min(band.a.col, band.b.col), c1 = Math.max(band.a.col, band.b.col);
    const r0 = Math.min(band.a.row, band.b.row), r1 = Math.max(band.a.row, band.b.row);
    return <rect className="band" x={colX(c0) - GAP / 2} y={y(r0) - ROW / 2} width={colX(c1) + colW(c1) - colX(c0) + GAP} height={(r1 - r0 + 1) * ROW} />;
  })();
  const selectedSteps = edit ? tape.flatMap((e, i) => edit.sel === i || edit.set.has(i) ? e : []) : [];
  const activeBits = new Set(selectedSteps.flatMap(s => [...(writesBit(s) ? [measuredBit(s)] : []), ...(s.condition ? [s.condition.clbit] : [])]));

  return (
    <div className="circ" ref={root} onPointerDown={edit ? bgDown : undefined}
      onContextMenu={edit ? (e) => { e.preventDefault(); if (!(e.target as Element).closest(".gate")) edit.onMenu({ kind: "canvas", x: e.clientX, y: e.clientY }); } : undefined}>
      <button className="svg-btn" onClick={save} aria-label="Save the circuit as SVG">SVG</button>
      <div className="circ-scroll" ref={box}>
        <div className="circ-row">
          <svg className="circ-labels" width={LABEL_W * zoom} height={H * zoom} viewBox={`0 0 ${LABEL_W} ${H}`} aria-hidden>
            {lay.wires.map((q, r) => (
              <text key={q} x={26} y={y(r) + 4} textAnchor="end" className={edit?.cursor?.row === r ? "cursor" : ""}>q{q}</text>
            ))}
            {Array.from({ length: bits }, (_, k) => <text key={`c${k}`} x={26} y={laneY(k) + 3.5} textAnchor="end" className={`clabel${activeBits.has(k) ? " active-bit" : ""}`}>c{k}</text>)}
          </svg>
          <svg ref={main} width={W * zoom} height={H * zoom} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Circuit: ${tape.length} steps on ${n} qubits`} className={drag ? "dragging" : undefined}>
            {edit && <rect className="grid-hit" x={0} y={0} width={W} height={H} />}
            {lay.wires.map((q, r) => <line key={q} className="wire" x1={0} x2={W} y1={y(r)} y2={y(r)} />)}
            {Array.from({ length: bits }, (_, k) => (
              <g key={`l${k}`} className={`cbus${activeBits.has(k) ? " active-bit" : ""}`}><line x1={0} x2={W} y1={laneY(k) - 1.5} y2={laneY(k) - 1.5} /><line x1={0} x2={W} y1={laneY(k) + 1.5} y2={laneY(k) + 1.5} /></g>
            ))}
            {bus && lay.items.filter((it) => !folded(it.col)).flatMap(it => [
              ...(writesBit(it.step) ? [{ it, w: true }] : []),
              ...(it.step.condition ? [{ it, w: false }] : []),
            ]).map(({ it, w }, k) => {
              const cx = colX(it.col) + colW(it.col) / 2 + (writesBit(it.step) && it.step.condition ? (w ? -3 : 3) : 0), top = y(it.hi) + BOX_H / 2;
              const bit = w ? measuredBit(it.step) : it.step.condition!.clbit;
              const by = laneY(Math.min(bit, bits - 1));
              const role = w ? "write" as const : "read" as const;
              return (
                <g key={`b${k}`} className={`${w ? "clink" : "cread"}${activeBits.has(bit) ? " active-bit" : ""}`}>
                  <line x1={cx} x2={cx} y1={top} y2={by} />
                  <circle cx={cx} cy={by} r={3} />
                  {edit && (
                    // drag the dot to another lane: another bit
                    <circle className="bit-hit" cx={cx} cy={by} r={10} role="button" aria-label={`${w ? "Writes" : "Reads"} c${bit}: drag to another bit`}
                      onPointerDown={(ev) => { ev.stopPropagation(); pressToDrag(ev, { kind: "bit", entry: it.entry, role }, `c${bit}`); }} />
                  )}
                </g>
              );
            })}
            {edit?.cursor && edit.cursor.row < rows && (
              <rect className="cursor-cell" x={colX(edit.cursor.col) - 2} y={y(edit.cursor.row) - BOX_H / 2 - 3} width={colW(edit.cursor.col) + 4} height={BOX_H + 6} rx={4} />
            )}
            {edit && edit.set.size > 0 && lay.items.filter((it) => edit.set.has(it.entry) && !folded(it.col)).map((it, k) => (
              <rect key={`s${k}`} className="picked" x={colX(it.col) - 3} y={y(it.lo) - BOX_H / 2 - 4} width={colW(it.col) + 6} height={y(it.hi) - y(it.lo) + BOX_H + 8} rx={4} />
            ))}
            {folds.filter((f) => f.from < lay.cols).map((f) => {
              const k = new Set(lay.items.filter((it) => it.col >= f.from && it.col <= f.to).map((it) => it.entry)).size;
              return (
                <g key={`f${f.from}`} className="fold" role="button" tabIndex={0} aria-label={`Folded columns ${f.from + 1}–${f.to + 1}, ${k} gates: tap to unfold`}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => edit!.onUnfold(f.from)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); edit!.onUnfold(f.from); } }}>
                  <rect x={colX(f.from)} y={y(0) - ROW / 2 + 4} width={FOLD_W} height={rows * ROW - 8} rx={5} />
                  <text x={colX(f.from) + FOLD_W / 2} y={TOP + (rows * ROW) / 2 + 4} textAnchor="middle">⊞ {k}</text>
                </g>
              );
            })}
            {lay.items.map((it, k) => {
              if (folded(it.col)) return null;
              const selected = edit?.sel === it.entry;
              return (
                <Gate key={k} it={it} row={(q) => rowOf.get(q)!} x={colX(it.col) + colW(it.col) / 2} y={y}
                  state={[
                    it.entry >= at ? "ahead" : it.entry === at - 1 && scrub !== null ? "at" : "",
                    selected || edit?.set.has(it.entry) ? "sel" : "",
                    drag && (drag.payload.kind === "move" || drag.payload.kind === "dot") && drag.payload.entry === it.entry ? "dragging" : "",
                  ].join(" ")}
                  dragTargets={selected && it.step.targets.length + it.step.controls.length > 1}
                  onPress={edit ? (ev, dot) => pressToDrag(ev,
                    dot ? { kind: "dot", entry: it.entry, role: dot.role, index: dot.index } : { kind: "move", entry: it.entry, grabRow: rowAt((ev.clientY - main.current!.getBoundingClientRect().top) / zoom) },
                    dot ? (dot.role === "control" ? "●" : label(it.step)) : label(it.step),
                    () => edit.onGate(it.entry),
                    (x, yy) => edit.onMenu({ kind: "gate", id: firstId(it.entry), x, y: yy })) : undefined}
                  onMenu={edit ? (x, yy) => edit.onMenu({ kind: "gate", id: firstId(it.entry), x, y: yy }) : undefined}
                  onAddControl={edit && selected && !NONUNITARY.has(it.step.gateId) ? (ev) => pressToDrag(ev, { kind: "addctl", entry: it.entry }, "● +") : undefined}
                  onActivate={edit ? () => edit.onGate(it.entry) : undefined} />
              );
            })}
            {preview}
            {bandRect}
          </svg>
        </div>
      </div>
    </div>
  );
}

type DotRef = { role: "target" | "control"; index: number };

function Gate({ it, x, y: yRow, row, state, dragTargets, onPress, onMenu, onAddControl, onActivate }: {
  it: Placed; x: number; y: (r: number) => number; row: (q: number) => number; state: string;
  /** The selected multi-qubit gate: its targets are dots to drag too. */
  dragTargets?: boolean;
  /** A press on the gate (dot: one of its control or target dots). */
  onPress?: (ev: React.PointerEvent, dot?: DotRef) => void;
  /** Right-click, or the keyboard's menu key. */
  onMenu?: (x: number, y: number) => void;
  onAddControl?: (ev: React.PointerEvent) => void;
  onActivate?: () => void;
}) {
  const s = it.step;
  const y = (q: number) => yRow(row(q)); // by qubit
  const yr = yRow; // by row
  const ctrl = new Set(s.controls);
  const cnot = s.gateId === "x" && s.controls.length > 0;
  const text = label(s);
  const bw = Math.max(20, text.length * CH + 10);
  const where = [...new Set([...s.controls, ...s.targets])].sort((a, b) => a - b).map((q) => `q${q}`).join(", ");
  const selected = state.includes("sel");
  const dot = (q: number, d: DotRef, key: string) => (
    // a bigger target on the dot: drag it to another wire (a control also onto the trash)
    <circle key={key} className="dot-hit" cx={x} cy={y(q)} r={11} onPointerDown={(ev) => { ev.stopPropagation(); onPress!(ev, d); }} />
  );
  return (
    <g className={`gate ${state}`}
      role={onActivate ? "button" : undefined} tabIndex={onActivate ? 0 : undefined} aria-pressed={onActivate ? selected : undefined}
      aria-label={onActivate ? `Step ${it.entry + 1}: ${text} on ${where}${writesBit(s) ? `, writes c${measuredBit(s)}` : ""}${s.condition ? `, only if c${s.condition.clbit}=${s.condition.value}` : ""}` : undefined}
      onKeyDown={onActivate && ((ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onActivate(); }
        if (ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10")) {
          ev.preventDefault();
          const r = (ev.currentTarget as Element).getBoundingClientRect();
          onMenu?.(r.left + r.width / 2, r.bottom);
        }
      })}
      onPointerDown={onPress && ((ev) => onPress(ev))}
      onContextMenu={onMenu && ((ev) => { ev.preventDefault(); ev.stopPropagation(); onMenu(ev.clientX, ev.clientY); })}>
      <title>{`${it.entry + 1}: ${text}`}</title>
      <rect className="hit" x={x - bw / 2 - 3} y={yr(it.lo) - ROW / 2} width={bw + 6} height={(it.hi - it.lo + 1) * ROW} />
      {it.hi > it.lo && <line className="link" x1={x} x2={x} y1={yr(it.lo)} y2={yr(it.hi)} />}
      {s.controls.map((q, i) => (
        <g key={`c${q}`}>
          <circle className={s.controlStates?.[i] === false ? "ctl open" : "ctl"} cx={x} cy={y(q)} r={4} />
          {onPress && dot(q, { role: "control", index: i }, "h")}
        </g>
      ))}
      {s.targets.map((q, i) => {
        if (ctrl.has(q)) return null;
        const handle = onPress && dragTargets ? dot(q, { role: "target", index: i }, "h") : null;
        if (cnot) return (
          <g key={q}>
            <circle className="oplus" cx={x} cy={y(q)} r={8} />
            <line className="oplus" x1={x - 8} x2={x + 8} y1={y(q)} y2={y(q)} />
            <line className="oplus" x1={x} x2={x} y1={y(q) - 8} y2={y(q) + 8} />
            {handle}
          </g>
        );
        if (s.gateId === "swap") return <g key={q}><text className="swapx" x={x} y={y(q) + 5} textAnchor="middle">×</text>{handle}</g>;
        const measured = MEASURE_IDS.has(s.gateId) && s.gateId !== "reset";
        return (
          <g key={q}>
            <rect className={`box g-${groupOf(s.gateId, s.controls.length)}${measured ? " meas" : ""}${s.condition ? " cond" : ""}`} x={x - bw / 2} y={y(q) - BOX_H / 2} width={bw} height={BOX_H} rx={3} />
            <text className="glabel" x={x} y={y(q) + 4} textAnchor="middle">{text}</text>
            {measured && s.outcome !== undefined && <text className="outcome" x={x + bw / 2 - 1} y={y(q) + BOX_H / 2 + 8} textAnchor="end">{s.outcome}</text>}
            {handle}
          </g>
        );
      })}
      {s.condition && <text className="iflabel" x={x} y={yr(it.lo) - BOX_H / 2 - 2} textAnchor="middle">c{s.condition.clbit}={s.condition.value}</text>}
      {selected && onAddControl && (
        // "● +": drag onto a wire to add a control there
        <g className="handle-grip" onPointerDown={(ev) => { ev.stopPropagation(); onAddControl(ev); }} role="button" aria-label="Drag onto a wire to add a control">
          <rect x={x - 13} y={yr(it.hi) + BOX_H / 2 + 1} width={26} height={13} rx={3} />
          <text x={x} y={yr(it.hi) + BOX_H / 2 + 11} textAnchor="middle">● +</text>
        </g>
      )}
    </g>
  );
}
