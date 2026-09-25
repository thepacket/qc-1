import { applyStep, bitCount, exportedSteps, NONUNITARY, type Entry, type Scope } from "./steps";
import { drawCounts, stateProbs, settings, reconstructTomography, type Basis } from "./tomography";

/** A recorded branch is not an ensemble of independent circuit executions. */
export const needsReplay = (tape: Entry[]) => tape.some(e => e.some(s => exportedSteps(s).some(x => NONUNITARY.has(x.gateId) || !!x.condition)));

/** Execute the circuit afresh for every shot, then measure the requested qubits. */
export function circuitCounts(n: number, tape: Entry[], scope: Scope, kept: number[], basis: Basis[], shots: number, rng: () => number): Map<number, number> {
  // Keep each instruction intact: its condition is evaluated once, even
  // when a basis measurement writes the same classical bit it tests.
  const list = tape.flat().map(s => ({ ...s, outcome: undefined }));
  const classicalSize = bitCount(n, tape);
  const counts = new Map<number, number>();
  const setting: Basis[] = Array(n).fill(2);
  kept.forEach((q, j) => { setting[q] = basis[j]; });
  for (let shot = 0; shot < shots; shot++) {
    const state = new Float64Array(2 ** (n + 1));
    state[0] = 1;
    const bits = new Uint8Array(classicalSize);
    for (const s of list) applyStep(state, n, s, rng, scope, bits);
    const outcome = drawCounts(stateProbs(state, n, setting), 1, rng).keys().next().value!;
    const local = kept.reduce((x, q, j) => x | (((outcome >> q) & 1) << j), 0);
    counts.set(local, (counts.get(local) ?? 0) + 1);
  }
  return counts;
}

export function circuitTomography(n: number, tape: Entry[], scope: Scope, kept: number[], shots: number, rngOf: (k: number) => () => number) {
  const counts = settings(kept.length).map((s, k) => circuitCounts(n, tape, scope, kept, s, shots, rngOf(k)));
  return reconstructTomography(kept.length, shots, counts);
}
