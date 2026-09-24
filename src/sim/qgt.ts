/**
 * Quantum geometric tensor (QGT) of a parameterised circuit at the current
 * point in parameter space.
 *
 *   Q_ij = ⟨∂_i ψ | ∂_j ψ⟩ − ⟨∂_i ψ | ψ⟩⟨ψ | ∂_j ψ⟩
 *
 * Its real part is the **Fubini–Study metric** g_ij = Re Q_ij — the
 * Riemannian metric on projective Hilbert space that the quantum natural
 * gradient (already wired into the optimiser) descends along; the metric
 * volume √det g is the local density of distinguishable states. Its imaginary
 * part is the **Berry curvature** F_ij = −2 Im Q_ij — the geometric-phase
 * 2-form, non-zero only where the state's parameter dependence is genuinely
 * complex. 4 g_ij equals the multi-parameter quantum Fisher information.
 *
 * Computed by central finite differences of the statevector w.r.t. each free
 * symbol: O((2k+1) · 2ⁿ) simulations for k symbols. Capped for small k.
 */

import type { Circuit } from "./types";
type CustomGate = unknown; // QC-1: custom gates arrive in Phase 6
import { simulate, type ParameterValues } from "./simulate";
import { customOf, expandCustom } from "../calc/custom";
import { evalParam, symbolsOf, type Step } from "../calc/steps";

export type QgtResult = {
  symbols: string[];
  /** Fubini–Study metric g_ij = Re Q_ij (real, symmetric, PSD). */
  metric: number[][];
  /** Berry curvature F_ij = −2 Im Q_ij (real, antisymmetric). */
  berry: number[][];
  /** Eigenvalues of the metric (sorted ascending) — the principal sensitivities. */
  metricEigenvalues: number[];
  /** det(metric) — the squared local state-space volume element. */
  metricDet: number;
  /** QC-1: estimated relative error of each symbol's derivative ∂ψ (adaptive step). */
  derivativeError: number[];
  /** QC-1: symbols whose derivative didn't converge (their rows of g and F are unreliable). */
  unresolved: string[];
};

/**
 * QC-1 fix (docs/quantiom-bugs.md #39): a fixed step ε = 1e-4 gives
 * g = sin²(aε/2)/ε² for RY(aθ): 3.7% of the true a²/4 at a = 10⁵, silently.
 * Instead: central differences D(h) at h = h₀, h₀/2, … (h₀ = epsilon, default 0.05), Richardson
 * R(h) = (4D(h/2) − D(h))/3, accepted once three successive R agree to 1e-9
 * of ‖∂ψ‖; otherwise the best-agreeing R, flagged unresolved. Agreement is a
 * heuristic (see #41 for the aliasing it can't see on its own).
 */
type Derivative = { d: Float64Array; err: number; converged: boolean; noise: number; unc: number; fmax: number };
function adaptiveDerivative(f: (x: number) => Float64Array, x0: number, h0 = 0.05): Derivative {
  let fmax = 0; // the largest |f| seen
  // QC-1 fix (docs/quantiom-bugs.md #54): divide by the actual spacing of the
  // floating-point arguments x₀ ± h, and stop refining once rounding eats a
  // quarter of it (at θ = 10¹⁵ both samples were θ itself: a derivative of 0).
  const D = (h: number) => {
    const xp = x0 + h, xm = x0 - h, span = xp - xm;
    if (!(span > 1.5 * h)) return null;
    const p = f(xp), m = f(xm);
    for (let j = 0; j < p.length; j++) fmax = Math.max(fmax, Math.abs(p[j]), Math.abs(m[j]));
    return { v: p.map((v, j) => (v - m[j]) / span), span };
  };
  const maxAbs = (v: Float64Array) => v.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
  // Rounding in D over a spacing `span`: each sample carries ~16ε·max|f| from the simulation plus
  // |∂f|·ε·|x₀| from rounding the angle (a·x₀ is rounded to ε relative), for a large x₀ the larger.
  const rounding = (span: number, g: number) => (2 * (16 * Number.EPSILON * fmax + Number.EPSILON * Math.abs(x0) * g)) / span;
  const FLOOR = 1e-6; // ‖∂f‖ below this counts as "no dependence": relative errors are measured against it
  let h = h0;
  const first = D(h);
  if (!first) { const z = f(x0); return { d: new Float64Array(z.length), err: Infinity, converged: false, noise: Infinity, unc: Infinity, fmax }; }
  let Dh = first.v, prev: Float64Array | null = null, agree = 0;
  let best: Derivative = { d: Dh, err: Infinity, converged: false, noise: Infinity, unc: Infinity, fmax };
  for (; h > 1e-10; h /= 2) {
    const half = D(h / 2);
    if (!half) break; // the samples are collapsing: no finer step exists here
    const R = half.v.map((v, j) => (4 * v - Dh[j]) / 3);
    if (prev) {
      const scale = Math.max(maxAbs(R), FLOOR);
      const diff = maxAbs(R.map((v, j) => v - prev![j]));
      const noise = 2 * rounding(half.span, maxAbs(R)); // Richardson weights the half step by 4/3
      const unc = Math.max(diff, noise);
      if (diff / scale < best.err) best = { d: R, err: diff / scale, converged: false, noise, unc, fmax };
      // Agreement to 1e-9 of ‖∂f‖, or to a few times the rounding level (a derivative near 0).
      agree = diff <= Math.max(1e-9 * scale, 4 * noise) ? agree + 1 : 0;
      if (agree >= 2) return { d: R, err: diff / scale, converged: true, noise, unc, fmax };
    }
    prev = R; Dh = half.v;
  }
  return best;
}

/**
 * QC-1 fix (docs/quantiom-bugs.md #41): how fast the gate angles move with
 * `sym` near x0, Σ over every angle of max |∂angle/∂sym| on [x0 − h, x0 + h]
 * (custom gates expanded). ψ(sym) is a trigonometric polynomial whose
 * frequencies are at most that sum (a rotation e^{−iφG/2} contributes |∂φ|/2,
 * a phase p(λ) |∂λ|), so a first step h ≤ 0.1/rate can't alias. Nonlinear
 * angle expressions are sampled at 9 points, a heuristic the cross-check backs.
 */
export function angleRate(circuit: Circuit, params: ParameterValues, sym: string, x0: number, h: number): number {
  const steps: Step[] = [];
  const add = (st: Step, depth: number) => {
    const def = depth < 8 ? customOf(st.gateId) : undefined;
    if (def) for (const e of expandCustom(st, def)) add(e, depth + 1);
    else steps.push(st);
  };
  for (const g of circuit.gates) add(g as Step, 0);
  const scope: ParameterValues = { ...params };
  for (const st of steps) for (const p of st.params) for (const v of symbolsOf(p)) if (!(v in scope)) scope[v] = 0;
  let rate = 0;
  for (const st of steps) for (const p of st.params) {
    if (!symbolsOf(p).includes(sym)) continue;
    let r = 0;
    for (let k = -4; k <= 4; k++) {
      const x = x0 + (h * k) / 4, dx = 1e-6 * Math.max(1, Math.abs(x));
      const v = (evalParam(p, { ...scope, [sym]: x + dx }) - evalParam(p, { ...scope, [sym]: x - dx })) / (2 * dx);
      if (Number.isFinite(v)) r = Math.max(r, Math.abs(v));
    }
    rate += r;
  }
  return rate;
}

/**
 * QC-1 fix (docs/quantiom-bugs.md #41): agreement along one dyadic sequence
 * h₀, h₀/2, … can be exact aliasing (RY(640π·θ) from h₀ = 0.05: every central
 * difference is sin(2^k π)/h = 0). The step starts below the angle-rate bound,
 * and a second, non-dyadic sequence (h₀·0.646…) must agree to 1e-7, else the
 * symbol is unresolved.
 */
export function checkedDerivative(f: (x: number) => Float64Array, x0: number, h0: number): { d: Float64Array; err: number; resolved: boolean; uncertainty: number } {
  const a = adaptiveDerivative(f, x0, h0);
  const b = adaptiveDerivative(f, x0, h0 * 0.6460969734420495);
  let diff = 0, scale = 1e-6;
  a.d.forEach((v, j) => { diff = Math.max(diff, Math.abs(v - b.d[j])); scale = Math.max(scale, Math.abs(v)); });
  // "Consistent" (both sequences converged and agree within 1e-7 of ‖∂f‖ or their rounding level)
  // is not yet "accurate": QC-1 fix #54 also requires the absolute uncertainty (disagreement or
  // rounding, whichever is larger) to be under 1e-6 of max(‖∂f‖, max|f|), or under 1e-12.
  const uncertainty = Math.max(a.unc, b.unc, diff);
  const consistent = a.converged && b.converged && diff <= Math.max(1e-7 * scale, 2 * Math.max(a.noise, b.noise));
  const accurate = uncertainty <= Math.max(1e-6 * Math.max(scale, a.fmax, b.fmax), 1e-12);
  const resolved = consistent && accurate;
  return { d: a.err <= b.err ? a.d : b.d, err: resolved ? Math.max(a.err, b.err, diff / scale) : Math.max(uncertainty / scale, 1), resolved, uncertainty };
}

/** QC-1 fix (docs/quantiom-bugs.md #40): eigenvalues and determinant of M/s (s = max |Mᵢⱼ|), mapped back, so a parameter rescaling can't cross an absolute threshold. */
function scaled(M: number[][]): { A: number[][]; s: number } {
  const s = M.reduce((a, r) => r.reduce((b, x) => Math.max(b, Math.abs(x)), a), 0);
  return { A: M.map((r) => r.map((x) => (s ? x / s : 0))), s };
}

export const MAX_QGT_QUBITS = 12;
export const MAX_QGT_SYMBOLS = 8;

function innerProduct(a: Float64Array, b: Float64Array, dim: number): [number, number] {
  let re = 0, im = 0;
  for (let i = 0; i < dim; i++) {
    const aRe = a[2 * i], aIm = a[2 * i + 1];
    const bRe = b[2 * i], bIm = b[2 * i + 1];
    re += aRe * bRe + aIm * bIm; // Re conj(a)·b
    im += aRe * bIm - aIm * bRe; // Im conj(a)·b
  }
  return [re, im];
}

/** Symmetric-matrix eigenvalues via cyclic Jacobi (small k). */
function symEigenvalues(Mraw: number[][]): number[] {
  const { A: Min, s: scale } = scaled(Mraw); // QC-1 fix #40
  if (scale === 0) return Mraw.map(() => 0);
  const k = Min.length;
  if (k === 0) return [];
  if (k === 1) return [scale * Min[0][0]];
  const A = Min.map((r) => [...r]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < k; p++) for (let q = p + 1; q < k; q++) off += A[p][q] * A[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < k; p++) {
      for (let q = p + 1; q < k; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let i = 0; i < k; i++) {
          const aip = A[i][p], aiq = A[i][q];
          A[i][p] = c * aip - s * aiq;
          A[i][q] = s * aip + c * aiq;
        }
        for (let i = 0; i < k; i++) {
          const api = A[p][i], aqi = A[q][i];
          A[p][i] = c * api - s * aqi;
          A[q][i] = s * api + c * aqi;
        }
      }
    }
  }
  return Array.from({ length: k }, (_, i) => scale * A[i][i]).sort((a, b) => a - b);
}

function determinant(Mraw: number[][]): number {
  const { A: Min, s: scale } = scaled(Mraw); // QC-1 fix #40: the 1e-14 pivot cutoff is relative
  const k = Min.length;
  if (k === 0) return 1;
  if (scale === 0) return 0;
  const A = Min.map((r) => [...r]);
  let det = 1;
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    if (Math.abs(A[piv][i]) < 1e-14) return 0;
    if (piv !== i) { [A[i], A[piv]] = [A[piv], A[i]]; det = -det; }
    det *= A[i][i];
    for (let r = i + 1; r < k; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < k; c++) A[r][c] -= f * A[i][c];
    }
  }
  return det * scale ** k;
}

export function quantumGeometricTensor(
  circuit: Circuit,
  customGates: CustomGate[],
  params: ParameterValues,
  symbols: string[],
  epsilon = 0.05, // QC-1: the adaptive scheme's first step (was a fixed step of 1e-4)
): QgtResult | null {
  const n = circuit.numQubits;
  const k = symbols.length;
  if (n < 1 || n > MAX_QGT_QUBITS || k < 1 || k > MAX_QGT_SYMBOLS) return null;

  const base = simulate(circuit, params, customGates);
  if (base.isStabilizer) return null;
  const dim = 1 << n;
  const psi = base.state;

  const dpsi: Float64Array[] = [];
  const derivativeError: number[] = [];
  const work = { ...params };
  for (let i = 0; i < k; i++) {
    const sym = symbols[i];
    const original = work[sym] ?? 0;
    const at = (x: number) => simulate(circuit, { ...work, [sym]: x }, customGates).state;
    const rate = angleRate(circuit, params, sym, original, epsilon);
    const { d, err, resolved } = checkedDerivative(at, original, rate > 0 ? Math.min(epsilon, 0.1 / rate) : epsilon);
    dpsi.push(d); derivativeError.push(resolved ? err : Math.max(err, 1));
  }

  const psiDotD = dpsi.map((d) => innerProduct(psi, d, dim)); // ⟨ψ|∂_i ψ⟩
  const metric: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const berry: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));

  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const [aRe, aIm] = innerProduct(dpsi[i], dpsi[j], dim); // ⟨∂_i ψ|∂_j ψ⟩
      // ⟨∂_i ψ|ψ⟩⟨ψ|∂_j ψ⟩ = conj(psiDotD[i]) · psiDotD[j]
      const di = psiDotD[i], dj = psiDotD[j];
      const subRe = di[0] * dj[0] + di[1] * dj[1];
      const subIm = di[0] * dj[1] - di[1] * dj[0];
      metric[i][j] = aRe - subRe;        // Re Q_ij
      berry[i][j] = -2 * (aIm - subIm);  // −2 Im Q_ij
    }
  }

  return {
    symbols,
    metric,
    berry,
    metricEigenvalues: symEigenvalues(metric),
    metricDet: determinant(metric),
    derivativeError,
    unresolved: symbols.filter((_, i) => !(derivativeError[i] <= 1e-6)),
  };
}
