import type { Entry } from "../../../src/calc/steps";
import { Register } from "../../../src/calc/register";
import { noisyDensity, noisyStats, runTrajectories } from "../../../src/noise/sim";
import { sanitiseNoise, type NoiseModel } from "../../../src/noise/model";
import { randomTape, rng, step, productLayer } from "../tapes";

const line = (n: number) => Array.from({ length: n }, (_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < n));

/** Noise models: global rates; per-qubit and per-gate overrides with crosstalk; damping only. */
export function models(n: number): Record<string, NoiseModel> {
  return {
    global: sanitiseNoise({ enabled: true, p1: 0.05, p2: 0.1, ad: 0.04, pd: 0.03, readout: 0.03 }),
    detailed: sanitiseNoise({
      enabled: true, p1: 0.02, p2: 0.06, ad: 0.01, pd: 0.02, readout: 0.05, crosstalk: 0.05, coupling: line(n),
      perQubit: Array.from({ length: n }, (_, q) => ({ p1: 0.01 * (q + 1), ad: 0.03 * (q % 2), readout: 0.02 * q })),
      perGate: { cx: 0.15, h: 0.04 },
    }),
    damping: sanitiseNoise({ enabled: true, p1: 0, p2: 0, ad: 0.2, pd: 0.1, readout: 0 }),
  };
}

export type NoiseCase = { id: string; n: number; tape: Entry[]; model: string };

/** Unitary tapes (density matrix vs reference, trajectories vs density). */
export function unitaryCases(): NoiseCase[] {
  const r = rng(8118);
  const gates = ["h", "x", "y", "z", "s", "t", "sx", "rx", "ry", "rz", "u", "swap", "iswap", "rzz", "rccx"];
  const out: NoiseCase[] = [];
  for (let k = 0; k < 12; k++) {
    const n = 1 + (k % 4);
    const tape = [...productLayer(r, n), ...randomTape(r, n, 6, gates.filter((g) => g !== "rccx" || n >= 3))];
    out.push({ id: `u${k}`, n, tape, model: ["global", "detailed", "damping"][k % 3] });
  }
  return out;
}

/** Measured and conditional tapes over Aer-native gates (trajectories vs Aer counts). */
export function classicalCases(): NoiseCase[] {
  const r = rng(9119);
  const s = (g: string, t: number[], c: number[] = [], p: string[] = []) => step(g, t, c, p);
  const out: NoiseCase[] = [];
  const teleport: Entry[] = [
    [s("ry", [0], [], ["0.9"])], [s("h", [1])], [s("x", [2], [1])], [s("x", [1], [0])], [s("h", [0])],
    [s("measure", [0])], [s("measure", [1])], [{ ...s("x", [2]), condition: { clbit: 1, value: 1 } }],
    [{ ...s("z", [2]), condition: { clbit: 0, value: 1 } }], [s("measure", [2])],
  ];
  out.push({ id: "teleport", n: 3, tape: teleport, model: "global" });
  for (let k = 0; k < 5; k++) {
    const n = 2 + (k % 2);
    const tape: Entry[] = [];
    for (let d = 0; d < 8; d++) {
      const q = r.int(n);
      const u = r.next();
      if (u < 0.4) tape.push([s(r.pick(["h", "x", "sx", "t", "s"]), [q])]);
      else if (u < 0.55) tape.push([s("rx", [q], [], ["0.7"])]);
      else if (u < 0.75) tape.push([s("x", [(q + 1) % n], [q])]);
      else if (u < 0.9) tape.push([s("measure", [q])]);
      else tape.push([{ ...s("x", [q]), condition: { clbit: r.int(n), value: 1 } }]);
    }
    for (let q = 0; q < n; q++) tape.push([s("measure", [q])]);
    out.push({ id: `c${k}`, n, tape, model: k % 2 ? "damping" : "global" });
  }
  return out;
}

const TRAJ = 4000;

export function computeUnitary(c: NoiseCase) {
  const m = models(c.n)[c.model];
  const { rho } = noisyDensity(c.n, c.tape, {}, m);
  // Trajectories (forced, to test the unravelling against the exact ρ).
  const dim = 1 << c.n;
  const probs = new Float64Array(dim);
  runTrajectories(c.n, c.tape, {}, m, (st) => { for (let i = 0; i < dim; i++) probs[i] += (st[2 * i] ** 2 + st[2 * i + 1] ** 2) / TRAJ; }, { trajectories: TRAJ, seed: 77 });
  const stats = noisyStats(c.n, c.tape, {}, m);
  return { model: m, rho: Array.from(rho), trajProbs: Array.from(probs), trajectories: TRAJ, bloch: stats.bloch };
}

export function computeClassical(c: NoiseCase) {
  const m = models(c.n)[c.model];
  const T = 20000;
  const counts: Record<string, number> = {};
  runTrajectories(c.n, c.tape, {}, m, (_, bits) => {
    const key = [...bits].join("");
    counts[key] = (counts[key] ?? 0) + 1;
  }, { trajectories: T, seed: 99 });
  // Recorded outcomes for the export (the trajectories ignore them).
  const tape = new Register(c.n, c.tape).tape;
  return { model: m, counts, trajectories: T, tape };
}
