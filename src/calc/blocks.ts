/**
 * Algorithm blocks for the palette: QFT, inverse QFT, Grover diffuser and a
 * QAOA layer on k qubits. They follow Qiskit: QFT is Qiskit's QFTGate on the
 * block's qubits in order (local qubit 0 is the least significant bit), mapping
 * |x⟩ to Σ_y e^{2πi x y / 2^k}|y⟩/√2^k with x = Σ x_j 2^j.
 *
 * QFT, QFT† and the diffuser become custom gates (QFT3, IQFT3, DIFF3, …), so a
 * block is one tape step that exports as a `gate` definition. The QAOA layer
 * stays two plain entries (cost, then mixer), so its angles can be symbols.
 * validation/ref/g_blocks.py checks every block against Qiskit (QFTGate,
 * QAOAAnsatz) or its defining matrix, exactly, global phase included.
 */
import type { Entry, Step } from "./steps";
import type { CustomGate } from "./custom";

export type BlockKind = "qft" | "iqft" | "diff" | "qaoa";

let seq = 0;
const step = (gateId: string, targets: number[], controls: number[] = [], params: string[] = []): Step => ({
  id: `b${seq++}`, gateId, column: 0, targets, controls, clbits: [], params,
});

/**
 * QFT on local qubits 0..k−1 (0 the least significant bit, as Qiskit's QFTGate):
 * H on the most significant qubit first, its controlled phases from the lower
 * ones, and so on down, then the bit-reversal swaps.
 */
function qft(k: number): Entry[] {
  const out: Entry[] = [];
  const top = (j: number) => k - 1 - j; // the j-th most significant qubit
  for (let j = 0; j < k; j++) {
    out.push([step("h", [top(j)])]);
    for (let m = j + 1; m < k; m++) out.push([step("p", [top(j)], [top(m)], [`π/${2 ** (m - j)}`])]);
  }
  for (let j = 0; j < k >> 1; j++) out.push([step("swap", [j, k - 1 - j])]);
  return out;
}

/** The inverse: the same steps reversed, phases negated. */
function iqft(k: number): Entry[] {
  return qft(k).reverse().map((e) => e.map((s) => (s.gateId === "p" ? { ...s, params: [`-${s.params[0]}`] } : s)));
}

/** Grover diffuser 2|s⟩⟨s| − I exactly (the closing X Z X Z on qubit 0 is the −1 that H X (C…Z) X H lacks). */
function diffuser(k: number): Entry[] {
  const all = (g: string) => [...Array(k).keys()].map((q) => step(g, [q]));
  const mcz = k === 1 ? step("z", [0]) : step("z", [k - 1], [...Array(k - 1).keys()]);
  return [all("h"), all("x"), [mcz], all("x"), all("h"), [step("x", [0])], [step("z", [0])], [step("x", [0])], [step("z", [0])]];
}

const NAMES: Record<Exclude<BlockKind, "qaoa">, string> = { qft: "QFT", iqft: "IQFT", diff: "DIFF" };

/** The custom gate for a parameter-free block on k qubits (QFT3, IQFT3, DIFF3). */
export function blockGate(kind: Exclude<BlockKind, "qaoa">, k: number): CustomGate {
  const tape = kind === "qft" ? qft(k) : kind === "iqft" ? iqft(k) : diffuser(k);
  return { name: `${NAMES[kind]}${k}`, k, tape };
}

/**
 * One QAOA layer for MaxCut on a ring of the given qubits (a path for two):
 * RZZ(2γ) on every edge, then RX(2β) on every qubit, i.e. e^{−iβΣX} e^{−iγΣZZ},
 * Qiskit's QAOAAnsatz with cost Σ ZᵢZⱼ and one repetition.
 */
export function qaoaLayer(qubits: number[], gamma: string, beta: string): Entry[] {
  const k = qubits.length;
  const edges: [number, number][] = k === 2 ? [[qubits[0], qubits[1]]] : qubits.map((q, i) => [q, qubits[(i + 1) % k]]);
  const twice = (e: string) => `2*(${e})`;
  return [
    edges.map(([a, b]) => step("rzz", [a, b], [], [twice(gamma)])),
    qubits.map((q) => step("rx", [q], [], [twice(beta)])),
  ];
}

/** The QAOA ring's edges on k local qubits (for the validation's cost operator). */
export const qaoaEdges = (k: number): [number, number][] => (k === 2 ? [[0, 1]] : [...Array(k).keys()].map((i) => [i, (i + 1) % k]));
