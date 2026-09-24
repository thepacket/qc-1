/**
 * The normal-matrix eigensolver on unitaries of known spectrum,
 * W = Q diag(e^{iθ}) Q† with Q a seeded random unitary: well-separated,
 * exactly degenerate, ± pairs, clusters 1e-8 and 1e-10 wide, near identity,
 * for dimensions 2…64. Residuals, orthonormality and the phases themselves.
 */
import { describe, test, expect } from "vitest";
import { normalEig } from "../src/calc/normalEig";
import { randomUnitary, rng, withSpectrum } from "./unitaries";

const KINDS = ["random", "degenerate", "conjugate", "cluster1e-8", "cluster1e-10", "nearidentity"] as const;
function phases(kind: (typeof KINDS)[number], n: number, r: () => number): number[] {
  const u = () => 2 * r() - 1;
  switch (kind) {
    case "random": return Array.from({ length: n }, () => 3 * u());
    case "degenerate": return Array.from({ length: n }, () => [-0.7, 0.3, 1.5][Math.floor(3 * r())]);
    case "conjugate": return Array.from({ length: n }, (_, k) => (k % 2 ? 0.7 : -0.7));
    case "nearidentity": return Array.from({ length: n }, () => 1e-10 * u());
    default: return Array.from({ length: n }, () => (r() < 0.5 ? -0.9 : 0.8) + u() * (kind === "cluster1e-8" ? 1e-8 : 1e-10));
  }
}

describe("normal eigensolver on known spectra", () => {
  const r = rng(93741);
  const cases = [2, 4, 8, 16, 32, 64].flatMap((n) => KINDS.map((kind) => ({ n, kind, Q: randomUnitary(n, r), th: phases(kind, n, r) })));
  test.each(cases.map((c) => [c.n, c.kind, c] as const))("n = %s, %s", (_, __, c) => {
    const res = normalEig(withSpectrum(c.Q, c.th));
    expect(res.residual).toBeLessThan(1e-12);
    expect(res.orthogonality).toBeLessThan(1e-12);
    const got = res.values.map((z) => Math.atan2(z.im, z.re)).sort((a, b) => a - b);
    const want = [...c.th].sort((a, b) => a - b);
    got.forEach((x, k) => expect(Math.abs(x - want[k])).toBeLessThan(1e-13));
  });
});
