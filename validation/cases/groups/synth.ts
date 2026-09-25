import { raiseCircuit } from "../../../src/calc/toolCircuit";
import { lowerTape } from "../../../src/calc/lower";
import { Register } from "../../../src/calc/register";
import { buildUnitary } from "../../../src/sim/unitary";
import type { Cx } from "../../../src/sim/unitarySynth";
import { internalPauliSum, prepCircuit, synthUnitary } from "../../../src/calc/order";
import { buildTrotterCircuit, parsePauliSum, type TrotterOrder } from "../../../src/sim/trotter";
import { exportQasm3 } from "../../../src/qasm/fromTape";
import type { Entry } from "../../../src/calc/steps";
import { rng, type Rng } from "../tapes";

/** Gaussian pair (Box–Muller). */
function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
}

/** Haar-random d×d unitary: Gram–Schmidt on a complex Gaussian matrix (columns). */
export function haarUnitary(r: Rng, d: number): Cx[][] {
  const cols: Cx[][] = [];
  for (let j = 0; j < d; j++) {
    const v: Cx[] = Array.from({ length: d }, () => ({ re: gauss(r), im: gauss(r) }));
    for (const u of cols) {
      let pr = 0, pi = 0; // ⟨u|v⟩
      for (let i = 0; i < d; i++) { pr += u[i].re * v[i].re + u[i].im * v[i].im; pi += u[i].re * v[i].im - u[i].im * v[i].re; }
      for (let i = 0; i < d; i++) { v[i].re -= pr * u[i].re - pi * u[i].im; v[i].im -= pr * u[i].im + pi * u[i].re; }
    }
    const nrm = Math.sqrt(v.reduce((s, x) => s + x.re ** 2 + x.im ** 2, 0));
    cols.push(v.map((x) => ({ re: x.re / nrm, im: x.im / nrm })));
  }
  return Array.from({ length: d }, (_, i) => cols.map((c) => c[i]));
}

export type PrepCase = { id: string; n: number; re: number[]; im: number[] };
export type SynthCase = { id: string; n: number; U: Cx[][] };
export type TrotterCase = { id: string; n: number; text: string; steps: number; order: TrotterOrder; t: number };

export function prepCases(): PrepCase[] {
  const r = rng(8008);
  const out: PrepCase[] = [];
  const basis = (n: number, k: number) => ({ re: Array.from({ length: 1 << n }, (_, i) => (i === k ? 1 : 0)), im: new Array(1 << n).fill(0) });
  out.push({ id: "basis101", n: 3, ...basis(3, 5) });
  out.push({ id: "ghz3", n: 3, re: [1, 0, 0, 0, 0, 0, 0, 1].map((x) => x / Math.SQRT2), im: new Array(8).fill(0) });
  out.push({ id: "w3", n: 3, re: [0, 1, 1, 0, 1, 0, 0, 0].map((x) => x / Math.sqrt(3)), im: new Array(8).fill(0) });
  out.push({ id: "phases2", n: 2, re: [0.5, 0, -0.5, 0], im: [0, 0.5, 0, -0.5] });
  for (let n = 1; n <= 5; n++) {
    for (const sparse of [false, true]) {
      const d = 1 << n;
      const re = Array.from({ length: d }, () => (sparse && r.next() < 0.5 ? 0 : gauss(r)));
      const im = re.map((x) => (x === 0 ? 0 : gauss(r)));
      if (re.every((x) => x === 0)) re[0] = 1;
      out.push({ id: `rand${n}${sparse ? "s" : ""}`, n, re, im });
    }
  }
  return out;
}

export function synthCases(): SynthCase[] {
  const r = rng(9009);
  const cx = (re: number, im = 0): Cx => ({ re, im });
  const out: SynthCase[] = [
    { id: "cnot", n: 2, U: [[cx(1), cx(0), cx(0), cx(0)], [cx(0), cx(1), cx(0), cx(0)], [cx(0), cx(0), cx(0), cx(1)], [cx(0), cx(0), cx(1), cx(0)]] },
    { id: "diag2", n: 2, U: [0, 0.4, -1.2, 2.5].map((a, i, arr) => arr.map((_, j) => (i === j ? cx(Math.cos(a), Math.sin(a)) : cx(0)))) },
  ];
  for (const n of [1, 1, 2, 2, 3, 3]) out.push({ id: `haar${n}-${out.length}`, n, U: haarUnitary(r, 1 << n) });
  return out;
}

export function trotterCases(): TrotterCase[] {
  return [
    { id: "tfim3-o1", n: 3, text: "-1*ZZI - 1*IZZ - 0.7*XII - 0.7*IXI - 0.7*IIX", steps: 3, order: 1, t: 0.37 },
    { id: "tfim3-o2", n: 3, text: "-1*ZZI - 1*IZZ - 0.7*XII - 0.7*IXI - 0.7*IIX", steps: 2, order: 2, t: 0.41 },
    { id: "heis3-o4", n: 3, text: "XXI + YYI + ZZI + IXX + IYY + IZZ + 0.3*ZII", steps: 2, order: 4, t: 0.23 },
    { id: "mixed2-o1", n: 2, text: "0.5*XY - 0.8*YZ + 1.3*ZX + 0.2*YI", steps: 4, order: 1, t: 0.19 },
    { id: "mixed4-o2", n: 4, text: "0.9*XIYZ - 0.4*IZZX + 0.6*YYII + 0.3*IIIX", steps: 3, order: 2, t: 0.29 },
  ];
}

const cplx = (u: { mag: Float64Array; phase: Float64Array }) => ({
  re: Array.from(u.mag, (m, i) => m * Math.cos(u.phase[i])),
  im: Array.from(u.mag, (m, i) => m * Math.sin(u.phase[i])),
});

export function computePrep(c: PrepCase) {
  const tape: Entry[] = raiseCircuit(prepCircuit(c.re, c.im, c.n)!);
  const reg = new Register(c.n, tape);
  // |⟨target|ψ⟩| with the target normalised.
  const nrm = Math.sqrt(c.re.reduce((s, x, i) => s + x * x + c.im[i] ** 2, 0));
  let pr = 0, pi = 0;
  for (let i = 0; i < 1 << c.n; i++) {
    const [tr, ti] = [c.re[i] / nrm, c.im[i] / nrm];
    pr += tr * reg.state[2 * i] + ti * reg.state[2 * i + 1];
    pi += tr * reg.state[2 * i + 1] - ti * reg.state[2 * i];
  }
  return { tape, qasm: exportQasm3(c.n, tape), overlap: Math.hypot(pr, pi), gates: tape.length };
}

export function computeSynth(c: SynthCase) {
  const tape: Entry[] = raiseCircuit({ numQubits: c.n, numClbits: 0, gates: synthUnitary(c.U, c.n)! });
  return { tape, qasm: exportQasm3(c.n, tape), unitary: cplx(buildUnitary(lowerTape(c.n, tape), {}, [])!), gates: tape.length };
}

export function computeTrotter(c: TrotterCase) {
  // The case's Hamiltonian is written as Qiskit writes Pauli strings (q0 rightmost), like a LAB input.
  const tape: Entry[] = raiseCircuit(buildTrotterCircuit(parsePauliSum(internalPauliSum(c.text)), { steps: c.steps, delta: "t", order: c.order }));
  return { tape, qasm: exportQasm3(c.n, tape), unitary: cplx(buildUnitary(lowerTape(c.n, tape), { t: c.t }, [])!) };
}
