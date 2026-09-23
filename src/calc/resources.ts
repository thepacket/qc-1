import { MEASURE_IDS, NONUNITARY, applyStep, exportedSteps as exported, stepSymbols, type Entry, type Scope, type Step } from "./steps";

/**
 * Circuit resources of a tape, with Qiskit's definitions (validated against
 * `QuantumCircuit.size / depth / count_ops` on the QASM export, fixture
 * `tools`): the instructions the QASM export writes (a step, or its
 * expansion: measure_x → h, measure, h; state preps → reset + gates).
 *
 * Differs from upstream `estimateResources`, which counted controlled T as
 * T, took the T-depth as the number of ASAP columns holding a T (instead of
 * the most T gates on any causal path) and counted Cliffords from a fixed
 * name list; QC-1 checks each gate's matrix instead.
 */
export type CircuitResources = {
  gates: number;
  oneQubit: number;
  twoQubit: number;
  /** Gates on three or more qubits (controls included). */
  multiQubit: number;
  measurements: number;
  resets: number;
  /** Parallel depth with as-soon-as-possible scheduling. */
  depth: number;
  /** Uncontrolled T and T†. */
  tCount: number;
  /** Most T/T† gates on any causal path. */
  tDepth: number;
  /** CNOTs (X with one positive control). */
  cxCount: number;
  /** Gates whose matrix maps Paulis to Paulis. */
  cliffordCount: number;
  /** Gates with angle parameters. */
  parameterized: number;
  symbols: string[];
  /** Most instructions on any one qubit. */
  longestQubit: number;
};

type C = [number, number];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

function matMul(A: C[][], B: C[][]): C[][] {
  const d = A.length;
  return A.map((row) => Array.from({ length: d }, (_, j) => {
    let re = 0, im = 0;
    for (let k = 0; k < d; k++) { const p = mul(row[k], B[k][j]); re += p[0]; im += p[1]; }
    return [re, im] as C;
  }));
}
const dagger = (A: C[][]): C[][] => A.map((_, i) => A.map((row) => [row[i][0], -row[i][1]] as C));

const P1: Record<string, C[][]> = {
  I: [[[1, 0], [0, 0]], [[0, 0], [1, 0]]],
  X: [[[0, 0], [1, 0]], [[1, 0], [0, 0]]],
  Y: [[[0, 0], [0, -1]], [[0, 1], [0, 0]]],
  Z: [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]],
};
function kron(A: C[][], B: C[][]): C[][] {
  const a = A.length, b = B.length;
  return Array.from({ length: a * b }, (_, i) => Array.from({ length: a * b }, (_, j) => mul(A[Math.floor(i / b)][Math.floor(j / b)], B[i % b][j % b])));
}
function pauli(label: string): C[][] {
  return [...label].map((p) => P1[p]).reduce(kron);
}

/** Is M (d×d) a phase times a Pauli string? */
function isPauliMultiple(M: C[][], k: number): boolean {
  const labels = ["I", "X", "Y", "Z"];
  for (let code = 0; code < 4 ** k; code++) {
    const label = Array.from({ length: k }, (_, i) => labels[(code >> (2 * (k - 1 - i))) & 3]).join("");
    const P = pauli(label);
    // M = c·P with |c| = 1  ⇔  Tr(P M)/d has modulus 1.
    const d = M.length;
    let re = 0, im = 0;
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) { const p = mul(P[i][j], M[j][i]); re += p[0]; im += p[1]; }
    if (Math.abs(Math.hypot(re, im) / d - 1) < 1e-9) return true;
  }
  return false;
}

/** The step's unitary on its own qubits (controls first, then targets), by simulation; null if it can't be evaluated. */
function localUnitary(s: Step, scope: Scope): C[][] | null {
  const qs = [...s.controls, ...s.targets];
  const k = qs.length, d = 1 << k;
  const local = new Map(qs.map((q, j) => [q, j]));
  const step: Step = { ...s, condition: undefined, controls: s.controls.map((q) => local.get(q)!), targets: s.targets.map((q) => local.get(q)!) };
  const U: C[][] = Array.from({ length: d }, () => new Array<C>(d));
  try {
    for (let j = 0; j < d; j++) {
      const psi = new Float64Array(2 * d);
      psi[2 * j] = 1;
      applyStep(psi, k, step, Math.random, scope);
      for (let i = 0; i < d; i++) U[i][j] = [psi[2 * i], psi[2 * i + 1]];
    }
  } catch {
    return null;
  }
  return U;
}

function isClifford(s: Step, scope: Scope): boolean {
  const k = s.controls.length + s.targets.length;
  if (k > 4) return false;
  const U = localUnitary(s, scope);
  if (!U) return false;
  const Ud = dagger(U);
  for (let q = 0; q < k; q++) {
    for (const p of ["X", "Z"]) {
      const label = Array.from({ length: k }, (_, i) => (i === q ? p : "I")).join("");
      if (!isPauliMultiple(matMul(matMul(U, pauli(label)), Ud), k)) return false;
    }
  }
  return true;
}

export function circuitResources(n: number, tape: Entry[], scope: Scope = {}): CircuitResources {
  const r: CircuitResources = {
    gates: 0, oneQubit: 0, twoQubit: 0, multiQubit: 0, measurements: 0, resets: 0,
    depth: 0, tCount: 0, tDepth: 0, cxCount: 0, cliffordCount: 0, parameterized: 0, symbols: [], longestQubit: 0,
  };
  const level = new Array<number>(n).fill(0);
  const tLevel = new Array<number>(n).fill(0);
  // Classical wires c[q] (measurements write them, IF reads them) join the depth, as in Qiskit.
  const cLevel = new Array<number>(n).fill(0);
  const cTLevel = new Array<number>(n).fill(0);
  const perQubit = new Array<number>(n).fill(0);
  const symbols = new Set<string>();
  const cache = new Map<string, boolean>();
  for (const s of tape.flat().flatMap(exported)) {
    const qs = [...s.controls, ...s.targets];
    const measures = MEASURE_IDS.has(s.gateId) && s.gateId !== "reset";
    const cs = [...(s.condition ? [s.condition.clbit] : []), ...(measures ? [s.targets[0]] : [])];
    r.gates++;
    // A conditional step is one `if_else` instruction on its qubits: counted by size only.
    if (s.condition) {
      if (qs.length === 1) r.oneQubit++;
      else if (qs.length === 2) r.twoQubit++;
      else r.multiQubit++;
    } else if (measures) r.measurements++;
    else if (s.gateId === "reset") r.resets++;
    else if (qs.length === 1) r.oneQubit++;
    else if (qs.length === 2) r.twoQubit++;
    else r.multiQubit++;
    const d = Math.max(...qs.map((q) => level[q]), ...cs.map((c) => cLevel[c])) + 1;
    const isT = (s.gateId === "t" || s.gateId === "tdg") && s.controls.length === 0 && !s.condition;
    const td = Math.max(...qs.map((q) => tLevel[q]), ...cs.map((c) => cTLevel[c])) + (isT ? 1 : 0);
    for (const q of qs) { level[q] = d; tLevel[q] = td; perQubit[q]++; }
    for (const c of cs) { cLevel[c] = d; cTLevel[c] = td; }
    for (const v of stepSymbols(s)) symbols.add(v);
    if (s.condition) continue;
    if (isT) r.tCount++;
    if (s.gateId === "x" && s.controls.length === 1 && (s.controlStates?.[0] ?? true)) r.cxCount++;
    if (s.params.length > 0) r.parameterized++;
    if (!NONUNITARY.has(s.gateId)) {
      const key = `${s.gateId}|${s.controls.length}|${s.controlStates ?? ""}|${s.params}|${stepSymbols(s).length ? JSON.stringify(scope) : ""}`;
      let c = cache.get(key);
      if (c === undefined) cache.set(key, (c = isClifford(s, scope)));
      if (c) r.cliffordCount++;
    }
  }
  r.depth = Math.max(0, ...level, ...cLevel);
  r.tDepth = Math.max(0, ...tLevel, ...cTLevel);
  r.longestQubit = Math.max(0, ...perQubit);
  r.symbols = [...symbols].sort();
  return r;
}
