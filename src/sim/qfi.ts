/**
 * Quantum Fisher Information (QFI) for phase estimation — the metrological
 * figure of merit and a multipartite-entanglement witness.
 *
 * For a PURE state |ψ⟩ and a Hermitian generator G (the phase is imprinted by
 * e^{-iθG}), the QFI is four times the generator variance:
 *
 *     F_Q[ψ, G] = 4 (⟨G²⟩ − ⟨G⟩²) = 4 Var_ψ(G).
 *
 * With the collective-spin generator J_α = ½ Σ_i σ_α^(i) (α ∈ {x,y,z}) on N
 * qubits, F_Q has hard bounds:
 *   • separable states:        F_Q ≤ N          (standard quantum limit, SQL)
 *   • k-producible witness:    F_Q > N  ⇒ the state is entangled and useful
 *   • maximal (e.g. GHZ):      F_Q = N²         (Heisenberg limit)
 * so F_Q / N > 1 is a collective-generator entanglement witness and quantifies
 * the metrological gain over the shot-noise limit.
 *
 * We compute Gψ exactly by applying the Pauli-sum generator term-by-term
 * (sparse Pauli action), then ⟨G⟩ = Re⟨ψ|Gψ⟩ and ⟨G²⟩ = ‖Gψ‖². Cost
 * O(|G| · 2ⁿ); fine to the statevector cap.
 */

import { hermitianEig } from "./eig";
import type { Complex } from "./density";
import { pauliSparse } from "./pauliMatrix";

export type GeneratorTerm = { coefficient: number; paulis: string };

export type QfiResult = {
  /** ⟨G⟩. */
  expG: number;
  /** ⟨G²⟩. */
  expG2: number;
  /** Var(G) = ⟨G²⟩ − ⟨G⟩². */
  variance: number;
  /** QFI; equals 4 Var(G) only for pure states. */
  qfi: number;
  /** F_Q / N — the metrological gain (separable ≤ 1, witnesses entanglement when > 1). */
  qfiDensity: number;
  /** Standard quantum limit for the collective generator = N. */
  sql: number;
  /** Heisenberg limit = N². */
  heisenberg: number;
  /** True iff F_Q > N (state is entangled and metrologically useful). */
  witnessesEntanglement: boolean;
};

/** The collective-spin generator J_α = ½ Σ_i σ_α on n qubits. */
export function collectiveSpinGenerator(n: number, axis: "X" | "Y" | "Z"): GeneratorTerm[] {
  const terms: GeneratorTerm[] = [];
  for (let q = 0; q < n; q++) {
    const p = Array.from({ length: n }, (_, k) => (k === q ? axis : "I")).join("");
    terms.push({ coefficient: 0.5, paulis: p });
  }
  return terms;
}

/** QFI of a pure state for a Pauli-sum generator G. */
export function quantumFisherPure(state: Float64Array, n: number, generator: GeneratorTerm[]): QfiResult {
  const dim = 1 << n;
  const gRe = new Float64Array(dim);
  const gIm = new Float64Array(dim);

  for (const term of generator) {
    if (term.coefficient === 0) continue;
    const { perm, phRe, phIm } = pauliSparse(n, term.paulis);
    const h = term.coefficient;
    for (let c = 0; c < dim; c++) {
      const pr = state[2 * c];
      const pi = state[2 * c + 1];
      // (phase · ψ_c), phase = phRe + i·phIm
      const ar = phRe[c] * pr - phIm[c] * pi;
      const ai = phRe[c] * pi + phIm[c] * pr;
      const d = perm[c];
      gRe[d] += h * ar;
      gIm[d] += h * ai;
    }
  }

  let expG = 0;
  let expG2 = 0;
  for (let c = 0; c < dim; c++) {
    const pr = state[2 * c];
    const pi = state[2 * c + 1];
    // Re⟨ψ|Gψ⟩ = Re( conj(ψ_c) · Gψ_c )
    expG += pr * gRe[c] + pi * gIm[c];
    expG2 += gRe[c] * gRe[c] + gIm[c] * gIm[c];
  }

  const variance = Math.max(0, expG2 - expG * expG);
  const qfi = 4 * variance;
  return {
    expG,
    expG2,
    variance,
    qfi,
    qfiDensity: n > 0 ? qfi / n : 0,
    sql: n,
    heisenberg: n * n,
    witnessesEntanglement: qfi > n + 1e-9,
  };
}

/**
 * F_Q = 2 Σ_ab (λ_a−λ_b)²/(λ_a+λ_b) |⟨a|G|b⟩|².
 * Zero/zero pairs contribute zero. Unlike the pure formula, incoherent
 * variance cannot witness entanglement. Reference: doi:10.1038/s41598-017-15323-7, Eq. 9.
 */
export function quantumFisherMixed(rho: Complex[][], n: number, generator: GeneratorTerm[]): QfiResult {
  if (n > 6) throw new Error("Mixed-state QFI supports up to 6 qubits.");
  const d = 2 ** n;
  const { values, vectors } = hermitianEig(rho);
  const weights = values.map(x => Math.max(0, x));
  const terms = generator.map(t => ({ h: t.coefficient, ...pauliSparse(n, t.paulis) }));
  let qfi = 0, expG = 0, expG2 = 0;
  for (let b = 0; b < d; b++) {
    const re = new Float64Array(d), im = new Float64Array(d);
    for (const { h, perm, phRe, phIm } of terms) for (let c = 0; c < d; c++) {
      const v = vectors[b][c], k = perm[c];
      re[k] += h * (phRe[c] * v.re - phIm[c] * v.im);
      im[k] += h * (phRe[c] * v.im + phIm[c] * v.re);
    }
    for (let c = 0; c < d; c++) expG2 += weights[b] * (re[c] ** 2 + im[c] ** 2);
    for (let a = 0; a < d; a++) {
      let gr = 0, gi = 0;
      for (let c = 0; c < d; c++) {
        const v = vectors[a][c];
        gr += v.re * re[c] + v.im * im[c];
        gi += v.re * im[c] - v.im * re[c];
      }
      if (a === b) expG += weights[b] * gr;
      const sum = weights[a] + weights[b];
      if (sum > 1e-14) qfi += 2 * (weights[a] - weights[b]) ** 2 / sum * (gr * gr + gi * gi);
    }
  }
  return { expG, expG2, variance: Math.max(0, expG2 - expG ** 2), qfi,
    qfiDensity: qfi / n, sql: n, heisenberg: n * n, witnessesEntanglement: qfi > n + 1e-9 };
}
