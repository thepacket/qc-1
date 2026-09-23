import { describe, test, expect } from "vitest";
import { cases, compute } from "../../validation/cases/groups/state2";
import { deepClose, loadFixture } from "./fixtures";

// References: qiskit.quantum_info + numpy/scipy from definitions (validation/ref/g_state2.py).
type Star = { theta: number; phi: number };
const fx = loadFixture<Record<string, unknown>>("state2");
const { abs, discord: discordTol, ...tols } = fx.meta.tol as { abs: number; discord: number } & Record<string, number>;

const unit = (s: Star) => [Math.sin(s.theta) * Math.cos(s.phi), Math.sin(s.theta) * Math.sin(s.phi), Math.cos(s.theta)];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Majorana stars are a set: pair each reference star with the nearest unused QC-1 star. */
function starDistance(mine: Star[], ref: Star[]): number {
  const left = mine.map(unit);
  let worst = 0;
  for (const s of ref) {
    const u = unit(s);
    const d = left.map((w) => dist(u, w));
    const k = d.indexOf(Math.min(...d));
    worst = Math.max(worst, d[k]);
    left.splice(k, 1);
  }
  return worst;
}
/** A k-fold root is only computable to ~eps^(1/k): loose tolerance for degenerate constellations. */
function starTol(ref: Star[]): number {
  const v = ref.map(unit);
  let sep = 2;
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) sep = Math.min(sep, dist(v[i], v[j]));
  return sep > 0.05 ? 1e-8 : 5e-3;
}

describe(`state-only analyses (vs qiskit ${fx.meta.versions.qiskit} + numpy)`, () => {
  const byId = new Map(cases().map((c) => [c.id, c]));
  test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    // JSON round trip: Infinity/NaN become null, exactly as in the dump.
    const mine = JSON.parse(JSON.stringify(compute(byId.get(c.id) ?? c))) as Record<string, unknown>;
    const exp = c.expected as Record<string, unknown>;
    const { majorana: mj, discord: md, ...rest } = mine;
    const { majorana: ej, discord: ed, ...restExp } = exp;
    expect(deepClose(rest, restExp, abs, tols)).toEqual([]);
    if (ed) expect(deepClose(md, ed, discordTol)).toEqual([]);
    if (ej) {
      const a = mj as { symmetricWeight: number; stars: Star[] };
      const b = ej as { symmetricWeight: number; stars: Star[] };
      expect(a.symmetricWeight).toBeCloseTo(b.symmetricWeight, 9);
      expect(starDistance(a.stars, b.stars)).toBeLessThan(starTol(b.stars));
    }
  });
});
