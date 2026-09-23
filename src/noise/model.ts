/**
 * The noise model, with Qiskit Aer's conventions (validated: fixture
 * `noise`, against qiskit_aer.noise error constructors applied as Kraus maps
 * to qiskit.quantum_info.DensityMatrix):
 *
 *   p1 — depolarizing_error(p1, 1): ρ → (1 − p1)ρ + p1·I/2
 *        (X, Y, Z each with probability p1/4)
 *   p2 — depolarizing_error(p2, 2): the 15 non-identity Paulis, p2/16 each
 *   ad — amplitude_damping_error(ad) (T1), after every gate, on each qubit
 *   pd — phase_damping_error(pd) (T2), after every gate, on each qubit
 *   readout — a symmetric bit flip of every measured bit
 *   crosstalk — after a 2-qubit gate on (a, b), depolarizing_error(crosstalk, 1)
 *        on every other coupling-map neighbour of a and of b
 *
 * Noise follows the exported program: every unitary instruction of the QASM
 * export (a custom gate call is one) gets, in this order, depolarizing (p1
 * for one qubit, p2 for two, p2 on each qubit for three or more), then
 * amplitude and phase damping on each of its qubits, then crosstalk.
 * Measurements and resets are ideal (readout flips the recorded bit).
 *
 * Upstream's depolarizing rate was the probability of *some* Pauli (p/3
 * each), i.e. 3/4 of Qiskit's λ; QC-1 uses Qiskit's λ throughout.
 */

export type PerQubitRates = { p1?: number; ad?: number; pd?: number; readout?: number };

export type NoiseModel = {
  enabled: boolean;
  /** Trajectories to average where the density matrix is too big (or measurements need sampling). */
  trajectories: number;
  p1: number;
  p2: number;
  ad: number;
  pd: number;
  readout: number;
  crosstalk: number;
  coupling?: number[][];
  /** Per-qubit overrides (e.g. from a device calibration). */
  perQubit?: PerQubitRates[];
  /** Depolarizing rate per exported gate name (cx, sx, ecr, …), overriding p1/p2. */
  perGate?: Record<string, number>;
  /** Where the rates came from (preset or device + date). */
  source?: string;
};

export const DEFAULT_NOISE: NoiseModel = {
  enabled: false, trajectories: 256, p1: 0.001, p2: 0.01, ad: 0, pd: 0, readout: 0.02, crosstalk: 0,
};

/** Rough public-record averages (upstream's presets, converted to Qiskit's depolarizing λ = 4p/3). */
export const NOISE_PRESETS: { id: string; label: string; rates: Partial<NoiseModel> }[] = [
  { id: "demo", label: "Demo (visible)", rates: { p1: 0.0133, p2: 0.0667, ad: 0.005, pd: 0.005, readout: 0.05, crosstalk: 0.00133 } },
  { id: "ibm-heron", label: "IBM Heron (typical)", rates: { p1: 0.0004, p2: 0.0067, ad: 0.0005, pd: 0.0005, readout: 0.015, crosstalk: 0 } },
  { id: "google-sycamore", label: "Google Sycamore", rates: { p1: 0.002, p2: 0.008, ad: 0.001, pd: 0.001, readout: 0.018, crosstalk: 0 } },
  { id: "ionq-aria", label: "IonQ Aria (typical)", rates: { p1: 0.00053, p2: 0.004, ad: 0.0002, pd: 0.0002, readout: 0.005, crosstalk: 0 } },
];

const clamp = (x: unknown, hi = 1) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(0, x)) : undefined);

/** A model from untrusted JSON (storage, a calibration file): rates clamped to [0, 1]. */
export function sanitiseNoise(raw: unknown): NoiseModel {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const m: NoiseModel = {
    enabled: o.enabled === true,
    trajectories: Math.round(clamp(o.trajectories, 8192) ?? DEFAULT_NOISE.trajectories) || 1,
    p1: clamp(o.p1) ?? DEFAULT_NOISE.p1,
    // Depolarizing λ can reach 4/3 (1q) and 16/15 (2q) and stay a channel; the UI keeps it ≤ 1.
    p2: clamp(o.p2) ?? DEFAULT_NOISE.p2,
    ad: clamp(o.ad) ?? DEFAULT_NOISE.ad,
    pd: clamp(o.pd) ?? DEFAULT_NOISE.pd,
    readout: clamp(o.readout, 0.5) ?? DEFAULT_NOISE.readout,
    crosstalk: clamp(o.crosstalk) ?? DEFAULT_NOISE.crosstalk,
  };
  if (Array.isArray(o.coupling)) {
    m.coupling = (o.coupling as unknown[]).map((row) => (Array.isArray(row) ? row.filter((q): q is number => Number.isInteger(q) && q >= 0 && q < 1024) : []));
  }
  if (Array.isArray(o.perQubit)) {
    m.perQubit = (o.perQubit as unknown[]).map((r) => {
      const x = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      return { p1: clamp(x.p1), ad: clamp(x.ad), pd: clamp(x.pd), readout: clamp(x.readout, 0.5) };
    });
  }
  if (o.perGate && typeof o.perGate === "object") {
    m.perGate = Object.fromEntries(
      Object.entries(o.perGate as Record<string, unknown>).filter(([k, v]) => /^\w+$/.test(k) && clamp(v) !== undefined).map(([k, v]) => [k, clamp(v)!]),
    );
  }
  if (typeof o.source === "string") m.source = o.source.slice(0, 120);
  return m;
}

/** A rate for qubit q: its override, else the global value. */
export function rate(m: NoiseModel, key: keyof PerQubitRates, q: number): number {
  return m.perQubit?.[q]?.[key] ?? m[key];
}

/** True when the model does nothing (so the ideal path can be used). */
export function isIdeal(m: NoiseModel): boolean {
  const zero = (r?: PerQubitRates) => !r || [r.p1, r.ad, r.pd, r.readout].every((x) => !x);
  return !m.enabled || (!m.p1 && !m.p2 && !m.ad && !m.pd && !m.readout && !m.crosstalk
    && (m.perQubit ?? []).every(zero) && Object.values(m.perGate ?? {}).every((x) => !x));
}
