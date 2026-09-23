/**
 * The error channels a noise model attaches to one exported instruction
 * (see model.ts for the rules), as Pauli mixtures (state-independent) or
 * Kraus sets (amplitude/phase damping).
 */
import type { Matrix } from "../sim/matrices";
import type { Step } from "../calc/steps";
import { NAMED } from "../calc/lower";
import { CUSTOM_PREFIX } from "../calc/custom";
import { rate, type NoiseModel } from "./model";

export type Channel =
  | { kind: "pauli"; qubits: number[]; /** probability of each non-identity Pauli string (length 4^k − 1, I… first skipped) */ p: number }
  | { kind: "kraus"; qubits: number[]; ops: Matrix[] };

/** The instruction's name as exported (x with one control → cx, custom:G1 → G1). */
export function instructionName(s: Step): string {
  if (s.gateId.startsWith(CUSTOM_PREFIX)) return s.gateId.slice(CUSTOM_PREFIX.length);
  // A controlled gate is never its base gate (a per-gate "h" rate must not hit a controlled H).
  return NAMED[s.gateId]?.[s.controls.length] ?? (s.controls.length ? `${"c".repeat(s.controls.length)}${s.gateId}` : s.gateId);
}

/** amplitude_damping_error(γ): K0 = diag(1, √(1−γ)), K1 = √γ |0⟩⟨1|. */
export const amplitudeDamping = (g: number): Matrix[] => [
  [[[1, 0], [0, 0]], [[0, 0], [Math.sqrt(1 - g), 0]]],
  [[[0, 0], [Math.sqrt(g), 0]], [[0, 0], [0, 0]]],
];

/** phase_damping_error(γ): K0 = diag(1, √(1−γ)), K1 = √γ |1⟩⟨1|. */
export const phaseDamping = (g: number): Matrix[] => [
  [[[1, 0], [0, 0]], [[0, 0], [Math.sqrt(1 - g), 0]]],
  [[[0, 0], [0, 0]], [[0, 0], [Math.sqrt(g), 0]]],
];

/** Channels after one unitary instruction `s` (already expanded as exported). */
export function channelsAfter(m: NoiseModel, s: Step): Channel[] {
  const qs = [...s.controls, ...s.targets];
  const out: Channel[] = [];
  const named = m.perGate?.[instructionName(s)];
  if (qs.length === 1) {
    const p = named ?? rate(m, "p1", qs[0]);
    if (p > 0) out.push({ kind: "pauli", qubits: qs, p: p / 4 });
  } else if (qs.length === 2) {
    const p = named ?? m.p2;
    if (p > 0) out.push({ kind: "pauli", qubits: qs, p: p / 16 });
  } else {
    const p = named ?? m.p2;
    if (p > 0) for (const q of qs) out.push({ kind: "pauli", qubits: [q], p: p / 4 });
  }
  for (const q of qs) {
    const ad = rate(m, "ad", q), pd = rate(m, "pd", q);
    if (ad > 0) out.push({ kind: "kraus", qubits: [q], ops: amplitudeDamping(ad) });
    if (pd > 0) out.push({ kind: "kraus", qubits: [q], ops: phaseDamping(pd) });
  }
  if (qs.length === 2 && m.crosstalk > 0 && m.coupling) {
    const [a, b] = qs;
    const spectators = new Set([...(m.coupling[a] ?? []), ...(m.coupling[b] ?? [])].filter((x) => x !== a && x !== b));
    for (const x of [...spectators].sort((u, v) => u - v)) out.push({ kind: "pauli", qubits: [x], p: m.crosstalk / 4 });
  }
  return out;
}

const I: Matrix = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
const X: Matrix = [[[0, 0], [1, 0]], [[1, 0], [0, 0]]];
const Y: Matrix = [[[0, 0], [0, -1]], [[0, 1], [0, 0]]];
const Z: Matrix = [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]];
export const PAULI_1: Matrix[] = [I, X, Y, Z];

function kron(A: Matrix, B: Matrix): Matrix {
  const a = A.length, b = B.length;
  return Array.from({ length: a * b }, (_, i) => Array.from({ length: a * b }, (_, j) => {
    const [x, y] = A[Math.floor(i / b)][Math.floor(j / b)], [u, v] = B[i % b][j % b];
    return [x * u - y * v, x * v + y * u] as const;
  }));
}

/** Pauli string number c (base 4, first qubit most significant) on k qubits, as a matrix. */
export function pauliMatrix(c: number, k: number): Matrix {
  let M: Matrix = [[[1, 0]]];
  for (let i = k - 1; i >= 0; i--) M = kron(M, PAULI_1[(c >> (2 * i)) & 3]);
  return M;
}
