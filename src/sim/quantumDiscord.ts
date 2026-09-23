/**
 * Pairwise quantum discord — the quantum correlations that survive *beyond*
 * entanglement. For each qubit pair the total correlation is the mutual
 * information I = S(ρ_A) + S(ρ_B) − S(ρ_AB); the classical part J is the most
 * information a local measurement on B can reveal about A,
 *
 *   J = S(ρ_A) − min_{ {Π_k} } Σ_k p_k S(ρ_{A|k}),
 *
 * and the discord is D = I − J ≥ 0. D > 0 even for some *separable* states, so
 * it captures non-classical correlation that concurrence/negativity miss; it
 * vanishes only for classical-quantum states. We minimise the conditional
 * entropy over projective measurements of B (a grid over the Bloch sphere of
 * the measurement axis). Per-pair heatmap; reuses the 2-qubit reduced states.
 */

import { reducedDensityMatrix, type Complex } from "./density";
import { vonNeumannEntropy } from "./entanglement";

export type DiscordResult = {
  /** d[a][b] = quantum discord of the (a,b) pair (B measured); 0 diagonal. */
  d: number[][];
  numQubits: number;
  max: number;
};

/** S(ρ) for a 2×2 density matrix. */
function entropy2(rho: Complex[][]): number {
  return vonNeumannEntropy(rho);
}

/** Discord D(A|B) for a 4×4 two-qubit ρ (index = 2·a_bit + b_bit, A is MSB). */
function discordPair(rhoAB: Complex[][], rhoA: Complex[][], rhoB: Complex[][], thetaSteps = 9, phiSteps = 12): number {
  const sA = vonNeumannEntropy(rhoA);
  const sB = vonNeumannEntropy(rhoB);
  const sAB = vonNeumannEntropy(rhoAB);
  const I = sA + sB - sAB;

  // Minimise Σ p_k S(ρ_{A|k}) over projective measurements of B along n̂.
  // Antipodal axes give the same two projectors, so the upper hemisphere
  // (θ ∈ [0, π/2]) covers all measurements.
  const condAt = (theta: number, phi: number) => {
    const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
    // |+n̂⟩ = (c, s e^{iφ}); projector P+ = |+⟩⟨+| (2×2).
    const pr: Complex[][] = [
      [{ re: c * c, im: 0 }, { re: c * s * Math.cos(phi), im: -c * s * Math.sin(phi) }],
      [{ re: c * s * Math.cos(phi), im: c * s * Math.sin(phi) }, { re: s * s, im: 0 }],
    ];
    return conditionalEntropy(rhoAB, pr);
  };
  const grid: [number, number, number][] = [];
  for (let it = 0; it <= thetaSteps; it++) {
    const theta = (Math.PI / 2) * (it / thetaSteps);
    for (let ip = 0; ip < phiSteps; ip++) {
      const phi = (2 * Math.PI * ip) / phiSteps;
      grid.push([condAt(theta, phi), theta, phi]);
    }
  }
  // QC-1 fix (docs/quantiom-bugs.md #9): the grid alone over-estimates the
  // discord by up to ~0.01 bit. Refine the best grid points locally.
  grid.sort((x, y) => x[0] - y[0]);
  let minCond = grid[0][0];
  for (const [, t0, p0] of grid.slice(0, 3)) {
    minCond = Math.min(minCond, nelderMead2((x) => condAt(x[0], x[1]), [t0, p0], 0.15));
  }
  const J = sA - minCond;
  return Math.max(0, I - J);
}

/** QC-1: 2-D Nelder–Mead minimiser (returns the minimum value). */
function nelderMead2(f: (x: [number, number]) => number, x0: [number, number], step: number): number {
  let pts: [number, number][] = [x0, [x0[0] + step, x0[1]], [x0[0], x0[1] + step]];
  let val = pts.map(f);
  for (let it = 0; it < 400; it++) {
    const order = [0, 1, 2].sort((a, b) => val[a] - val[b]);
    pts = order.map((i) => pts[i]);
    val = order.map((i) => val[i]);
    if (Math.abs(val[2] - val[0]) < 1e-15 && Math.hypot(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1]) < 1e-10) break;
    const c: [number, number] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    const at = (t: number): [number, number] => [c[0] + t * (pts[2][0] - c[0]), c[1] + t * (pts[2][1] - c[1])];
    const xr = at(-1), fr = f(xr);
    if (fr < val[0]) {
      const xe = at(-2), fe = f(xe);
      if (fe < fr) { pts[2] = xe; val[2] = fe; } else { pts[2] = xr; val[2] = fr; }
    } else if (fr < val[1]) {
      pts[2] = xr; val[2] = fr;
    } else {
      const xc = at(0.5), fc = f(xc);
      if (fc < val[2]) { pts[2] = xc; val[2] = fc; } else {
        for (const i of [1, 2]) {
          pts[i] = [(pts[i][0] + pts[0][0]) / 2, (pts[i][1] + pts[0][1]) / 2];
          val[i] = f(pts[i]);
        }
      }
    }
  }
  return Math.min(...val);
}

/** Σ_k p_k S(ρ_{A|k}) for measuring B with projectors {P, I−P}. */
function conditionalEntropy(rhoAB: Complex[][], P: Complex[][]): number {
  let total = 0;
  for (let which = 0; which < 2; which++) {
    // Projector on B: P (which=0) or I−P (which=1).
    const Pk = (b: number, bp: number): Complex => {
      const base = P[b][bp];
      if (which === 0) return base;
      // I − P
      return { re: (b === bp ? 1 : 0) - base.re, im: -base.im };
    };
    // ρ_{A|k} ∝ Tr_B[(I⊗Pk) ρ (I⊗Pk)]; p_k = Tr of that.
    const rhoCond: Complex[][] = [[{ re: 0, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 0, im: 0 }]];
    for (let a = 0; a < 2; a++) {
      for (let ap = 0; ap < 2; ap++) {
        let re = 0, im = 0;
        // (I⊗Pk ρ I⊗Pk)_{(a,b),(ap,b)} summed over b (partial trace over B).
        for (let b = 0; b < 2; b++) {
          for (let beta = 0; beta < 2; beta++) {
            for (let betap = 0; betap < 2; betap++) {
              // Pk[b,beta] · ρ[(a,beta),(ap,betap)] · Pk[betap,b]
              const p1 = Pk(b, beta);
              const p2 = Pk(betap, b);
              const r = rhoAB[2 * a + beta][2 * ap + betap];
              // p1 * r * p2
              const t1Re = p1.re * r.re - p1.im * r.im;
              const t1Im = p1.re * r.im + p1.im * r.re;
              re += t1Re * p2.re - t1Im * p2.im;
              im += t1Re * p2.im + t1Im * p2.re;
            }
          }
        }
        rhoCond[a][ap] = { re, im };
      }
    }
    const pk = rhoCond[0][0].re + rhoCond[1][1].re;
    if (pk < 1e-12) continue;
    const norm: Complex[][] = rhoCond.map((row) => row.map((z) => ({ re: z.re / pk, im: z.im / pk })));
    total += pk * entropy2(norm);
  }
  return total;
}

export const MAX_DISCORD_QUBITS = 8;

export function quantumDiscordMap(state: Float64Array, n: number, maxQubits = MAX_DISCORD_QUBITS): DiscordResult | null {
  if (n < 2 || n > maxQubits) return null;
  const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  let max = 0;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const rhoAB = reducedDensityMatrix(state, n, [a, b]); // A = MSB
      const rhoA = reducedDensityMatrix(state, n, [a]);
      const rhoB = reducedDensityMatrix(state, n, [b]);
      const val = discordPair(rhoAB, rhoA, rhoB);
      d[a][b] = val;
      if (val > max) max = val;
    }
  }
  return { d, numQubits: n, max };
}
