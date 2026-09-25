/**
 * Clifford recognition for stabilizer mode. A step on one or two qubits
 * (controls included) is Clifford when its matrix is in the Clifford group;
 * it is then replaced by a shortest H/S/CX sequence found by a breadth-first
 * enumeration of the group (24 one-qubit and 11 520 two-qubit elements, up
 * to a global phase, which a stabilizer state doesn't carry). Anything on
 * three or more qubits is refused (no such QC-1 gate is Clifford).
 */
import { applyStep, exportedSteps, MACROS, NONUNITARY, type Scope, type Step } from "../calc/steps";
import { customOf, expandCustom } from "../calc/custom";

type M = Float64Array; // d×d complex, row-major, re/im interleaved
export type Prim = { gate: "h" | "s" | "cx"; qubits: number[] }; // local qubit indices

const mul = (A: M, B: M, d: number): M => {
  const o = new Float64Array(2 * d * d);
  for (let i = 0; i < d; i++) for (let k = 0; k < d; k++) {
    const ar = A[2 * (i * d + k)], ai = A[2 * (i * d + k) + 1];
    if (!ar && !ai) continue;
    for (let j = 0; j < d; j++) {
      const br = B[2 * (k * d + j)], bi = B[2 * (k * d + j) + 1];
      o[2 * (i * d + j)] += ar * br - ai * bi;
      o[2 * (i * d + j) + 1] += ar * bi + ai * br;
    }
  }
  return o;
};

/** A key for a unitary up to its global phase. */
function key(U: M): string {
  let k = 0;
  while (Math.hypot(U[2 * k], U[2 * k + 1]) < 1e-6) k++;
  const m = Math.hypot(U[2 * k], U[2 * k + 1]), pr = U[2 * k] / m, pi = -U[2 * k + 1] / m;
  const parts: string[] = [];
  for (let i = 0; i < U.length / 2; i++) {
    const re = U[2 * i] * pr - U[2 * i + 1] * pi, im = U[2 * i] * pi + U[2 * i + 1] * pr;
    parts.push(`${Math.round(re * 1e5)},${Math.round(im * 1e5)}`);
  }
  return parts.join(";");
}

const s2 = Math.SQRT1_2;
const H1: M = Float64Array.from([s2, 0, s2, 0, s2, 0, -s2, 0]);
const S1: M = Float64Array.from([1, 0, 0, 0, 0, 0, 0, 1]);
const I1: M = Float64Array.from([1, 0, 0, 0, 0, 0, 1, 0]);
const kron = (A: M, B: M, a: number, b: number): M => {
  const d = a * b, o = new Float64Array(2 * d * d);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    const [ar, ai] = [A[2 * (Math.floor(i / b) * a + Math.floor(j / b))], A[2 * (Math.floor(i / b) * a + Math.floor(j / b)) + 1]];
    const [br, bi] = [B[2 * ((i % b) * b + (j % b))], B[2 * ((i % b) * b + (j % b)) + 1]];
    o[2 * (i * d + j)] = ar * br - ai * bi;
    o[2 * (i * d + j) + 1] = ar * bi + ai * br;
  }
  return o;
};
// Two-qubit matrices below are written with the left Kronecker factor as the high bit. The
// simulator (whose matrices localMatrix reads) has local qubit j as bit j (Qiskit's order),
// so the left factor is local qubit 1 and the right one local qubit 0.
const CX01: M = (() => { const o = new Float64Array(32); [[0, 0], [1, 1], [2, 3], [3, 2]].forEach(([i, j]) => (o[2 * (i * 4 + j)] = 1)); return o; })();
const CX10: M = (() => { const o = new Float64Array(32); [[0, 0], [1, 3], [2, 2], [3, 1]].forEach(([i, j]) => (o[2 * (i * 4 + j)] = 1)); return o; })();

type Table = Map<string, Prim[]>;

function enumerate(d: number, gens: { M: M; p: Prim }[]): Table {
  const id = d === 2 ? I1 : kron(I1, I1, 2, 2);
  const table: Table = new Map([[key(id), []]]);
  const queue: [M, Prim[]][] = [[id, []]];
  for (let h = 0; h < queue.length; h++) {
    const [U, seq] = queue[h];
    for (const g of gens) {
      const V = mul(g.M, U, d);
      const k = key(V);
      if (table.has(k)) continue;
      const s = [...seq, g.p];
      table.set(k, s);
      queue.push([V, s]);
    }
  }
  return table;
}

let T1: Table | null = null, T2: Table | null = null;
const table1 = () => (T1 ??= enumerate(2, [{ M: H1, p: { gate: "h", qubits: [0] } }, { M: S1, p: { gate: "s", qubits: [0] } }]));
const table2 = () => (T2 ??= enumerate(4, [
  { M: kron(H1, I1, 2, 2), p: { gate: "h", qubits: [1] } }, { M: kron(I1, H1, 2, 2), p: { gate: "h", qubits: [0] } },
  { M: kron(S1, I1, 2, 2), p: { gate: "s", qubits: [1] } }, { M: kron(I1, S1, 2, 2), p: { gate: "s", qubits: [0] } },
  { M: CX01, p: { gate: "cx", qubits: [1, 0] } }, { M: CX10, p: { gate: "cx", qubits: [0, 1] } },
]));

/** The group sizes (for tests): 24 and 11 520. */
export const groupSizes = () => [table1().size, table2().size];

/** The step's matrix on its own qubits (controls first, then targets), by simulation. */
function localMatrix(s: Step, scope: Scope): { U: M; qubits: number[] } | null {
  const qubits = [...s.controls, ...s.targets];
  const k = qubits.length, d = 1 << k;
  const local = new Map(qubits.map((q, j) => [q, j]));
  const st: Step = { ...s, condition: undefined, controls: s.controls.map((q) => local.get(q)!), targets: s.targets.map((q) => local.get(q)!) };
  const U = new Float64Array(2 * d * d);
  try {
    for (let j = 0; j < d; j++) {
      const psi = new Float64Array(2 * d);
      psi[2 * j] = 1;
      applyStep(psi, k, st, Math.random, scope);
      for (let i = 0; i < d; i++) { U[2 * (i * d + j)] = psi[2 * i]; U[2 * (i * d + j) + 1] = psi[2 * i + 1]; }
    }
  } catch {
    return null;
  }
  return { U, qubits };
}

const CACHE = new Map<string, Prim[] | null>();

/**
 * H/S/CX primitives (global qubits) equal to a unitary step up to a global
 * phase, or null when it isn't Clifford on at most two qubits.
 */
export function cliffordPrims(s: Step, scope: Scope = {}): { gate: Prim["gate"]; qubits: number[] }[] | null {
  const def = customOf(s.gateId);
  if (def || MACROS[s.gateId]) {
    // Expand (a custom gate's body, or a macro) and decompose each part.
    const parts = def ? expandCustom(s, def) : null;
    if (!parts) return null; // rccx/rcccx are not Clifford
    const out: { gate: Prim["gate"]; qubits: number[] }[] = [];
    for (const p of parts) {
      const r = cliffordPrims(p, scope);
      if (!r) return null;
      out.push(...r);
    }
    return out;
  }
  const qubits = [...s.controls, ...s.targets];
  if (qubits.length > 2 || NONUNITARY.has(s.gateId)) return null;
  const ck = `${s.gateId}|${s.controls.length}|${s.controlStates ?? ""}|${s.params.join(",")}|${JSON.stringify(scope)}`;
  let local = CACHE.get(ck);
  if (local === undefined) {
    const lm = localMatrix(s, scope);
    local = lm ? (qubits.length === 1 ? table1() : table2()).get(key(lm.U)) ?? null : null;
    CACHE.set(ck, local);
  }
  return local && local.map((p) => ({ gate: p.gate, qubits: p.qubits.map((j) => qubits[j]) }));
}

/** True when every step of the tape can run on the stabilizer tableau. */
export function isCliffordTape(tape: Step[][], scope: Scope = {}): boolean {
  return tape.every((e) => e.every((s) => {
    for (const x of exportedSteps(s)) {
      if (NONUNITARY.has(x.gateId)) continue;
      if (!cliffordPrims(x, scope)) return false;
    }
    return true;
  }));
}
