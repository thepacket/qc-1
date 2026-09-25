import { describe, test, expect } from "vitest";
import { blochFromCounts, drawCounts, linearInversion, physical, rhoProbs, settings, stateProbs, tomography } from "../src/calc/tomography";
import { shotRng } from "../src/calc/estimate";
import { Register } from "../src/calc/register";
import { bloch } from "../src/calc/analysis";
import { calc, add, cx } from "./ed";

/** A seeded generic state on n qubits (RY/RZ layers and CX). */
function state(n: number) {
  const c = calc();
  c.setQubitCount(n);
  for (let q = 0; q < n; q++) { add(c, "ry", [q], { params: [String(0.7 + 0.4 * q)] }); add(c, "rz", [q], { params: [String(1.3 - 0.3 * q)] }); }
  for (let q = 0; q + 1 < n; q++) cx(c, q, q + 1);
  add(c, "rx", [0], { params: ["0.9"] });
  return new Register(n, c.tape).state;
}

const pure = (st: Float64Array) => {
  const d = st.length >> 1, rho = new Float64Array(2 * d * d);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    rho[2 * (i * d + j)] = st[2 * i] * st[2 * j] + st[2 * i + 1] * st[2 * j + 1];
    rho[2 * (i * d + j) + 1] = st[2 * i + 1] * st[2 * j] - st[2 * i] * st[2 * j + 1];
  }
  return rho;
};

/** |⟨a|b⟩|² */
const fidelity = (a: Float64Array, b: Float64Array) => {
  let re = 0, im = 0;
  for (let i = 0; i < a.length >> 1; i++) { re += a[2 * i] * b[2 * i] + a[2 * i + 1] * b[2 * i + 1]; im += a[2 * i] * b[2 * i + 1] - a[2 * i + 1] * b[2 * i]; }
  return re * re + im * im;
};

describe("state tomography (Pauli settings, linear inversion, Smolin–Gambetta–Smith)", () => {
  test("a setting's probabilities are the same from ψ and from |ψ⟩⟨ψ|, and sum to 1", () => {
    const st = state(3), rho = pure(st);
    for (const s of settings(3)) {
      const a = stateProbs(st, 3, s), b = rhoProbs(rho, 3, s);
      expect(a.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
      a.forEach((p, i) => expect(b[i]).toBeCloseTo(p, 12));
    }
  });

  test("with exact frequencies, linear inversion gives ρ back exactly", () => {
    const n = 2, st = state(n), rho = pure(st);
    const big = 1 << 30;
    // Counts proportional to the exact probabilities (no sampling noise).
    const counts = settings(n).map((s) => new Map([...stateProbs(st, n, s)].map((p, i) => [i, p * big] as [number, number])));
    const rhoHat = linearInversion(n, counts, big);
    rho.forEach((v, i) => expect(rhoHat[i]).toBeCloseTo(v, 9));
  });

  test("ρ̂ is Hermitian with trace 1; the projection is physical", () => {
    const n = 3, st = state(n);
    const counts = settings(n).map((s, k) => drawCounts(stateProbs(st, n, s), 64, shotRng(5, 16 + k)));
    const rhoHat = linearInversion(n, counts, 64);
    const d = 1 << n;
    let tr = 0;
    for (let i = 0; i < d; i++) {
      tr += rhoHat[2 * (i * d + i)];
      for (let j = 0; j < d; j++) {
        expect(rhoHat[2 * (i * d + j)]).toBeCloseTo(rhoHat[2 * (j * d + i)], 12);
        expect(rhoHat[2 * (i * d + j) + 1]).toBeCloseTo(-rhoHat[2 * (j * d + i) + 1], 12);
      }
    }
    expect(tr).toBeCloseTo(1, 12);
    const { values } = physical(rhoHat, d);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  test("the reconstruction converges to the state as the shots grow", () => {
    const n = 3, st = state(n);
    const F = (shots: number) => fidelity(tomography(n, shots, (s) => stateProbs(st, n, s), (k) => shotRng(11, 16 + k)).state, st);
    expect(F(64)).toBeGreaterThan(0.8);
    expect(F(20000)).toBeGreaterThan(0.995);
    expect(1 - F(20000)).toBeLessThan(1 - F(64));
  });

  test("a mixed ρ (noise) reconstructs with weight λ₁ < 1", () => {
    const n = 2, st = state(n), a = pure(st);
    const p = 0.3, d = 1 << n;
    const rho = a.map((v, i) => (1 - p) * v + (Math.floor(i / 2) % (d + 1) === 0 && i % 2 === 0 ? p / d : 0));
    const t = tomography(n, 50000, (s) => rhoProbs(rho, n, s), (k) => shotRng(3, 16 + k));
    expect(t.lambda).toBeLessThan(0.9);
    expect(t.lambda).toBeGreaterThan(0.7); // 1 − p + p/4 = 0.775
    expect(fidelity(t.state, st)).toBeGreaterThan(0.99);
  });

  test("Bloch vectors from X, Y, Z experiments converge, errors ∝ 1/√N", () => {
    const n = 2, st = state(n);
    const exp = (s: (0 | 1 | 2)[], shots: number, e: number) => drawCounts(stateProbs(st, n, s), shots, shotRng(9, e));
    const run = (shots: number) => blochFromCounts(n, exp([0, 0], shots, 1), exp([1, 1], shots, 2), exp([2, 2], shots, 0), shots);
    const small = run(400), big = run(40000);
    for (let q = 0; q < n; q++) {
      const v = bloch(st, n, q);
      expect(Math.abs(big.vectors[q].x - v.x)).toBeLessThan(5 * big.errors[q].x + 1e-3);
      expect(Math.abs(big.vectors[q].y - v.y)).toBeLessThan(5 * big.errors[q].y + 1e-3);
      expect(Math.abs(big.vectors[q].z - v.z)).toBeLessThan(5 * big.errors[q].z + 1e-3);
      const ratio = small.errors[q].x / big.errors[q].x; // √(40000/400) = 10, give or take the estimate's own spread
      expect(ratio).toBeGreaterThan(8);
      expect(ratio).toBeLessThan(12);
    }
  });
});
