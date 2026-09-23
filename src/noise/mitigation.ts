/**
 * Error mitigation for expectation values under a NoiseModel:
 *
 *   - ZNE: ⟨H⟩ at the noise scaled by 1, 2, 3 (every rate, per-qubit and
 *     per-gate included; readout doesn't enter an expectation value), then
 *     extrapolated to zero noise: linear least squares, Richardson
 *     (the quadratic through the three points) or exponential
 *     y = a + b·rˣ (exact through three equally spaced points).
 *   - PEC: after every noisy instruction, a quasi-probabilistic inverse of
 *     its channels (in reverse order: crosstalk, phase damping, amplitude
 *     damping, depolarizing), sampled per trajectory with the sign·Γ weight.
 *     Pauli channels invert in the Pauli basis; amplitude damping needs the
 *     reset channels R₀, R₁ as well (Endo, Benjamin & Li 2018).
 *
 * Upstream's PEC ran the noiseless circuit with the inverse corrections (so
 * it converged to ideal∘N⁻¹, not the ideal value), inverted phase damping as
 * a Z flip of probability λ/2 instead of (1 − √(1 − λ))/2, applied the
 * inverses in the wrong order and left 3+ qubit gates uncorrected; its
 * "exponential" ZNE returned the linear fit. See docs/quantiom-bugs.md.
 */
import { applyStep, exportedSteps, NONUNITARY, type Entry, type Scope, type Step } from "../calc/steps";
import { applyKQubit } from "../sim/apply";
import { mulberry32 } from "../sim/measure";
import type { Matrix } from "../sim/matrices";
import { pauliSumExpectation } from "../sim/expectation";
import type { PauliTerm } from "../sim/trotter";
import { channelsAfter, pauliMatrix, type Channel } from "./channels";
import { conjugate, densityOk, noisyDensity, runTrajectories } from "./sim";
import type { NoiseModel } from "./model";

// ─── Noisy expectation ─────────────────────────────────────────────────

/** Tr(ρ H) of a density matrix, H a Pauli sum. */
export function densityExpectation(rho: Float64Array, n: number, terms: PauliTerm[]): number {
  // Tr(ρH) = Σ_j ⟨j|ρ H|j⟩: apply H to each basis vector as a state, then read ρ's row.
  const d = 1 << n;
  let tr = 0;
  const e = new Float64Array(2 * d);
  for (let j = 0; j < d; j++) {
    e.fill(0);
    e[2 * j] = 1;
    // (H|j⟩)_i = Σ_k h_k (P_k|j⟩)_i; Tr(ρH) = Σ_{j,i} ρ_{j i} (H)_{i j}
    for (const t of terms) {
      const psi = e.slice();
      for (let q = 0; q < n; q++) {
        const p = t.paulis[q];
        if (p === "I") continue;
        applyKQubit(psi, n, [q], pauliMatrix(p === "X" ? 1 : p === "Y" ? 2 : 3, 1));
      }
      for (let i = 0; i < d; i++) {
        const [hr, hi] = [psi[2 * i] * t.coefficient, psi[2 * i + 1] * t.coefficient];
        const [rr, ri] = [rho[2 * (j * d + i)], rho[2 * (j * d + i) + 1]];
        tr += rr * hr - ri * hi;
      }
    }
  }
  return tr;
}

export type Estimate = { value: number; stderr: number; method: "density" | "trajectories"; samples: number };

export function noisyExpectation(n: number, tape: Entry[], scope: Scope, m: NoiseModel, terms: PauliTerm[], opts: { trajectories?: number; seed?: number } = {}): Estimate {
  if (densityOk(n, tape)) return { value: densityExpectation(noisyDensity(n, tape, scope, m).rho, n, terms), stderr: 0, method: "density", samples: 0 };
  let s = 0, s2 = 0, T = 0;
  runTrajectories(n, tape, scope, m, (st) => {
    const v = pauliSumExpectation(st, n, terms);
    s += v; s2 += v * v; T++;
  }, opts);
  const mean = s / T;
  return { value: mean, stderr: Math.sqrt(Math.max(0, s2 / T - mean * mean) / T), method: "trajectories", samples: T };
}

// ─── ZNE ───────────────────────────────────────────────────────────────

export function scaleNoise(m: NoiseModel, f: number): NoiseModel {
  const c = (x: number | undefined) => (x === undefined ? undefined : Math.min(1, x * f));
  return {
    ...m, p1: c(m.p1)!, p2: c(m.p2)!, ad: c(m.ad)!, pd: c(m.pd)!, crosstalk: c(m.crosstalk)!,
    perQubit: m.perQubit?.map((r) => ({ ...r, p1: c(r.p1), ad: c(r.ad), pd: c(r.pd) })),
    perGate: m.perGate && Object.fromEntries(Object.entries(m.perGate).map(([k, v]) => [k, c(v)!])),
  };
}

export type ZneFit = "linear" | "richardson" | "exponential";

/** Zero-noise value from (scale, value) samples. */
export function extrapolate(xs: number[], ys: number[], fit: ZneFit): number {
  if (fit === "linear") {
    const k = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
    const sxx = xs.reduce((a, x) => a + x * x, 0), sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
    const b = (k * sxy - sx * sy) / (k * sxx - sx * sx);
    return (sy - b * sx) / k;
  }
  if (fit === "richardson") {
    // Lagrange polynomial through all points, at x = 0.
    return ys.reduce((acc, y, i) => acc + y * xs.reduce((p, x, j) => (j === i ? p : p * (0 - x) / (xs[i] - x)), 1), 0);
  }
  // y = a + b·r^x through three equally spaced points (x0, x0+h, x0+2h).
  const [y0, y1, y2] = ys, h = xs[1] - xs[0];
  const d1 = y1 - y0, d2 = y2 - y1;
  if (Math.abs(d1) < 1e-15 || d2 / d1 <= 0) return extrapolate(xs, ys, "richardson");
  const rh = d2 / d1; // r^h
  const r = rh ** (1 / h);
  const b = d1 / (r ** xs[0] * (rh - 1));
  const a = y0 - b * r ** xs[0];
  return a + b;
}

export function zne(n: number, tape: Entry[], scope: Scope, m: NoiseModel, terms: PauliTerm[], fit: ZneFit, scales = [1, 2, 3], opts: { trajectories?: number; seed?: number } = {}) {
  const samples = scales.map((s) => ({ scale: s, ...noisyExpectation(n, tape, scope, scaleNoise(m, s), terms, opts) }));
  return { samples, value: extrapolate(scales, samples.map((x) => x.value), fit) };
}

// ─── PEC ───────────────────────────────────────────────────────────────

/** One term of an inverse quasi-channel: a Pauli string (0 = identity) or a reset to |k⟩. */
export type InverseTerm = { coef: number; qubits: number[]; op: { pauli: number } | { reset: 0 | 1 } };

const INV_CACHE = new Map<string, InverseTerm[]>();

/**
 * The quasi-probabilistic inverse of one channel. Pauli channels with every
 * non-identity Pauli at probability p (depolarizing) have eigenvalue
 * f = 1 − 4ᵏp; damping channels are identified by their Kraus operators.
 */
export function inverseOf(c: Channel): InverseTerm[] {
  const k = c.qubits.length;
  if (c.kind === "pauli") {
    const f = 1 - 4 ** k * c.p;
    if (f <= 0) throw new Error("the noise is too strong to invert (depolarizing ≥ 1)");
    const gI = (1 + (4 ** k - 1) / f) / 4 ** k, gP = (1 - 1 / f) / 4 ** k;
    return [{ coef: gI, qubits: c.qubits, op: { pauli: 0 } }, ...Array.from({ length: 4 ** k - 1 }, (_, i) => ({ coef: gP, qubits: c.qubits, op: { pauli: i + 1 } }))];
  }
  // Kraus: K1 = √γ|0⟩⟨1| is amplitude damping, K1 = √γ|1⟩⟨1| phase damping.
  const K1 = c.ops[1];
  const g = K1[0][1][0] ** 2 + K1[1][1][0] ** 2;
  const key = `${K1[0][1][0] !== 0 ? "ad" : "pd"}${g}`;
  let terms = INV_CACHE.get(key);
  if (!terms) {
    const q = c.qubits;
    if (K1[0][1][0] !== 0) {
      const s = 1 / Math.sqrt(1 - g), t = 1 / (1 - g), lt = g / (1 - g), sum = (s - 1) ** 2;
      terms = [
        { coef: s, qubits: q, op: { pauli: 0 } },
        { coef: (s - t) / 2, qubits: q, op: { pauli: 1 } },
        { coef: (s - t) / 2, qubits: q, op: { pauli: 2 } },
        { coef: (sum - lt) / 2, qubits: q, op: { reset: 0 } },
        { coef: (sum + lt) / 2, qubits: q, op: { reset: 1 } },
      ];
    } else {
      const f = Math.sqrt(1 - g);
      terms = [{ coef: (1 + 1 / f) / 2, qubits: q, op: { pauli: 0 } }, { coef: (1 - 1 / f) / 2, qubits: q, op: { pauli: 3 } }];
    }
    INV_CACHE.set(key, terms);
  }
  return terms.map((x) => ({ ...x, qubits: c.qubits }));
}

/** The inverses to apply after an instruction: its channels undone in reverse order. */
export function inversesAfter(m: NoiseModel, s: Step): InverseTerm[][] {
  return [...channelsAfter(m, s)].reverse().map(inverseOf);
}

const RESET: Record<0 | 1, Matrix[]> = {
  0: [[[[1, 0], [0, 0]], [[0, 0], [0, 0]]], [[[0, 0], [1, 0]], [[0, 0], [0, 0]]]],
  1: [[[[0, 0], [0, 0]], [[1, 0], [0, 0]]], [[[0, 0], [0, 0]], [[0, 0], [1, 0]]]],
};

/** Γ = Σ|coef| of an inverse (its sampling overhead). */
export const gammaOf = (inv: InverseTerm[]) => inv.reduce((a, t) => a + Math.abs(t.coef), 0);

/**
 * PEC estimate of ⟨H⟩: T noisy trajectories with sampled inverse corrections.
 * Also reports the total Γ (the estimator's standard deviation grows like Γ/√T).
 */
export function pec(n: number, tape: Entry[], scope: Scope, m: NoiseModel, terms: PauliTerm[], opts: { trajectories?: number; seed?: number } = {}) {
  if (tape.some((e) => e.some((s) => NONUNITARY.has(s.gateId) || s.condition))) throw new Error("PEC here needs a unitary tape");
  const list = tape.flat().flatMap(exportedSteps);
  const plan = list.map((s) => ({ s, noise: channelsAfter(m, s), inv: inversesAfter(m, s) }));
  const gammaTotal = plan.reduce((acc, p) => acc * p.inv.reduce((a, inv) => a * gammaOf(inv), 1), 1);
  const T = opts.trajectories ?? m.trajectories;
  const rng = mulberry32(opts.seed ?? 0x9ec);
  const dim = 1 << n;
  let s = 0, s2 = 0;
  for (let t = 0; t < T; t++) {
    const st = new Float64Array(2 * dim);
    st[0] = 1;
    let w = 1;
    for (const p of plan) {
      applyStep(st, n, p.s, rng, scope);
      for (const c of p.noise) sampleNoise(st, n, c, rng);
      for (const inv of p.inv) {
        const G = gammaOf(inv);
        let r = rng() * G;
        let pick = inv[inv.length - 1];
        for (const term of inv) { r -= Math.abs(term.coef); if (r < 0) { pick = term; break; } }
        w *= Math.sign(pick.coef) * G;
        applyInverseTerm(st, n, pick, rng);
      }
    }
    const v = w * pauliSumExpectation(st, n, terms);
    s += v; s2 += v * v;
  }
  const mean = s / T;
  return { value: mean, stderr: Math.sqrt(Math.max(0, s2 / T - mean * mean) / T), gamma: gammaTotal, samples: T };
}

function sampleNoise(st: Float64Array, n: number, c: Channel, rng: () => number) {
  // Same unravelling as the trajectory simulator.
  const k = c.qubits.length;
  if (c.kind === "pauli") {
    const r = rng();
    if (r >= (4 ** k - 1) * c.p) return;
    applyKQubit(st, n, c.qubits, pauliMatrix(1 + Math.min(4 ** k - 2, Math.floor(r / c.p)), k));
    return;
  }
  let r = rng();
  for (let i = 0; i < c.ops.length; i++) {
    const t = st.slice();
    applyKQubit(t, n, c.qubits, c.ops[i]);
    let p = 0;
    for (let j = 0; j < t.length; j++) p += t[j] * t[j];
    if (r < p || i === c.ops.length - 1) {
      const k2 = 1 / Math.sqrt(p);
      for (let j = 0; j < t.length; j++) st[j] = t[j] * k2;
      return;
    }
    r -= p;
  }
}

function applyInverseTerm(st: Float64Array, n: number, t: InverseTerm, rng: () => number) {
  if ("pauli" in t.op) {
    if (t.op.pauli) applyKQubit(st, n, t.qubits, pauliMatrix(t.op.pauli, t.qubits.length));
    return;
  }
  // Reset to |k⟩: a Z measurement (sampled), then flip to k — averaged, Tr(ρ)|k⟩⟨k|.
  const q = t.qubits[0];
  applyStep(st, n, { id: "pec", gateId: "reset", column: 0, targets: [q], controls: [], clbits: [], params: [] }, rng);
  if (t.op.reset === 1) applyKQubit(st, n, [q], pauliMatrix(1, 1));
}

/** The same correction applied exactly to a density matrix (validation): must give back the ideal ρ. */
export function pecDensity(n: number, tape: Entry[], scope: Scope, m: NoiseModel): Float64Array {
  const d = 1 << n;
  let rho: Float64Array = new Float64Array(2 * d * d);
  rho[0] = 1;
  const channel = (r: Float64Array, parts: { coef: number; qubits: number[]; ops: Matrix[] }[]) => {
    const out = new Float64Array(r.length);
    for (const p of parts) for (const M of p.ops) {
      const t = conjugate(r, d, (v) => applyKQubit(v, n, p.qubits, M));
      for (let i = 0; i < out.length; i++) out[i] += p.coef * t[i];
    }
    return out;
  };
  for (const s of tape.flat().flatMap(exportedSteps)) {
    rho = conjugate(rho, d, (v) => applyStep(v, n, s, Math.random, scope));
    for (const c of channelsAfter(m, s)) {
      const k = c.qubits.length;
      rho = c.kind === "pauli"
        ? channel(rho, [{ coef: 1 - (4 ** k - 1) * c.p, qubits: c.qubits, ops: [pauliMatrix(0, k)] },
          ...Array.from({ length: 4 ** k - 1 }, (_, i) => ({ coef: c.p, qubits: c.qubits, ops: [pauliMatrix(i + 1, k)] }))])
        : channel(rho, [{ coef: 1, qubits: c.qubits, ops: c.ops }]);
    }
    for (const inv of inversesAfter(m, s)) {
      rho = channel(rho, inv.map((t) => ({
        coef: t.coef, qubits: t.qubits,
        ops: "pauli" in t.op ? [pauliMatrix(t.op.pauli, t.qubits.length)] : RESET[t.op.reset],
      })));
    }
  }
  return rho;
}
