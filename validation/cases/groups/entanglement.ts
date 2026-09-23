import { Register } from "../../../src/calc/register";
import { reducedDensityMatrix, purity } from "../../../src/sim/density";
import {
  densityEigenvalues, entanglementSpectrum, entropyProfile, mutualInformationMatrix, vonNeumannEntropy,
} from "../../../src/sim/entanglement";
import { negativityMatrix } from "../../../src/sim/negativity";
import { concurrenceMatrix } from "../../../src/sim/concurrence";
import { renyiSpectrum } from "../../../src/sim/renyiSpectrum";
import { pageEntropyBits } from "../../../src/sim/pageCurve";
import { allPauliExpectations } from "../../../src/sim/pauliSpectrum";
import { paulis, type Pauli } from "../../../src/sim/expectation";
import { stateCases, type StateCase } from "../states";

export const cases = (): StateCase[] => stateCases(3003);

/** Subsystems each case is probed on (sorted; QC-1 puts kept[0] as the MSB of ρ). */
export function subsets(n: number): number[][] {
  const s = [[0], [n - 1], [0, 1], [0, n - 1]];
  if (n >= 3) s.push([0, 1, 2], [1, n - 1]);
  if (n >= 5) s.push([0, 2, 4]);
  return s;
}

export const halfCut = (n: number) => [...Array(Math.floor(n / 2)).keys()];
export const pauliProbes = (n: number): string[] => {
  const P = "IXYZ";
  const out = ["Z".repeat(n), "X".repeat(n), "Y".repeat(n)];
  for (let k = 0; k < 6; k++) out.push(Array.from({ length: n }, (_, q) => P[(q * 7 + k * 3 + q * k) % 4]).join(""));
  return out;
};

/** Everything QC-1 computes for one case; the fixture stores the reference of each field. */
export function compute(c: StateCase) {
  const { n, state } = new Register(c.n, c.tape);
  const rdm = subsets(n).map((s) => {
    const rho = reducedDensityMatrix(state, n, s);
    return {
      kept: s,
      rho: { re: rho.map((r) => r.map((e) => e.re)), im: rho.map((r) => r.map((e) => e.im)) },
      purity: purity(rho),
      entropy: vonNeumannEntropy(rho),
      eigenvalues: densityEigenvalues(rho),
    };
  });
  const mi = mutualInformationMatrix(state, n)!;
  const spec = entanglementSpectrum(state, n, halfCut(n))!;
  const renyi = renyiSpectrum(state, n, halfCut(n))!;
  return {
    rdm,
    mi: mi.mi,
    single: mi.single,
    profile: entropyProfile(state, n)!.entropy,
    schmidt: { spectrum: spec.spectrum, entropy: spec.entropy, rank: spec.rank },
    renyi: { alphas: renyi.alphas, entropies: renyi.entropies, min: renyi.min, hartley: renyi.hartley },
    negativity: negativityMatrix(state, n)!.neg,
    concurrence: concurrenceMatrix(state, n)!.c,
    paulis: pauliProbes(n).map((p) => paulis(state, n, p.split("") as Pauli[])),
    allPaulis: n <= 3 ? Array.from(allPauliExpectations(state, n)) : null,
  };
}

/** Page's average entropy (bits) for subsystem sizes (mA, mB). */
export const pagePairs: [number, number][] = [[1, 1], [1, 2], [2, 2], [1, 3], [2, 3], [3, 3], [2, 4]];
export const computePage = () => pagePairs.map(([a, b]) => pageEntropyBits(a, b));
