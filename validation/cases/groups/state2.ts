import { Register } from "../../../src/calc/register";
import { tripartiteInformation } from "../../../src/sim/tripartiteInfo";
import { countingStatistics } from "../../../src/sim/countingStatistics";
import { entanglementContour } from "../../../src/sim/entanglementContour";
import { schmidtGap } from "../../../src/sim/schmidtGap";
import { correlationLength } from "../../../src/sim/correlationLength";
import { mpsBondDimension } from "../../../src/sim/mpsBondDimension";
import { negativitySpectrum } from "../../../src/sim/negativitySpectrum";
import { threeTangle } from "../../../src/sim/threeTangle";
import { totalCorrelation } from "../../../src/sim/totalCorrelation";
import { chshMap } from "../../../src/sim/chsh";
import { quantumDiscordMap } from "../../../src/sim/quantumDiscord";
import { entanglementSpectrumStats } from "../../../src/sim/entanglementSpectrumStats";
import { multifractal } from "../../../src/sim/multifractal";
import { ptMoments } from "../../../src/sim/ptMoments";
import { zzCorrelations } from "../../../src/sim/correlations";
import { structureFactor } from "../../../src/sim/structureFactor";
import { symmetrySectors } from "../../../src/sim/symmetrySectors";
import { entanglementHamiltonian } from "../../../src/sim/entanglementHamiltonian";
import { coherenceFromAmplitudes, coherenceFromDensity } from "../../../src/sim/coherence";
import { reducedDensityMatrix } from "../../../src/sim/density";
import { discreteWigner } from "../../../src/sim/wigner";
import { husimiQ } from "../../../src/sim/husimi";
import { magic } from "../../../src/sim/magic";
import { magicSpectrum } from "../../../src/sim/magicSpectrum";
import { characteristicFunction } from "../../../src/sim/charFunction";
import { majoranaStars } from "../../../src/sim/majoranaStars";
import { anticoncentration } from "../../../src/sim/anticoncentration";
import { allPauliExpectations } from "../../../src/sim/pauliSpectrum";
import { coherent, stateCases, tPlus, wState, type StateCase } from "../states";

export function cases(): StateCase[] {
  return [
    ...stateCases(4004, [3, 4, 5, 6]),
    { id: "w3", n: 3, tape: wState() },
    { id: "tplus1", n: 1, tape: tPlus(1) },
    { id: "tplus3", n: 3, tape: tPlus(3) },
    { id: "coherent4", n: 4, tape: coherent(4, "1.1", "0.7") },
  ];
}

const half = (n: number) => [...Array(Math.max(1, Math.floor(n / 2))).keys()];
export const HUSIMI = { nTheta: 7, nPhi: 8 };

/** Everything QC-1 computes for one case (the fixture holds each field's reference). */
export function compute(c: StateCase) {
  const { n, state } = new Register(c.n, c.tape);
  const probs = [...Array(1 << n).keys()].map((i) => state[2 * i] ** 2 + state[2 * i + 1] ** 2);
  const out: Record<string, unknown> = {
    counting: countingStatistics(state, n, half(n)),
    multifractal: multifractal(state, n),
    symmetry: symmetrySectors(probs, n),
    coherence: coherenceFromAmplitudes(state, n),
    anticoncentration: n >= 2 ? anticoncentration(state, n) : null,
  };
  if (n >= 2) {
    const zz = zzCorrelations(state, n)!;
    out.zz = zz;
    const sf = structureFactor(state, n, 9)!;
    out.structure = { k: sf.k, s: sf.s };
    out.schmidtGap = schmidtGap(state, n)!.gap;
    out.mps = mpsBondDimension(state, n, 0.01);
    out.total = totalCorrelation(state, n);
    out.chsh = chshMap(state, n)!.s;
    out.discord = quantumDiscordMap(state, n)!.d;
    out.entHam = entanglementHamiltonian(state, n, half(n));
    out.contour = entanglementContour(state, n, Math.max(1, n - 1));
    const sub = n >= 3 ? [0, n - 1] : [0];
    out.coherenceMixed = { kept: sub, ...coherenceFromDensity(reducedDensityMatrix(state, n, sub), sub.length) };
    if (n <= 6) {
      out.negSpectrum = negativitySpectrum(state, n, half(n));
      out.ptMoments = ptMoments(state, n, half(n));
    }
  }
  if (n >= 3) {
    out.corrLength = correlationLength(state, n);
    const es = entanglementSpectrumStats(state, n, half(n));
    out.entStats = es && { ratios: es.ratios, meanR: es.meanR, levels: es.levels };
  }
  if (n === 3) out.threeTangle = [0, 1, 2].map((a) => threeTangle(state, n, a, (a + 1) % 3, (a + 2) % 3));
  if (n >= 4) out.tripartite = tripartiteInformation(state, n, 0, 1, n - 1);
  if (n <= 4) {
    out.wigner = discreteWigner(state, n);
    out.charFunction = characteristicFunction(state, n);
  }
  if (n <= 6) {
    const exp = allPauliExpectations(state, n);
    out.magic = magic(exp, n);
    out.magicSpectrum = magicSpectrum(exp, n);
    const mj = majoranaStars(state, n)!;
    out.majorana = { symmetricWeight: mj.symmetricWeight, stars: mj.stars };
  }
  if (n <= 7) out.husimi = husimiQ(state, n, HUSIMI.nTheta, HUSIMI.nPhi)!.Q;
  return out;
}
