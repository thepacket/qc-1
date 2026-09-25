import { Register } from "../../../src/calc/register";
import { exportQasm3 } from "../../../src/qasm/fromTape";
import { lowerTape } from "../../../src/calc/lower";
import { parsePauliSum } from "../../../src/sim/trotter";
import { internalPauliSum } from "../../../src/calc/order";
import { pauliSumExpectation } from "../../../src/sim/expectation";
import { observableMoments } from "../../../src/sim/observableVariance";
import { collectiveSpinGenerator, quantumFisherPure } from "../../../src/sim/qfi";
import { spinSqueezing } from "../../../src/sim/spinSqueezing";
import { multiparameterQFI } from "../../../src/sim/multiparamQfi";
import { participation, participationSweep } from "../../../src/sim/participation";
import { quantumGeometricTensor } from "../../../src/sim/qgt";
import { blochTrajectories } from "../../../src/sim/blochPath";
import { computeLandscape } from "../../../src/sim/optimize";
import type { Entry } from "../../../src/calc/steps";
import { stateCases, coherent, tPlus, type StateCase } from "../states";
import { step } from "../tapes";

/** One-axis-twisted (spin-squeezed) state: all qubits along +x, then RZZ(χ) on every pair. */
const twisted = (n: number, chi: string): Entry[] => {
  const t: Entry[] = Array.from({ length: n }, (_, q) => [step("ry", [q], [], ["π/2"])]);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) t.push([step("rzz", [i, j], [], [chi])]);
  return t;
};

export function stateCasesM(): StateCase[] {
  return [
    ...stateCases(6006, [3, 4, 5]),
    { id: "tplus3", n: 3, tape: tPlus(3) },
    { id: "coherent4", n: 4, tape: coherent(4, "1.1", "0.7") },
    { id: "twisted4", n: 4, tape: twisted(4, "0.3") },
    { id: "twisted6", n: 6, tape: twisted(6, "0.15") },
  ];
}

/** Hamiltonian texts for n qubits, as Qiskit writes Pauli strings (q0 rightmost); the last terms exercise signed-exponent coefficients. */
export function hams(n: number): string[] {
  const I = (ops: Record<number, string>) => Array.from({ length: n }, (_, p) => ops[n - 1 - p] ?? "I").join("");
  const zz = Array.from({ length: n - 1 }, (_, i) => `-1*${I({ [i]: "Z", [i + 1]: "Z" })}`).join(" + ");
  const x = Array.from({ length: n }, (_, i) => `0.7*${I({ [i]: "X" })}`).join(" - ");
  return [
    I({ 0: "Z" }),
    `${zz} - ${x}`,
    `0.5*${I({ 0: "X", [n - 1]: "Y" })} + 2.5E-1*${I({ 1: "Z" })} - 1e-3*${"Z".repeat(n)}`,
    `3*${"X".repeat(n)} + 1.5e+0*${"Y".repeat(n)} - 0.25*${I({ 0: "Y", 1: "X" })}`,
  ];
}

export function computeState(c: StateCase) {
  const { n, state } = new Register(c.n, c.tape);
  const probs = Array.from({ length: 1 << n }, (_, i) => state[2 * i] ** 2 + state[2 * i + 1] ** 2);
  return {
    hams: hams(n).map((h) => {
      // Computed with the strings in the simulator's order (a LAB input's conversion); recorded as written.
      const terms = parsePauliSum(internalPauliSum(h));
      const m = observableMoments(state, n, terms);
      return { terms: parsePauliSum(h), expectation: pauliSumExpectation(state, n, terms), mean: m.mean, second: m.second, variance: m.variance };
    }),
    qfi: (["X", "Y", "Z"] as const).map((a) => quantumFisherPure(state, n, collectiveSpinGenerator(n, a))),
    squeezing: spinSqueezing(state, n),
    multiQfi: multiparameterQFI(state, n),
    participation: participation(probs, n),
  };
}

// ── symbolic tapes: QGT, Bloch paths over t, prefix sweeps, landscape ──
export type SymCaseM = { id: string; n: number; tape: Entry[]; scope: Record<string, number>; symbols: string[] };

export function symCases(): SymCaseM[] {
  const s = (g: string, t: number[], p: string[] = [], c: number[] = []) => [step(g, t, c, p)];
  return [
    { id: "ry-theta", n: 1, symbols: ["theta"], scope: { theta: 0.4, t: 0 }, tape: [s("ry", [0], ["θ"])] },
    { id: "rabi", n: 2, symbols: ["theta", "t"], scope: { theta: 0.9, t: 1.3 },
      tape: [s("h", [0]), s("rx", [1], ["2*θ+π/4"]), s("rzz", [0, 1], ["t/2"]), s("ry", [0], ["θ*t"]), s("u", [1], ["t", "θ", "-t"])] },
    { id: "ansatz3", n: 3, symbols: ["phi", "theta", "t"], scope: { theta: -0.6, phi: 1.7, t: 0.2 },
      tape: [s("ry", [0], ["θ"]), s("ry", [1], ["φ"]), s("x", [1], [], [0]), s("rz", [2], ["φ-θ"]), s("x", [2], [], [1]), s("rx", [0], ["3*t"]), s("p", [2], ["t"]), s("rxx", [0, 2], ["θ"])] },
  ];
}

export const PATH_POINTS = 9;
export const LANDSCAPE_GRID = 7;

export async function computeSym(c: SymCaseM) {
  const circ = lowerTape(c.n, c.tape);
  const obs = parsePauliSum(internalPauliSum(hams(c.n)[c.n > 1 ? 1 : 0]));
  return {
    qgt: quantumGeometricTensor(circ, [], c.scope, c.symbols),
    bloch: c.symbols.includes("t") ? blochTrajectories(circ, c.scope, [], PATH_POINTS)!.path : null,
    sweep: participationSweep(circ, c.scope, [])!,
    prefixQasm: c.tape.map((_, k) => exportQasm3(c.n, c.tape.slice(0, k + 1))),
    landscape: await computeLandscape(circ, c.scope, [], { kind: "sum", terms: obs }, [c.symbols[0]], LANDSCAPE_GRID, [-Math.PI, Math.PI]),
    obs: parsePauliSum(hams(c.n)[c.n > 1 ? 1 : 0]), // as written (Qiskit's labels)
  };
}
