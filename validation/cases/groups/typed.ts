import { CUSTOM_PREFIX, setCustomGates } from "../../../src/calc/custom";
import { applyStep, type Entry } from "../../../src/calc/steps";
import { matrixGate, parseMatrix, parseState, stateGate } from "../../../src/calc/typed";
import { exportQasm3 } from "../../../src/qasm/fromTape";
import { rng } from "../tapes";

/** A Haar-ish random unitary (QR of a Gaussian matrix, seeded), as typed text with 17 significant digits. */
function randomUnitaryText(seed: number, k: number): string {
  const r = rng(seed), d = 1 << k;
  const g = () => Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
  const A = Array.from({ length: d }, () => Array.from({ length: d }, () => [g(), g()]));
  // Gram–Schmidt on columns.
  for (let b = 0; b < d; b++) {
    for (let a = 0; a < b; a++) {
      let re = 0, im = 0;
      for (let i = 0; i < d; i++) { re += A[i][a][0] * A[i][b][0] + A[i][a][1] * A[i][b][1]; im += A[i][a][0] * A[i][b][1] - A[i][a][1] * A[i][b][0]; }
      for (let i = 0; i < d; i++) A[i][b] = [A[i][b][0] - (re * A[i][a][0] - im * A[i][a][1]), A[i][b][1] - (re * A[i][a][1] + im * A[i][a][0])];
    }
    const n = Math.sqrt(A.reduce((s, row) => s + row[b][0] ** 2 + row[b][1] ** 2, 0));
    for (let i = 0; i < d; i++) A[i][b] = [A[i][b][0] / n, A[i][b][1] / n];
  }
  const lit = ([re, im]: number[]) => `${re.toPrecision(17)}${im < 0 ? "-" : "+"}${Math.abs(im).toPrecision(17)}i`;
  return A.map((row) => row.map(lit).join(", ")).join("; ");
}

/** Typed matrices and states; `py` is the same thing as a numpy expression, written independently. */
export function cases() {
  return [
    { id: "hadamard", kind: "matrix", n: 1, qubits: [0], text: "1/√2, 1/√2; 1/√2, -1/√2", py: "np.array([[1,1],[1,-1]])/np.sqrt(2)" },
    { id: "phased-1q", kind: "matrix", n: 1, qubits: [0], text: "0.6i, 0.8; -0.8, -0.6i", py: "np.array([[0.6j,0.8],[-0.8,-0.6j]])" },
    { id: "sqrt-swap", kind: "matrix", n: 2, qubits: [0, 1], text: "1,0,0,0; 0,(1+i)/2,(1-i)/2,0; 0,(1-i)/2,(1+i)/2,0; 0,0,0,1", py: "np.array([[1,0,0,0],[0,(1+1j)/2,(1-1j)/2,0],[0,(1-1j)/2,(1+1j)/2,0],[0,0,0,1]])" },
    { id: "cs-on-q0-q2", kind: "matrix", n: 3, qubits: [0, 2], text: "1,0,0,0; 0,1,0,0; 0,0,1,0; 0,0,0,i", py: "np.diag([1,1,1,1j])" },
    ...[1, 2, 3].map((k) => ({ id: `random-${k}q`, kind: "matrix", n: k, qubits: [...Array(k).keys()], text: randomUnitaryText(40 + k, k), py: "text" })),
    { id: "bell-i", kind: "state", n: 2, qubits: [0, 1], text: "(|00⟩ + i|11⟩)/√2", py: "np.array([1,0,0,1j])/np.sqrt(2)" },
    { id: "w3", kind: "state", n: 3, qubits: [0, 1, 2], text: "|001⟩ + |010⟩ + |100⟩", py: "np.array([0,1,1,0,1,0,0,0])/np.sqrt(3)" },
    { id: "amplitudes", kind: "state", n: 2, qubits: [0, 1], text: "1, 2, 3i, -1", py: "np.array([1,2,3j,-1])/np.sqrt(15)" },
    { id: "state-on-q1-q3", kind: "state", n: 4, qubits: [1, 3], text: "0.6|01⟩ - 0.8i|10⟩", py: "np.array([0,0.6,-0.8j,0])" },
  ] as const;
}

type Case = ReturnType<typeof cases>[number];

export function tapeOf(c: Case): Entry[] {
  const def = c.kind === "state" ? stateGate("PSI1", parseState(c.text)) : matrixGate("M1", parseMatrix(c.text));
  setCustomGates([def]);
  return [[{ id: "t", gateId: CUSTOM_PREFIX + def.name, column: 0, targets: [...c.qubits], controls: [], clbits: [], params: [] }]];
}

/** QC-1's operator (columns) for matrices, its state from |0…0⟩ for states; and the QASM export. */
export function compute(c: Case) {
  const tape = tapeOf(c);
  const d = 1 << c.n;
  const cols: number[][] = [];
  for (let j = 0; j < (c.kind === "state" ? 1 : d); j++) {
    const st = new Float64Array(2 * d);
    st[2 * j] = 1;
    for (const e of tape) for (const s of e) applyStep(st, c.n, s, Math.random, {});
    cols.push(Array.from(st));
  }
  return { cols, qasm: exportQasm3(c.n, tape) };
}
