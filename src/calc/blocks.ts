/**
 * Builders for the Fourier and search blocks (the block library is
 * blockLib.ts). QFT is Qiskit's QFTGate (synth_qft_full for the other
 * settings) on the block's qubits in order (local qubit 0 is the least
 * significant bit), mapping |x⟩ to Σ_y e^{2πi x y / 2^k}|y⟩/√2^k with
 * x = Σ x_j 2^j. validation/ref/g_blocks.py checks every block against its
 * Qiskit object, exactly, global phase included.
 */
import type { Entry, Step } from "./steps";

let seq = 0;
const step = (gateId: string, targets: number[], controls: number[] = [], params: string[] = []): Step => ({
  id: `b${seq++}`, gateId, column: 0, targets, controls, clbits: [], params,
});

/**
 * QFT on local qubits 0..k−1 (0 the least significant bit, as Qiskit's QFTGate
 * and synth_qft_full): H on the most significant qubit first, its controlled
 * phases from the lower ones, and so on down, then the bit-reversal swaps.
 * `approx` drops the phases between qubits more than k−1−approx apart (the
 * smallest angles), as synth_qft_full's approximation_degree.
 */
export function qft(k: number, approx = 0, swaps = true): Entry[] {
  const out: Entry[] = [];
  const top = (j: number) => k - 1 - j; // the j-th most significant qubit
  for (let j = 0; j < k; j++) {
    out.push([step("h", [top(j)])]);
    for (let m = j + 1; m < k; m++) if (m - j <= k - 1 - approx) out.push([step("p", [top(j)], [top(m)], [`π/${2 ** (m - j)}`])]);
  }
  if (swaps) for (let j = 0; j < k >> 1; j++) out.push([step("swap", [j, k - 1 - j])]);
  return out;
}

/** The inverse: the same steps reversed, phases negated. */
export function iqft(k: number, approx = 0, swaps = true): Entry[] {
  return qft(k, approx, swaps).reverse().map((e) => e.map((s) => (s.gateId === "p" ? { ...s, params: [`-${s.params[0]}`] } : s)));
}

/** Grover diffuser 2|s⟩⟨s| − I exactly (the closing X Z X Z on qubit 0 is the −1 that H X (C…Z) X H lacks). */
export function diffuser(k: number): Entry[] {
  const all = (g: string) => [...Array(k).keys()].map((q) => step(g, [q]));
  const mcz = k === 1 ? step("z", [0]) : step("z", [k - 1], [...Array(k - 1).keys()]);
  return [all("h"), all("x"), [mcz], all("x"), all("h"), [step("x", [0])], [step("z", [0])], [step("x", [0])], [step("z", [0])]];
}

