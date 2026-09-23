/**
 * QC-1 adapter — NOT a port. Upstream analyses call
 * `simulate(circuit, paramValues, customGates, options)`; this gives them
 * the same signature and the SimResult fields they read, but runs QC-1's
 * validated engine (`applyStep`: macros, state preps, controlled base gates,
 * recorded outcomes). The circuit is expected from `lowerTape`.
 *
 * Measurements force their recorded outcome (the result is post-selected
 * on the tape's history) unless it is impossible at these parameter values,
 * in which case it is sampled with `rng`.
 */
import type { Circuit } from "./types";
import { applyStep, symbolsOf, type Step } from "../calc/steps";
import { bloch, type Vec3 } from "../calc/analysis";
import { mulberry32 } from "./measure";

export type ParameterValues = Record<string, number>;

export type Amplitude = { basis: string; index: number; re: number; im: number; isZero: boolean };

export type SimResult = {
  numQubits: number;
  state: Float64Array;
  readonly probabilities: number[];
  readonly blochVectors: Vec3[];
  readonly amplitudes: Amplitude[];
  freeSymbols: string[];
  isStabilizer?: false;
};

export type SimulateOptions = {
  /** Computational basis state to start from (default |0…0⟩). */
  startIndex?: number;
  /** RNG for measurements that must be re-sampled. */
  rng?: () => number;
};

export const MAX_QUBITS = 20;

export function simulate(circuit: Circuit, paramValues: ParameterValues, _customGates?: unknown, options?: SimulateOptions): SimResult {
  const n = circuit.numQubits;
  if (n < 1 || n > MAX_QUBITS) throw new Error(`simulate: n must be 1–${MAX_QUBITS}`);
  const dim = 1 << n;
  const state = new Float64Array(2 * dim);
  state[2 * (options?.startIndex ?? 0)] = 1;
  const rng = options?.rng ?? mulberry32(0x5eed);
  const scope: ParameterValues = { ...paramValues };
  const syms = new Set<string>();
  for (const g of circuit.gates) for (const p of g.params) for (const v of symbolsOf(p)) {
    syms.add(v);
    if (!(v in scope)) scope[v] = 0;
  }
  // Stable order by column (array order within a column is application order).
  const gates = circuit.gates.map((g, i) => [g, i] as const).sort((a, b) => a[0].column - b[0].column || a[1] - b[1]);
  for (const [g] of gates) applyStep(state, n, g as Step, rng, scope);
  let probs: number[] | null = null, blochs: Vec3[] | null = null, amps: Amplitude[] | null = null;
  return {
    numQubits: n,
    state,
    freeSymbols: [...syms].sort(),
    get probabilities() {
      return (probs ??= Array.from({ length: dim }, (_, i) => state[2 * i] ** 2 + state[2 * i + 1] ** 2));
    },
    get blochVectors() {
      return (blochs ??= Array.from({ length: n }, (_, q) => bloch(state, n, q)));
    },
    get amplitudes() {
      return (amps ??= Array.from({ length: dim }, (_, i) => {
        const re = state[2 * i], im = state[2 * i + 1];
        return { basis: i.toString(2).padStart(n, "0"), index: i, re, im, isZero: re * re + im * im < 1e-24 };
      }));
    },
  };
}
