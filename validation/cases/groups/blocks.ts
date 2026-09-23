import { blockGate, qaoaLayer, type BlockKind } from "../../../src/calc/blocks";
import { CUSTOM_PREFIX, setCustomGates } from "../../../src/calc/custom";
import { applyStep, type Entry } from "../../../src/calc/steps";
import { exportQasm3 } from "../../../src/qasm/fromTape";

/** Algorithm blocks (CATALOG → BLOCKS) on the whole register, and on a spread-out subset. */
export function cases() {
  const out: { id: string; n: number; kind: BlockKind; qubits: number[]; gamma?: number; beta?: number }[] = [];
  for (const kind of ["qft", "iqft", "diff"] as const) {
    for (let k = 1; k <= 4; k++) out.push({ id: `${kind}${k}`, n: k, kind, qubits: [...Array(k).keys()] });
    out.push({ id: `${kind}3-of-5`, n: 5, kind, qubits: [0, 2, 4] });
  }
  [[2, 0.7, 0.3], [3, 1.1, -0.4], [4, 0.25, 0.9]].forEach(([k, gamma, beta]) => out.push({ id: `qaoa${k}`, n: k, kind: "qaoa", qubits: [...Array(k).keys()], gamma, beta }));
  out.push({ id: "qaoa3-of-5", n: 5, kind: "qaoa", qubits: [4, 1, 3].sort(), gamma: 0.6, beta: 0.2 });
  return out;
}

/** The block as a tape (with its custom gate registered). */
export function tapeOf(c: ReturnType<typeof cases>[number]): Entry[] {
  if (c.kind === "qaoa") {
    setCustomGates([]);
    return qaoaLayer(c.qubits, String(c.gamma), String(c.beta));
  }
  const def = blockGate(c.kind, c.qubits.length);
  setCustomGates([def]);
  return [[{ id: "b", gateId: CUSTOM_PREFIX + def.name, column: 0, targets: c.qubits, controls: [], clbits: [], params: [] }]];
}

/** QC-1's unitary, column by column (column j = the image of basis state j), interleaved re/im per column. */
export function compute(c: ReturnType<typeof cases>[number]) {
  const tape = tapeOf(c);
  const dim = 1 << c.n;
  const cols: number[][] = [];
  for (let j = 0; j < dim; j++) {
    const st = new Float64Array(2 * dim);
    st[2 * j] = 1;
    for (const e of tape) for (const s of e) applyStep(st, c.n, s, Math.random, {});
    cols.push(Array.from(st));
  }
  return { unitary: cols, qasm: exportQasm3(c.n, tape) };
}
