import { lowerTape } from "../../../src/calc/lower";
import { exportQasm3 } from "../../../src/qasm/fromTape";
import { tSweepZ, tSweepSpectrum } from "../../../src/sim/tsweep";
import { loschmidtEcho } from "../../../src/sim/loschmidt";
import { imbalanceSweep } from "../../../src/sim/imbalance";
import { entanglementVelocity } from "../../../src/sim/entanglementVelocity";
import { negativityDynamics } from "../../../src/sim/negativityDynamics";
import { otoc } from "../../../src/sim/otoc";
import { otocLightcone } from "../../../src/sim/otocLightcone";
import { butterflyVelocity } from "../../../src/sim/butterflyVelocity";
import { lyapunovExponent } from "../../../src/sim/lyapunov";
import { operatorWeightGrowth } from "../../../src/sim/operatorWeight";
import { temporalAutocorrelation } from "../../../src/sim/autocorrelation";
import { spaceTimeZ, spaceTimeEntropy } from "../../../src/sim/spacetime";
import { entanglementAsymmetrySweep } from "../../../src/sim/entanglementAsymmetry";
import type { Entry } from "../../../src/calc/steps";
import { step } from "../tapes";

export type DynCase = { id: string; n: number; tape: Entry[]; scope: Record<string, number> };
const s = (g: string, t: number[], p: string[] = [], c: number[] = []): Entry => [step(g, t, c, p)];

export function cases(): DynCase[] {
  const ising = (n: number): Entry[] => {
    const out: Entry[] = [];
    for (let r = 0; r < 2; r++) {
      for (let q = 0; q + 1 < n; q++) out.push(s("rzz", [q, q + 1], ["t"]));
      for (let q = 0; q < n; q++) out.push(s("rx", [q], ["t/2"]));
    }
    return out;
  };
  return [
    { id: "rabi", n: 1, scope: { t: 0 }, tape: [s("rx", [0], ["t"])] },
    // ⟨Z⟩ = cos 8t: all its weight in the Nyquist bin of the 16-sample spectrum.
    { id: "nyquist", n: 1, scope: { t: 0 }, tape: [s("rx", [0], ["8*t"])] },
    // A slow XX rotation: the OTOC rises over most of the sweep (a growth window of several samples).
    { id: "slowxx", n: 2, scope: { t: 0 }, tape: [s("h", [0]), s("rxx", [0, 1], ["t/4"])] },
    { id: "twofreq", n: 2, scope: { t: 0, theta: 0.3 }, tape: [s("rx", [0], ["2*t"]), s("ry", [1], ["t+θ"]), s("x", [1], [], [0])] },
    { id: "ising3", n: 3, scope: { t: 0 }, tape: [s("x", [1]), ...ising(3)] },
    { id: "scramble4", n: 4, scope: { t: 0 },
      tape: [s("h", [0]), s("x", [2]), ...ising(4), s("ry", [1], ["0.7"]), s("rzz", [0, 3], ["t/3"]), s("t", [2])] },
  ];
}

export const P = { sweep: 9, spec: 16, otoc: 9, cone: 7, opw: 5 };

export function compute(c: DynCase) {
  const circ = lowerTape(c.n, c.tape);
  const sc = c.scope;
  const half = [...Array(Math.max(1, Math.floor(c.n / 2))).keys()];
  const lo = loschmidtEcho(circ, sc, [], P.sweep)!;
  const im = imbalanceSweep(circ, sc, [], P.sweep)!;
  const ac = temporalAutocorrelation(circ, sc, [], 0, P.sweep)!;
  const out: Record<string, unknown> = {
    tsweep: tSweepZ(circ, sc, [], P.sweep)!.z,
    spectrum: tSweepSpectrum(circ, sc, [], P.spec)!.mag,
    loschmidt: { L: lo.L, rate: lo.rate },
    imbalance: { imbalance: im.imbalance, plateau: im.plateau },
    autocorr: { C: ac.C, spectrum: ac.spectrum },
    spacetime: spaceTimeZ(circ, sc, [])!.z,
    prefixQasm: c.tape.map((_, k) => exportQasm3(c.n, c.tape.slice(0, k + 1))),
  };
  if (c.n <= 4) out.opweight = operatorWeightGrowth(circ, sc, [], 0, "Z", P.opw)!.weights;
  if (c.n >= 2) {
    const v = entanglementVelocity(circ, sc, [], P.sweep)!;
    out.velocity = { entropy: v.entropy, velocity: v.velocity, velocityAt: v.velocityAt, maxEntropy: v.maxEntropy };
    out.negdyn = negativityDynamics(circ, sc, [], half, P.sweep)!.logNeg;
    const o = otoc(circ, sc, [], 0, c.n - 1, "Z", "Z", P.otoc)!;
    out.otoc = { C: o.C, reF: o.reF };
    out.lightcone = otocLightcone(circ, sc, [], 0, "Z", "Z", P.cone)!.grid;
    const b = butterflyVelocity(circ, sc, [], 0, "Z", "Z", 0.5, P.otoc)!;
    out.butterfly = { series: b.series.map((x) => ({ distance: x.distance, vQubit: x.vQubit, C: x.C, arrival: x.arrival })), vB: b.vB, intercept: b.intercept };
    const ly = lyapunovExponent(circ, sc, [], 0, c.n - 1, P.otoc)!;
    out.lyapunov = { C: ly.C, lnC: ly.lnC, lyapunov: ly.lyapunov, intercept: ly.intercept, r2: ly.r2 };
    out.spacetimeEntropy = spaceTimeEntropy(circ, sc, [])!.s;
    out.asymmetry = entanglementAsymmetrySweep(circ, sc, [])!.asymmetry;
  }
  return out;
}
