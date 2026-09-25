import type { Entry } from "../../../src/calc/steps";
import { NOISE_RUNS } from "../../../src/analysis/noiseRuns";
import { Register } from "../../../src/calc/register";
import { zne, pecDensity } from "../../../src/noise/mitigation";
import type { AnalysisResult } from "../../../src/analysis/types";
import { models } from "./noise";
import { productLayer, randomTape, rng } from "../tapes";
import { parsePauliSum } from "../../../src/sim/trotter";
import { internalPauliSum } from "../../../src/calc/order";

export type NaCase = { id: string; n: number; tape: Entry[]; model: string; obs: string; cut: number[] };

export function cases(): NaCase[] {
  const r = rng(6226);
  const gates = ["h", "x", "sx", "t", "rx", "ry", "rz", "swap", "rzz"];
  return [2, 3, 3, 4, 3].map((n, k) => ({
    id: `na${k}`, n, model: ["global", "detailed", "damping", "global", "asymmetric"][k],
    tape: [...productLayer(r, n), ...randomTape(r, n, 5, gates)],
    obs: ["ZZ + 0.5*XI", "ZIZ - 0.7*XXI + 0.3*IYY", "XXX + ZZI", "ZZZZ - 0.4*XIXI + 0.2*IYIY", "ZZI - 0.5*XIX"][k],
    cut: [[0], [0], [0, 2], [1, 3], [1]][k],
  }));
}

const scalars = (r: AnalysisResult) => Object.fromEntries((r.scalars ?? []).map((s) => [s.label, s.value]));

export function compute(c: NaCase) {
  const m = models(c.n)[c.model];
  const reg = new Register(c.n, c.tape);
  const ctx = { n: c.n, state: reg.state, tape: c.tape, scope: {}, noise: m };
  const impact = scalars(NOISE_RUNS.impact(ctx, {}));
  const spec = NOISE_RUNS.mixedspectrum(ctx, {});
  const ci = scalars(NOISE_RUNS.coherentinfo(ctx, { cut: c.cut }));
  const coh = scalars(NOISE_RUNS.noisycoherence(ctx, {}));
  const budget = NOISE_RUNS.paulibudget(ctx, {}).charts![0] as { rows: (string | number)[][] };
  const readout = NOISE_RUNS.readout(ctx, {}).charts![0] as { rows: (string | number)[][] };
  const dec = NOISE_RUNS.decoherence(ctx, {}).charts![0] as { series: { y: number[] }[] };
  const terms = c.obs;
  const H = parsePauliSum(internalPauliSum(terms)); // the observable is written as Qiskit writes it, like a LAB input
  const znes = Object.fromEntries((["linear", "richardson", "exponential"] as const).map((f) => {
    const z = zne(c.n, c.tape, {}, m, H, f);
    return [f, { value: z.value, samples: z.samples.map((s) => s.value) }];
  }));
  return {
    model: m,
    impact, spectrum: (spec.charts![0] as { values: number[] }).values, specScalars: scalars(spec),
    coherentInfo: ci, coherence: coh, budget: budget.rows, readout: readout.rows,
    decoherence: { fidelity: dec.series[0].y, purity: dec.series[1].y },
    zne: znes,
    pecRho: Array.from(pecDensity(c.n, c.tape, {}, m)), idealState: Array.from(reg.state),
  };
}

// ─── Device calibration import ─────────────────────────────────────────

import { importIbmBackend } from "../../../src/noise/ibm";

/** A synthetic BackendProperties snapshot: varied T1/T2 (T2 < 2T1, T2 = 2T1, T2 > 2T1) and gate errors. */
export function calibration() {
  const t = 36e-9;
  const qubits = [[80e-6, 60e-6, 0.012], [120e-6, 240e-6, 0.03], [50e-6, 150e-6, 0.008], [200e-6, 40e-6, 0.02]].map(([T1, T2, ro]) => [
    { name: "T1", value: T1 }, { name: "T2", value: T2 }, { name: "readout_error", value: ro },
  ]);
  const sxErr = [2.4e-4, 5e-4, 1.1e-4, 8e-4];
  const gates = [
    ...sxErr.map((e, q) => ({ gate: "sx", qubits: [q], parameters: [{ name: "gate_error", value: e }, { name: "gate_length", value: t }] })),
    { gate: "ecr", qubits: [0, 1], parameters: [{ name: "gate_error", value: 7e-3 }] },
    { gate: "ecr", qubits: [1, 2], parameters: [{ name: "gate_error", value: 9e-3 }] },
    { gate: "ecr", qubits: [2, 3], parameters: [{ name: "gate_error", value: 1.2e-2 }] },
  ];
  const json = JSON.stringify({ backend_name: "fake_device", last_update_date: "2026-01-01T00:00:00Z", qubits, gates });
  return { json, t, sxErr, model: importIbmBackend(json) };
}
