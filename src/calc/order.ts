/**
 * Qiskit's bit order, QC-1's convention: qubit q is bit q of a basis index
 * (q0 least significant), and kets, bitstrings and Pauli strings are written
 * with q0 RIGHTMOST (|q(n−1)…q1 q0⟩, "XZI" puts X on q2). Inside the
 * simulator a Pauli string is indexed by qubit (character q acts on qubit q,
 * as the ported modules expect): `qiskitLabel` / `internalLabel` convert at the
 * boundary. Two ported synthesizers (statePrep, unitarySynth) still read
 * vectors and matrices with qubit 0 as the most significant bit: a circuit
 * they build, with its qubits mirrored (q → n−1−q), is the same vector or
 * matrix in Qiskit's order.
 */
import { synthesizeUnitary, type Cx } from "../sim/unitarySynth";
import { statePrepCircuit } from "../sim/statePrep";
import type { Circuit, PlacedGate } from "../sim/types";

/** A Pauli string or bitstring indexed by qubit (character q = qubit q), written as Qiskit prints it (q0 rightmost), or back. */
export const qiskitLabel = (s: string) => [...s].reverse().join("");
export const internalLabel = qiskitLabel;

/** A Pauli sum as the user writes it ("0.5*XZI + IIZ": q0 rightmost) with every string in the simulator's order (character q = qubit q), or back.
 * Normalize the same whitespace and letter case accepted by parsePauliSum
 * before reversing complete strings; leave numeric coefficients intact.
 */
export const internalPauliSum = (text: string) => text.replace(/\s+/g, "").replace(/[IXYZ]+/gi, (s) => qiskitLabel(s.toUpperCase()));
export const qiskitPauliSum = internalPauliSum;

/** A signed Pauli string ("+XZI", the tableau's order: qubit 0 first) as Qiskit writes it ("+IZX"). */
export const qiskitSigned = (g: string) => g[0] + qiskitLabel(g.slice(1));

/** Stabilizer generators (from `Stabilizer.stabilizers()`) as Qiskit writes them. */
export const qiskitGenerators = (gens: string[]) => gens.map(qiskitSigned);

/** A gate's qubits relabelled q → n−1−q: its circuit read in the other bit order. */
export function mirrorQubits<T extends { controls: number[]; targets: number[] }>(g: T, n: number): T {
  return { ...g, controls: g.controls.map((q) => n - 1 - q), targets: g.targets.map((q) => n - 1 - q) };
}

/** Upstream's state preparation (it reads qubit 0 as the most significant bit) for a vector in Qiskit's order. */
export function prepCircuit(re: number[], im: number[], n: number): Circuit | null {
  const c = statePrepCircuit(re, im, n);
  return c && { ...c, gates: c.gates.map((g) => mirrorQubits(g, n)) };
}

/** Upstream's two-level unitary synthesis (qubit 0 most significant) for a matrix in Qiskit's order. */
export function synthUnitary(U: Cx[][], n: number): PlacedGate[] | null {
  const g = synthesizeUnitary(U, n);
  return g && g.map((x) => mirrorQubits(x, n));
}
