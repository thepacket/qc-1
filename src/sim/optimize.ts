import type { Circuit } from "./types";
type CustomGate = unknown; // QC-1: custom gates arrive in Phase 6
import { simulate, type ParameterValues } from "./simulate";
import { evaluateObservable, type Pauli, type Observable } from "./expectation";

// QC-1: ideal-state subset. The noisy evaluation, WebGPU trajectory dispatch
// and zero-noise extrapolation (zneFit) arrive with noise mode (Phase 8);
// WebGPU is deferred. The `noise` parameters stay in the signatures.
type NoiseModel = { enabled: boolean };

/**
 * Gradient-based optimisation of a Pauli expectation value over the
 * circuit's free symbols. Used by the Expectation panel's Optimize
 * button — gives researchers a one-click VQE / QAOA mini-loop without
 * leaving the browser.
 *
 * Implementation: central finite differences for the gradient,
 * ∂⟨H⟩/∂θ ≈ (E(θ+ε) - E(θ-ε)) / (2ε), then plain gradient descent
 * with a fixed learning rate. Two simulator calls per parameter per
 * step. The exact parameter-shift rule would be more accurate but
 * only applies cleanly when the free symbol enters as the entire gate
 * angle; Quantiom allows arbitrary expressions ("2*θ + π/4"), so finite
 * differences are the universal choice.
 *
 * Noise mode: ⟨H⟩ comes from trajectory averaging. Each gradient step
 * costs `trajectories × (2k+1)` trajectory runs for k symbols, which
 * is slow but well-defined. The caller passes an onProgress callback
 * so the UI can show a live counter and let the user cancel.
 */

export type OptimizerKind = "sgd" | "adam" | "qng";

export type OptimizerOptions = {
  symbols: string[];
  /** Observable to optimise — either a single Pauli string (legacy) or a
   *  weighted Pauli-sum Hamiltonian. */
  observable: Pauli[] | Observable;
  /** Initial parameter values, including non-optimised symbols. */
  initial: ParameterValues;
  /** Steps of gradient descent. */
  steps: number;
  /** Learning rate. */
  learningRate: number;
  /** Finite-difference epsilon. */
  epsilon: number;
  /** Optimisation direction. */
  goal: "minimize" | "maximize";
  /** Algorithm. Default Adam (better on rugged landscapes). */
  optimizer?: OptimizerKind;
  /** Called after each step with the current iterate. Return false to stop. */
  onProgress?: (step: number, value: number, params: ParameterValues) => boolean | void;
};

export type OptimizerResult = {
  steps: number;
  finalValue: number;
  finalParams: ParameterValues;
  stopped: "converged" | "max-steps" | "cancelled";
};

export async function optimizeExpectation(
  circuit: Circuit,
  customGates: CustomGate[],
  options: OptimizerOptions,
  noise?: NoiseModel,
): Promise<OptimizerResult> {
  const params: ParameterValues = { ...options.initial };
  const symbols = options.symbols;
  const sign = options.goal === "minimize" ? +1 : -1;
  const epsilon = options.epsilon;
  const lr = options.learningRate;
  const kind: OptimizerKind = options.optimizer ?? "adam";
  let lastValue = await evaluate(circuit, customGates, params, options.observable, noise);

  // Adam state.
  const beta1 = 0.9;
  const beta2 = 0.999;
  const adamEps = 1e-8;
  const m = new Array<number>(symbols.length).fill(0);
  const v = new Array<number>(symbols.length).fill(0);
  let kicked = false;

  for (let step = 0; step < options.steps; step++) {
    // Central finite differences per symbol.
    const grad = new Array<number>(symbols.length);
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];
      const original = params[sym] ?? 0;
      params[sym] = original + epsilon;
      const ePlus = await evaluate(circuit, customGates, params, options.observable, noise);
      params[sym] = original - epsilon;
      const eMinus = await evaluate(circuit, customGates, params, options.observable, noise);
      params[sym] = original;
      grad[i] = sign * (ePlus - eMinus) / (2 * epsilon);
    }

    // Apply update.
    let normSq = 0;
    if (kind === "qng") {
      // Quantum Natural Gradient: precondition the gradient by the inverse
      // of the Fubini-Study metric F. F_{ij} = Re[⟨∂_i ψ|∂_j ψ⟩ -
      // ⟨∂_i ψ|ψ⟩⟨ψ|∂_j ψ⟩]. Numerical gradients of ψ via finite differences.
      // Disabled in noise mode (the metric isn't defined on mixed states
      // without density matrices).
      if (noise?.enabled) {
        return { steps: step + 1, finalValue: lastValue, finalParams: params, stopped: "cancelled" };
      }
      const k = symbols.length;
      const metric = computeFubiniStudy(circuit, customGates, params, symbols, epsilon);
      // Solve (F + λI) · u = grad with a small Tikhonov regulariser λ = 1e-3.
      const lambda = 1e-3;
      const reg = metric.map((row, i) => row.map((v, j) => v + (i === j ? lambda : 0)));
      const step_dir = solveLinearSystem(reg, grad);
      for (let i = 0; i < k; i++) {
        params[symbols[i]] = (params[symbols[i]] ?? 0) - lr * step_dir[i];
        normSq += grad[i] * grad[i];
      }
    } else if (kind === "adam") {
      const t = step + 1;
      const biasCorr1 = 1 - Math.pow(beta1, t);
      const biasCorr2 = 1 - Math.pow(beta2, t);
      for (let i = 0; i < symbols.length; i++) {
        const g = grad[i];
        m[i] = beta1 * m[i] + (1 - beta1) * g;
        v[i] = beta2 * v[i] + (1 - beta2) * g * g;
        const mHat = m[i] / biasCorr1;
        const vHat = v[i] / biasCorr2;
        const delta = lr * mHat / (Math.sqrt(vHat) + adamEps);
        params[symbols[i]] = (params[symbols[i]] ?? 0) - delta;
        normSq += g * g;
      }
    } else {
      for (let i = 0; i < symbols.length; i++) {
        params[symbols[i]] = (params[symbols[i]] ?? 0) - lr * grad[i];
        normSq += grad[i] * grad[i];
      }
    }
    lastValue = await evaluate(circuit, customGates, params, options.observable, noise);

    const cont = options.onProgress?.(step + 1, lastValue, params);
    if (cont === false) {
      return { steps: step + 1, finalValue: lastValue, finalParams: params, stopped: "cancelled" };
    }
    if (Math.sqrt(normSq) < 1e-6) {
      // QC-1 fix (docs/quantiom-bugs.md #12): symbols start at 0, which is often
      // a stationary point (e.g. the maximum of cos θ). A zero gradient on the
      // first step means "not started", not "converged": nudge every symbol
      // once (a true minimum pulls it straight back) and carry on.
      if (step === 0 && !kicked) {
        kicked = true;
        for (const s of symbols) params[s] = (params[s] ?? 0) + 0.1;
        lastValue = await evaluate(circuit, customGates, params, options.observable, noise);
        continue;
      }
      return { steps: step + 1, finalValue: lastValue, finalParams: params, stopped: "converged" };
    }
  }
  return { steps: options.steps, finalValue: lastValue, finalParams: params, stopped: "max-steps" };
}

async function evaluate(
  circuit: Circuit,
  customGates: CustomGate[],
  params: ParameterValues,
  observable: Pauli[] | Observable,
  noise: NoiseModel | undefined,
): Promise<number> {
  const obs = toObservable(observable);
  if (noise?.enabled) throw new Error("noise mode is not available yet");
  const result = simulate(circuit, params, customGates);
  if (result.isStabilizer) return 0; // optimization not meaningful in Clifford-only
  return evaluateObservable(result.state, circuit.numQubits, obs);
}

function toObservable(o: Pauli[] | Observable): Observable {
  if (Array.isArray(o)) return { kind: "pauli", paulis: o };
  return o;
}

/**
 * Build the Fubini-Study metric tensor F at the current parameter point.
 * F_{ij} = Re[⟨∂_i ψ|∂_j ψ⟩ − ⟨∂_i ψ|ψ⟩⟨ψ|∂_j ψ⟩], computed via central
 * finite differences on the state vector. O((k+1) · 2^n) simulations per
 * call; small-k VQE uses this happily.
 */
function computeFubiniStudy(
  circuit: Circuit,
  customGates: CustomGate[],
  params: ParameterValues,
  symbols: string[],
  epsilon: number,
): number[][] {
  const k = symbols.length;
  const baseResult = simulate(circuit, params, customGates);
  if (baseResult.isStabilizer) {
    return Array.from({ length: k }, () => new Array<number>(k).fill(0));
  }
  const dim = 1 << circuit.numQubits;
  const psi = baseResult.state;
  // ∂_i ψ as a Float64Array per symbol.
  const dpsi: Float64Array[] = [];
  for (let i = 0; i < k; i++) {
    const sym = symbols[i];
    const original = params[sym] ?? 0;
    params[sym] = original + epsilon;
    const plus = simulate(circuit, params, customGates).state;
    params[sym] = original - epsilon;
    const minus = simulate(circuit, params, customGates).state;
    params[sym] = original;
    const d = new Float64Array(2 * dim);
    for (let j = 0; j < 2 * dim; j++) d[j] = (plus[j] - minus[j]) / (2 * epsilon);
    dpsi.push(d);
  }
  // ⟨ψ|∂_i ψ⟩ — complex inner product.
  const psiDotDi: Array<[number, number]> = dpsi.map((d) => innerProduct(psi, d, dim));
  const F: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const a = innerProduct(dpsi[i], dpsi[j], dim);
      // ⟨∂_i ψ|ψ⟩ = conj(⟨ψ|∂_i ψ⟩)
      const psiDi = psiDotDi[i];
      const psiDj = psiDotDi[j];
      // (conj(psiDi)) * psiDj
      const subRe = psiDi[0] * psiDj[0] + psiDi[1] * psiDj[1];
      const value = a[0] - subRe;
      F[i][j] = value;
      F[j][i] = value;
    }
  }
  return F;
}

/** Re/Im inner product ⟨a|b⟩ = Σ conj(a_i) · b_i over interleaved arrays. */
function innerProduct(a: Float64Array, b: Float64Array, dim: number): [number, number] {
  let re = 0, im = 0;
  for (let i = 0; i < dim; i++) {
    const aRe = a[2 * i], aIm = a[2 * i + 1];
    const bRe = b[2 * i], bIm = b[2 * i + 1];
    re += aRe * bRe + aIm * bIm;
    im += aRe * bIm - aIm * bRe;
  }
  return [re, im];
}

/**
 * Solve A · x = b for x via Gauss-Jordan elimination with partial pivoting.
 * Sized for small k (≤ ~20 free parameters); not optimised for big systems.
 */
function solveLinearSystem(Ain: number[][], bIn: number[]): number[] {
  const n = bIn.length;
  const A = Ain.map((row) => [...row]);
  const b = [...bIn];
  for (let i = 0; i < n; i++) {
    // Partial pivot.
    let maxRow = i;
    let maxAbs = Math.abs(A[i][i]);
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(A[r][i]);
      if (v > maxAbs) { maxAbs = v; maxRow = r; }
    }
    if (maxRow !== i) {
      [A[i], A[maxRow]] = [A[maxRow], A[i]];
      [b[i], b[maxRow]] = [b[maxRow], b[i]];
    }
    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-14) {
      // Singular; fall back to plain gradient direction for this row.
      continue;
    }
    for (let c = i; c < n; c++) A[i][c] /= pivot;
    b[i] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = A[r][i];
      if (factor === 0) continue;
      for (let c = i; c < n; c++) A[r][c] -= factor * A[i][c];
      b[r] -= factor * b[i];
    }
  }
  return b;
}

/**
 * Sweep one or two free symbols across [-π, π] (or a user-supplied range)
 * and return a grid of ⟨P⟩ values. Used by the Landscape sub-panel to
 * render a 1D curve (one symbol) or 2D heatmap (two symbols). 32×32 is
 * a reasonable default — 1 024 sim calls finish under a second for
 * n ≤ 10.
 */
export async function computeLandscape(
  circuit: Circuit,
  paramValues: ParameterValues,
  customGates: CustomGate[],
  observable: Pauli[] | Observable,
  symbols: string[],
  grid: number,
  range: [number, number],
  noise?: NoiseModel,
): Promise<number[][]> {
  if (symbols.length < 1 || symbols.length > 2) {
    throw new Error("landscape supports 1 or 2 symbols");
  }
  const [lo, hi] = range;
  const out: number[][] = [];
  // Each grid evaluation uses an independent params clone so the row can
  // run in Promise.all without mutation races on a shared object.
  const at = (x: number, y?: number) => {
    const p: ParameterValues = { ...paramValues };
    p[symbols[0]] = x;
    if (y !== undefined && symbols.length === 2) p[symbols[1]] = y;
    return evaluate(circuit, customGates, p, observable, noise);
  };
  if (symbols.length === 1) {
    const row = await Promise.all(Array.from({ length: grid }, (_, i) => {
      const x = lo + (hi - lo) * (i / (grid - 1));
      return at(x);
    }));
    out.push(row);
  } else {
    for (let j = 0; j < grid; j++) {
      const y = lo + (hi - lo) * (j / (grid - 1));
      const row = await Promise.all(Array.from({ length: grid }, (_, i) => {
        const x = lo + (hi - lo) * (i / (grid - 1));
        return at(x, y);
      }));
      out.push(row);
    }
  }
  return out;
}

/**
 * Barren-plateau diagnostic. Samples `samples` uniformly random points
 * over [-π, π] for each symbol, computes the central-difference gradient
 * at each point, returns the per-symbol gradient variance. A value
 * exponentially small in n is the textbook signature of a barren plateau
 * — the ansatz is essentially un-trainable from a random init.
 */
export async function barrenPlateauDiagnostic(
  circuit: Circuit,
  customGates: CustomGate[],
  observable: Pauli[] | Observable,
  symbols: string[],
  samples: number,
  noise?: NoiseModel,
): Promise<{ variancePerSymbol: number[]; meanGradPerSymbol: number[] }> {
  const eps = 1e-3;
  const grads: number[][] = symbols.map(() => []);
  for (let s = 0; s < samples; s++) {
    const base: ParameterValues = {};
    for (const sym of symbols) base[sym] = (Math.random() * 2 - 1) * Math.PI;
    // Central differences per symbol: 2k independent evaluations, run
    // concurrently so the GPU queue overlaps trajectory passes.
    const evals = await Promise.all(symbols.flatMap((sym) => {
      const plus: ParameterValues = { ...base, [sym]: (base[sym] ?? 0) + eps };
      const minus: ParameterValues = { ...base, [sym]: (base[sym] ?? 0) - eps };
      return [
        evaluate(circuit, customGates, plus, observable, noise),
        evaluate(circuit, customGates, minus, observable, noise),
      ];
    }));
    for (let i = 0; i < symbols.length; i++) {
      const ePlus = evals[2 * i];
      const eMinus = evals[2 * i + 1];
      grads[i].push((ePlus - eMinus) / (2 * eps));
    }
  }
  const variancePerSymbol = grads.map((g) => variance(g));
  const meanGradPerSymbol = grads.map((g) => g.reduce((a, b) => a + b, 0) / Math.max(1, g.length));
  return { variancePerSymbol, meanGradPerSymbol };
}

function variance(xs: number[]): number {
  if (xs.length === 0) return 0;
  let m = 0;
  for (const x of xs) m += x;
  m /= xs.length;
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return v / xs.length;
}
