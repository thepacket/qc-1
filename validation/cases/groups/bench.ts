import { exportQasm3 } from "../../../src/qasm/fromTape";
import { mirror, processTomography, quantumVolume, rb, repetitionExact, t1t2, unitarity, xeb } from "../../../src/noise/bench";
import { sanitiseNoise } from "../../../src/noise/model";
import type { Entry } from "../../../src/calc/steps";
import { productLayer, randomTape, rng } from "../tapes";

const q = (n: number, t: Entry[]) => exportQasm3(n, t);
export const MODELS = {
  global: sanitiseNoise({ enabled: true, p1: 0.02, p2: 0.06, ad: 0.01, pd: 0.015, readout: 0 }),
  ad: sanitiseNoise({ enabled: true, p1: 0, p2: 0, ad: 0.03, pd: 0, readout: 0 }),
  pd: sanitiseNoise({ enabled: true, p1: 0, p2: 0, ad: 0, pd: 0.04, readout: 0 }),
  // Only X is noisy: interleaved RB must run X itself to see it (bug #50).
  xgate: sanitiseNoise({ enabled: true, p1: 0, p2: 0, ad: 0, pd: 0, readout: 0, perGate: { x: 0.2 } }),
};

export function compute() {
  const m = MODELS.global;
  const r = rb(m, { lengths: [1, 2, 4, 8, 16, 32], sequences: 6, seed: 11 });
  const ri = rb(m, { lengths: [1, 2, 4, 8, 16, 32], sequences: 6, seed: 11, interleave: "h" });
  const rx = rb(MODELS.xgate, { lengths: [1, 2, 4, 8], sequences: 4, seed: 17, interleave: "x" });
  const u = unitarity(m, { lengths: [1, 2, 4, 8, 16], sequences: 5, seed: 12 });
  const qv = quantumVolume(m, { widths: [2, 3], circuits: 4, seed: 13 });
  const x = xeb(m, { n: 3, depths: [1, 2, 4], circuits: 3, seed: 14 });
  const mi = mirror(m, { widths: [2, 3], depths: [2], circuits: 2, seed: 15 });
  const tAd = t1t2(MODELS.ad, { delays: [0, 2, 4, 8, 16] });
  const tPd = t1t2(MODELS.pd, { delays: [0, 2, 4, 8, 16] });
  const tGl = t1t2(m, { delays: [0, 2, 4, 8, 16] });
  const r2 = rng(16);
  const tomo = [1, 2].map((n) => {
    const tape = [...productLayer(r2, n), ...randomTape(r2, n, 4, ["h", "x", "rz", "sx", "rzz", "swap"])];
    return { n, qasm: q(n, tape), ideal: processTomography(n, tape, null), noisy: processTomography(n, tape, m) };
  });
  return {
    models: MODELS,
    rb: { lengths: r.lengths, survival: r.survival, A: r.A, B: r.B, p: r.p, qasm: r.sequences.map((ss) => ss.map((t) => q(1, t))) },
    rbi: { survival: ri.survival, p: ri.p, qasm: ri.sequences.map((ss) => ss.map((t) => q(1, t))) },
    rbx: { lengths: rx.lengths, survival: rx.survival, p: rx.p, qasm: rx.sequences.map((ss) => ss.map((t) => q(1, t))) },
    unitarity: { lengths: u.lengths, purity: u.purity, u: u.u, A: u.A, B: u.B, qasm: u.tapes.map((ss) => ss.map((t) => q(1, t))) },
    qv: qv.rows.map((w) => ({ width: w.width, hops: w.hops, qasm: w.circuits.map((t) => q(w.width, t)) })),
    xeb: { n: x.n, depths: x.depths, perCircuit: x.perCircuit, qasm: x.circuits.map((cs) => cs.map((t) => q(x.n, t))) },
    mirror: mi.circuits.map((c) => ({ width: c.width, success: c.success, qasm: q(c.width, c.tape) })),
    t1t2: { delays: tAd.delays, ad: { T1: tAd.T1, t1: tAd.t1 }, pd: { T2: tPd.T2, T2echo: tPd.T2echo, ramsey: tPd.ramsey }, global: { t1: tGl.t1, ramsey: tGl.ramsey, echo: tGl.echo } },
    tomography: tomo,
    qec: [3, 5, 7].map((d) => ({ d, rates: [0.01, 0.1, 0.3, 0.5].map((p) => [p, repetitionExact(d, p)]) })),
  };
}
