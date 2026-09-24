import { Register } from "../../../src/calc/register";
import { lowerTape } from "../../../src/calc/lower";
import { buildUnitary } from "../../../src/sim/unitary";
import { pauliTransferMatrix } from "../../../src/sim/ptm";
import { operatorEntanglement } from "../../../src/sim/operatorEntanglement";
import { floquetSpectrum } from "../../../src/sim/floquetSpectrum";
import { parsePauliSum } from "../../../src/sim/trotter";
import { hamiltonianSpectrum } from "../../../src/sim/hamSpectrum";
import { densityOfStates } from "../../../src/sim/densityOfStates";
import { levelStatistics } from "../../../src/sim/levelStatistics";
import { spectralFormFactor } from "../../../src/sim/spectralFormFactor";
import { krylovComplexity } from "../../../src/sim/krylov";
import { ethOffDiagonal } from "../../../src/sim/ethOffDiagonal";
import { diagonalEnsemble } from "../../../src/sim/diagonalEnsemble";
import { effectiveTemperature } from "../../../src/sim/effectiveTemperature";
import { eigenstateEntanglement } from "../../../src/sim/eigenstateEntanglement";
import { workDistribution } from "../../../src/sim/workDistribution";
import { berryPhase } from "../../../src/sim/berryPhase";
import { chernNumber } from "../../../src/sim/chernNumber";
import type { Entry } from "../../../src/calc/steps";
import { productLayer, randomTape, rng, step } from "../tapes";

export type CircCase = { id: string; n: number; tape: Entry[] };

/** Unitary tapes: random, Clifford (degenerate Floquet spectrum), identity, a small QFT. */
export function circCases(): CircCase[] {
  const r = rng(7007);
  const s = (g: string, t: number[], p: string[] = [], c: number[] = []): Entry => [step(g, t, c, p)];
  return [
    { id: "empty2", n: 2, tape: [] },
    { id: "cnot", n: 2, tape: [s("x", [1], [], [0])] },
    { id: "swap", n: 2, tape: [s("swap", [0, 1])] },
    { id: "ghz3", n: 3, tape: [s("h", [0]), s("x", [1], [], [0]), s("x", [2], [], [1])] },
    { id: "qft3", n: 3, tape: [s("h", [0]), s("p", [0], ["π/2"], [1]), s("p", [0], ["π/4"], [2]), s("h", [1]), s("p", [1], ["π/2"], [2]), s("h", [2]), s("swap", [0, 2])] },
    ...[1, 2, 3, 4].map((n) => ({ id: `rand${n}`, n, tape: [...productLayer(r, n), ...randomTape(r, n, 3 * n)] })),
  ];
}

/** Hamiltonians: degenerate (ZZ chain, pure field), TFIM, and generic random couplings. */
export function hamCases(): { id: string; n: number; text: string; degenerate: boolean; state?: string }[] {
  return [
    { id: "zz3", n: 3, text: "ZZI + IZZ", degenerate: true },
    { id: "zfield3", n: 3, text: "ZII + IZI + IIZ", degenerate: true },
    { id: "tfim4", n: 4, text: "-1*ZZII - 1*IZZI - 1*IIZZ - 0.7*XIII - 0.7*IXII - 0.7*IIXI - 0.7*IIIX", degenerate: false },
    { id: "rand3", n: 3, text: "0.73*XYI - 0.41*IZZ + 0.29*YIX + 1.13*ZII - 0.37*IXI + 0.61*IIY + 0.23*ZXZ", degenerate: false },
    { id: "rand4", n: 4, text: "0.8*XXII + 0.6*IYYI - 0.9*IIZZ + 0.35*ZIIX + 0.47*IXIZ - 0.21*YIYI + 0.33*IIIX + 0.19*ZIII", degenerate: false },
    // |00⟩ is this H's ground state: no Boltzmann fit, energy-matched β = +∞.
    { id: "ground2", n: 2, text: "-1*ZI - 0.5*IZ", degenerate: false, state: "empty2" },
  ];
}

const SAMPLES = 24;

export function computeCirc(c: CircCase) {
  const circ = lowerTape(c.n, c.tape);
  const U = buildUnitary(circ, {}, [])!;
  return {
    unitary: { re: Array.from(U.mag, (m, i) => m * Math.cos(U.phase[i])), im: Array.from(U.mag, (m, i) => m * Math.sin(U.phase[i])) },
    ptm: c.n <= 2 ? pauliTransferMatrix(circ, {}, [])!.R : null,
    opEnt: c.n >= 2 ? operatorEntanglement(circ, {}, [])! : null,
    floquet: (() => {
      const f = floquetSpectrum(circ, {}, [])!;
      return { quasiEnergies: [...f.quasiEnergies].sort((a, b) => a - b), spacings: f.spacings, meanR: f.meanR };
    })(),
  };
}

/** Group (energy, weight) pairs by level: basis-independent even with degeneracy. */
function perLevel(energies: number[], weights: number[]) {
  const out: { energy: number; weight: number }[] = [];
  energies.forEach((e, k) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last.energy - e) < 1e-8) last.weight += weights[k];
    else out.push({ energy: e, weight: weights[k] });
  });
  return out;
}

export function computeHam(h: ReturnType<typeof hamCases>[number], state: CircCase) {
  const terms = parsePauliSum(h.text);
  const spec = hamiltonianSpectrum(terms, h.n)!;
  const psi = new Register(state.n, state.tape).state;
  const de = diagonalEnsemble(terms, psi, h.n)!;
  const kr = krylovComplexity(terms, psi, h.n, { samples: SAMPLES })!;
  const sff = spectralFormFactor(spec.energies, SAMPLES)!;
  const out: Record<string, unknown> = {
    spectrum: spec,
    dos: densityOfStates(spec.energies),
    levels: levelStatistics(spec.energies),
    sff,
    krylov: { a: kr.a, b: kr.b, krylovDim: kr.krylovDim, times: kr.times, complexity: kr.complexity },
    ensemble: { perLevel: perLevel(de.energies, de.populations), meanEnergy: de.meanEnergy, energySpread: de.energySpread },
    work: workDistribution(terms, lowerTape(state.n, state.tape), {}, [])!,
  };
  if (!h.degenerate) {
    const eth = ethOffDiagonal(terms, parsePauliSum("Z" + "I".repeat(h.n - 1)), h.n)!;
    const ee = eigenstateEntanglement(terms, h.n)!;
    const et = effectiveTemperature(de);
    out.eth = { diag: eth.diag, meanOffDiag: eth.meanOffDiag, offDiag: eth.offDiag };
    out.ensembleFull = { populations: de.populations, ipr: de.ipr, effectiveDim: de.effectiveDim };
    out.eigEnt = ee;
    out.effTemp = { beta: et.fitted ? et.beta : null, r2: et.fitted ? et.r2 : null, intercept: et.fitted ? et.intercept : null, betaEnergy: Number.isFinite(et.betaEnergy) ? et.betaEnergy : String(et.betaEnergy) };
  }
  return out;
}

// ── Berry phase and Chern number over two symbols ─────────────────────
export type GeomCase = { id: string; n: number; tape: Entry[]; scope: Record<string, number> };
export function geomCases(): GeomCase[] {
  const s = (g: string, t: number[], p: string[] = [], c: number[] = []): Entry => [step(g, t, c, p)];
  return [
    // spin-½ coherent state |θ, φ⟩: Berry phase = −(solid angle)/2
    { id: "spin", n: 1, scope: { theta: 1.1, phi: 0.4 }, tape: [s("u", [0], ["θ", "φ", "0"])] },
    { id: "twoq", n: 2, scope: { theta: 0.7, phi: -0.3 },
      tape: [s("ry", [0], ["θ"]), s("rz", [0], ["φ"]), s("x", [1], [], [0]), s("ry", [1], ["φ/2"]), s("rzz", [0, 1], ["θ"])] },
  ];
}
export const CHERN_GRID = 6;
export function computeGeom(g: GeomCase) {
  const circ = lowerTape(g.n, g.tape);
  const b = berryPhase(circ, g.scope, [], "theta", "phi", 0.5, 8)!;
  const c = chernNumber(circ, g.scope, [], "theta", "phi", CHERN_GRID)!;
  return { berry: { gamma: b.gamma, overlapMagnitude: b.overlapMagnitude, loop: b.loop }, chern: { chern: c.chern, curvature: c.curvature } };
}
