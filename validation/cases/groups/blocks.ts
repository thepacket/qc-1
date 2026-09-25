import { BLOCK_BY_ID, defaultSettings, hamiltonian, type Settings } from "../../../src/calc/blockLib";
import { CUSTOM_PREFIX, defineGate, setCustomGates, type CustomGate } from "../../../src/calc/custom";
import { inverseGates } from "../../../src/calc/inverse";
import { qiskitLabel } from "../../../src/calc/order";
import { applyStep, stepSymbols, type Entry, type Step } from "../../../src/calc/steps";
import { exportQasm3 } from "../../../src/qasm/fromTape";
import { rng } from "../tapes";

/**
 * The block library (blockLib.ts), each block built exactly as the app builds
 * it, on its own qubits, on a spread-out subset, inverted and controlled.
 * Symbols take seeded values (`scope`), which the reference binds by name.
 */
type Mode = "plain" | "inverse" | "control";
export type BlockCase = {
  id: string; n: number; block: string; qubits: number[]; settings: Settings; mode: Mode; control?: number;
  /** Phase Estimation's operation (its matrix goes to the reference). */
  gate?: "phase" | "two";
  scope: Record<string, number>;
  /** Pauli Measurement: seeded data states (re/im interleaved, n − 1 qubits). */
  states?: number[][];
};

const k_ = (k: number) => [...Array(k).keys()];

/** Phase Estimation's operations: P(0.7) on one qubit, and a 2-qubit gate. */
function testGate(which: "phase" | "two"): CustomGate {
  const st = (gateId: string, targets: number[], controls: number[] = [], params: string[] = []): Step =>
    ({ id: `tg${gateId}${targets}`, gateId, column: 0, targets, controls, clbits: [], params });
  return which === "phase"
    ? defineGate("G1", [[st("p", [0], [], ["0.7"])]])
    : defineGate("G2", [[st("h", [0])], [st("x", [1], [0])], [st("rz", [1], [], ["0.3"])], [st("p", [0], [], ["1.1"])]]);
}

export function cases(): BlockCase[] {
  const out: BlockCase[] = [];
  const add = (block: string, k: number, settings: Settings = {}, extra: Partial<BlockCase> = {}, tag = "") => {
    const base = { block, settings: { ...defaultSettings(BLOCK_BY_ID[block], k), ...settings }, scope: {} as Record<string, number> };
    const id = `${block}${k}${tag}`;
    out.push({ id, n: k, qubits: k_(k), mode: "plain", ...base, ...extra });
    return id;
  };
  // Every block: plain on k qubits; one spread-out, one inverted, one controlled.
  const trio = (block: string, k: number, settings: Settings = {}, extra: Partial<BlockCase> = {}, tag = "") => {
    add(block, k, settings, extra, tag);
    const s = { ...defaultSettings(BLOCK_BY_ID[block], k), ...settings };
    // Spread out: q0, q2, q4, then consecutive (0, 2, 4, 5 for four qubits).
    if (k + 2 <= 6) out.push({ id: `${block}${k}${tag}-spread`, n: k + 2, block, qubits: k_(k).map((q) => q + Math.min(q, 2)), settings: s, mode: "plain", scope: {}, ...extra });
    out.push({ id: `${block}${k}${tag}-inv`, n: k, block, qubits: k_(k), settings: s, mode: "inverse", scope: {}, ...extra });
    out.push({ id: `${block}${k}${tag}-ctrl`, n: k + 1, block, qubits: k_(k).map((q) => q + 1), control: 0, settings: s, mode: "control", scope: {}, ...extra });
  };

  for (const v of ["phi+", "phi-", "psi+", "psi-"]) add("bell", 2, { variant: v }, {}, `-${v}`);
  trio("bell", 2, { variant: "psi-" });
  for (const k of [2, 3, 4]) add("ghz", k);
  trio("ghz", 3);
  for (const [k, M] of [[1, 2], [2, 3], [3, 5], [3, 6], [3, 7], [4, 9], [4, 11], [4, 16], [5, 13]]) add("unif", k, { M: String(M) }, {}, `-M${M}`);
  trio("unif", 3, { M: "5" });
  add("graph", 3, { edges: "0-1, 1-2" }, {}, "-line");
  add("graph", 4, { edges: "0-1, 1-2, 2-3, 3-0" }, {}, "-ring");
  add("graph", 4, { edges: "0-1, 0-2, 0-3" }, {}, "-star");
  trio("graph", 3, { edges: "0-2, 1-2" });
  for (const k of [1, 2, 3, 4]) { add("qft", k); add("iqft", k); }
  add("qft", 4, { approx: "1" }, {}, "-a1");
  add("qft", 4, { approx: "2", swaps: "no" }, {}, "-a2-noswap");
  add("iqft", 3, { swaps: "no" }, {}, "-noswap");
  add("qft", 5, { approx: "2" }, {}, "-a2");
  trio("qft", 3);
  trio("iqft", 3, { approx: "1" }, {}, "-a1");
  add("oracle", 1, { marked: "0" }, {}, "-0");
  add("oracle", 3, { marked: "101" }, {}, "-101");
  add("oracle", 3, { marked: "000, 110" }, {}, "-000-110");
  trio("oracle", 4, { marked: "1010, 0111" });
  for (const k of [1, 2, 3, 4]) add("diff", k);
  trio("diff", 3);
  add("grover", 2, { marked: "11", iterations: "1" }, {}, "-11");
  add("grover", 3, { marked: "101", iterations: "2" }, {}, "-101");
  add("grover", 4, { marked: "0110, 1001", iterations: "2" }, {}, "-2marked");
  trio("grover", 3, { marked: "011, 100", iterations: "1" });
  for (const ent of ["reverse_linear", "linear", "full", "circular", "pairwise", "sca"]) add("realamp", 4, { entanglement: ent, reps: "2" }, {}, `-${ent}`);
  add("realamp", 1, { reps: "2" });
  add("realamp", 3, { reps: "1", final: "no" }, {}, "-nofinal");
  add("realamp", 5, { reps: "3", entanglement: "sca" }, {}, "-sca3");
  trio("realamp", 3, { reps: "2", entanglement: "full" });
  for (const ent of ["reverse_linear", "circular"]) add("esu2", 3, { entanglement: ent, reps: "2" }, {}, `-${ent}`);
  add("esu2", 2, { reps: "1", final: "no", prefix: "phi" }, {}, "-phi");
  trio("esu2", 2, { reps: "2" });
  add("qaoa", 2, { edges: "0-1", layers: "1" }, {}, "-edge");
  add("qaoa", 3, { layers: "2" }, {}, "-ring-p2");
  add("qaoa", 4, { edges: "0-1, 0-2, 1-3, 2-3", layers: "1", init: "no" }, {}, "-square-noinit");
  trio("qaoa", 3, { edges: "0-1, 1-2", layers: "1" });
  add("pevo", 2, { h: "-1*ZZ + -0.5*XI + -0.5*IX", steps: "2", order: "1" }, {}, "-tfim-o1");
  add("pevo", 3, { h: "1*XXI + 1*YYI + 0.5*IZZ", steps: "1", order: "2" }, {}, "-xxz-o2");
  add("pevo", 2, { h: "0.3*XY + 0.2*ZI + 0.7*II", steps: "2", order: "4", time: "0.9" }, {}, "-phase-o4");
  add("pevo", 1, { h: "0.4*X + -0.3*Z + 0.25*I", steps: "3", order: "1" }, {}, "-1q");
  trio("pevo", 2, { h: "0.5*XX + 0.3*ZI + -0.2*II", steps: "1", order: "2" });
  add("qpe", 4, { m: "3" }, { gate: "phase" }, "-p");
  add("qpe", 4, { m: "2" }, { gate: "two" }, "-two");
  add("qpe", 5, { m: "4" }, { gate: "phase" }, "-m4");
  trio("qpe", 3, { m: "2" }, { gate: "phase" });
  // Blocks that measure: seeded states on the data qubits (the ancillas, on top, start at |0⟩).
  const measured = (block: string, n: number, data: number, settings: Settings, tag: string, extra: Partial<BlockCase> = {}) => {
    const r = rng(tag.length * 131 + tag.charCodeAt(tag.length - 1) + n);
    const dim = 1 << data;
    const states = [0, 1, 2].map(() => {
      const v = Array.from({ length: 2 * dim }, () => r.next() * 2 - 1);
      const norm = Math.hypot(...v);
      return v.map((x) => x / norm);
    });
    out.push({ id: `${block}-${tag}`, n, block, qubits: k_(n), settings, mode: "plain", scope: {}, states, ...extra });
  };
  for (const p of ["Z", "X", "Y", "ZZ", "XY", "YZX", "XIZ", "ZZZZ"]) measured("paulimeas", p.length + 1, p.length, { pauli: p }, p);
  measured("hadamardtest", 2, 1, { part: "re" }, "p-re", { gate: "phase" });
  measured("hadamardtest", 2, 1, { part: "im" }, "p-im", { gate: "phase" });
  measured("hadamardtest", 3, 2, { part: "re" }, "two-re", { gate: "two" });
  measured("hadamardtest", 3, 2, { part: "im" }, "two-im", { gate: "two" });
  for (const m of [1, 2, 3]) measured("swaptest", 2 * m + 1, 2 * m, { m: String(m) }, `m${m}`);
  for (const d of [2, 3, 4]) for (const v of ["bit", "phase"]) measured("repsyndrome", 2 * d - 1, d, { d: String(d), variant: v }, `d${d}-${v}`);
  // Release 2: prepared states, arithmetic, the encoder.
  for (const k of [2, 3, 5]) add("wstate", k);
  trio("wstate", 3);
  for (const [k, e] of [[2, 1], [3, 1], [3, 2], [4, 2], [5, 2], [5, 3], [6, 3]]) add("dicke", k, { e: String(e) }, {}, `-e${e}`);
  trio("dicke", 4, { e: "2" });
  for (const [k, c] of [[1, 1], [2, 1], [3, 5], [4, -3], [4, 11]]) add("addconst", k, { c: String(c) }, {}, `-c${c}`);
  trio("addconst", 3, { c: "3" });
  for (const n of [1, 2, 3]) for (const kind of ["half", "fixed"]) add("qftadder", 2 * n + (kind === "half" ? 1 : 0), { bits: String(n), kind }, {}, `-${kind}`);
  trio("qftadder", 4, { bits: "2", kind: "fixed" });
  for (const n of [1, 2, 3]) for (const kind of ["half", "fixed", "full"]) add("rippleadder", 2 * n + (kind === "fixed" ? 1 : 2), { bits: String(n), kind }, {}, `-${kind}`);
  trio("rippleadder", 5, { bits: "2", kind: "fixed" });
  for (const [k, v, g] of [[2, 1, "geq"], [3, 2, "geq"], [4, 5, "geq"], [4, 0, "geq"], [4, 8, "geq"], [4, 5, "lt"], [5, 11, "lt"], [4, 0, "lt"]] as const) add("comparator", k, { value: String(v), geq: g }, {}, `-${g}${v}`);
  trio("comparator", 4, { value: "3" });
  for (const k of [2, 3, 4]) for (const v of ["bit", "phase"]) add("repencode", k, { variant: v }, {}, `-${v}`);
  trio("repencode", 3, { variant: "phase" });
  // Seeded symbol values, by name.
  for (const c of out) {
    const r = rng(c.id.length * 977 + c.id.charCodeAt(c.id.length - 1));
    for (const s of symbolsOfCase(c)) c.scope[s] = Math.round((r.next() * 4 - 2) * 1e6) / 1e6;
  }
  return out;
}

/** The block's definitions and its step on the case's qubits. */
export function tapeOf(c: BlockCase): { tape: Entry[]; defs: CustomGate[] } {
  const spec = BLOCK_BY_ID[c.block];
  const extra = c.gate ? [testGate(c.gate)] : [];
  const settings = c.gate ? { ...c.settings, gate: extra[0].name } : c.settings;
  const built = spec.build(c.qubits.length, settings, (name) => extra.find((g) => g.name === name));
  if ("entries" in built) {
    setCustomGates(extra);
    return { tape: built.entries.map((e) => e.map((s) => ({ ...s, targets: s.targets.map((q) => c.qubits[q]), controls: s.controls.map((q) => c.qubits[q]) }))), defs: extra };
  }
  let defs = [...extra, built.gate];
  let name = built.gate.name;
  if (c.mode === "inverse") {
    const inv = inverseGates(built.gate, defs);
    defs = [...defs, ...inv.filter((d) => !defs.some((x) => x.name === d.name))];
    name = inv[0].name;
  }
  setCustomGates(defs);
  const step: Step = {
    id: "b", gateId: CUSTOM_PREFIX + name, column: 0, targets: c.qubits, controls: c.mode === "control" ? [c.control!] : [], clbits: [], params: [],
  };
  return { tape: [[step]], defs };
}

function symbolsOfCase(c: BlockCase): string[] {
  const { tape, defs } = tapeOf({ ...c, scope: {} });
  const all = new Set<string>();
  const walk = (steps: Step[]) => {
    for (const s of steps) {
      const d = defs.find((x) => CUSTOM_PREFIX + x.name === s.gateId);
      if (d) walk(d.tape.flat());
      else stepSymbols(s).forEach((x) => all.add(x));
    }
  };
  walk(tape.flat());
  return [...all].sort();
}

/** A test gate's matrix, column by column (re/im interleaved). */
function matrixOf(g: CustomGate): number[][] {
  setCustomGates([g]);
  const d = 1 << g.k;
  return [...Array(d).keys()].map((j) => {
    const st = new Float64Array(2 * d);
    st[2 * j] = 1;
    for (const e of g.tape) for (const s of e) applyStep(st, g.k, s, Math.random, {});
    return Array.from(st);
  });
}

/** QC-1's side: the unitary column by column (column j = the image of basis state j, re/im interleaved), the QASM export, and Pauli Measurement's ⟨P⟩. */
export function compute(c: BlockCase) {
  const { tape } = tapeOf(c);
  if (c.states) {
    // The block's steps up to the measurements (the ancillas start at |0⟩), then 1 − 2·P(1) for each measured qubit.
    const n = c.n;
    const steps = tape.flat();
    const read = steps.filter((s) => s.gateId === "measure").map((s) => s.targets[0]);
    const values = c.states.map((psi) => {
      const st = new Float64Array(2 << n);
      st.set(psi);
      for (const s of steps) if (s.gateId !== "reset" && s.gateId !== "measure") applyStep(st, n, s, Math.random, c.scope);
      return read.map((q) => {
        let p1 = 0;
        for (let i = 0; i < 1 << n; i++) if ((i >> q) & 1) p1 += st[2 * i] ** 2 + st[2 * i + 1] ** 2;
        return 1 - 2 * p1;
      });
    });
    const extra: Record<string, unknown> = { values, read, first: steps[0].gateId, last: steps[steps.length - 1].gateId };
    if (c.gate) extra.gateMatrix = matrixOf(testGate(c.gate));
    return extra;
  }
  const dim = 1 << c.n;
  const cols: number[][] = [];
  for (let j = 0; j < dim; j++) {
    const st = new Float64Array(2 * dim);
    st[2 * j] = 1;
    for (const e of tape) for (const s of e) applyStep(st, c.n, s, Math.random, c.scope);
    cols.push(Array.from(st));
  }
  const extra: Record<string, unknown> = {};
  if (c.block === "pevo") {
    const H = hamiltonian(c.settings.h);
    extra.terms = H.terms.map((t) => [qiskitLabel(t.paulis), t.coefficient]);
  }
  if (c.gate) {
    extra.gateMatrix = matrixOf(testGate(c.gate));
    tapeOf(c); // registers the block's gates again for the export
  }
  if (["wstate", "dicke", "repencode"].includes(c.block)) {
    // QC-1 definitions: the block alone on its own k qubits, for Qiskit to read.
    const k = c.qubits.length;
    const plain = tapeOf({ ...c, mode: "plain" });
    const alone: Entry[] = [[{ ...plain.tape[0][0], targets: k_(k), controls: [] }]];
    extra.alone = exportQasm3(k, alone);
    tapeOf(c);
  }
  return { unitary: cols, qasm: exportQasm3(c.n, tape), ...extra };
}
