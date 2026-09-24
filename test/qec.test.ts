import { describe, test, expect } from "vitest";
import { decodeAll, extractionTape, flipsOf, logicalErrorRate, parseErrors, repetitionCode, surfaceCode, syndromeOf, type Code } from "../src/noise/qec";
import { StabilizerRegister } from "../src/stab/register";
import { Register } from "../src/calc/register";

/** Do two Pauli operators (X and Z supports) commute? */
const commute = (ax: number[], az: number[], bx: number[], bz: number[]) =>
  (ax.filter((q) => bz.includes(q)).length + az.filter((q) => bx.includes(q)).length) % 2 === 0;
const sup = (c: Code["checks"][number]) => (c.type === "X" ? [c.qubits, []] : [[], c.qubits]) as [number[], number[]];

/** Every subset of `n` items of size ≤ w. */
function* subsets(n: number, w: number, from = 0, cur: number[] = []): Generator<number[]> {
  yield cur;
  if (cur.length === w) return;
  for (let q = from; q < n; q++) yield* subsets(n, w, q + 1, [...cur, q]);
}

describe("codes", () => {
  test.each([3, 5, 7, 9])("surface code d=%i: d²−1 commuting checks, logicals commute with them and anticommute with each other", (d) => {
    const c = surfaceCode(d);
    expect(c.checks).toHaveLength(d * d - 1);
    for (const a of c.checks) for (const b of c.checks) expect(commute(...sup(a), ...sup(b))).toBe(true);
    for (const ch of c.checks) {
      expect(commute(c.logicalX, [], ...sup(ch))).toBe(true);
      expect(commute([], c.logicalZ, ...sup(ch))).toBe(true);
    }
    expect(commute(c.logicalX, [], [], c.logicalZ)).toBe(false);
    // Every data qubit is in at least one check of each type.
    for (let q = 0; q < c.n; q++) for (const t of ["X", "Z"]) expect(c.checks.some((ch) => ch.type === t && ch.qubits.includes(q))).toBe(true);
  });
});

describe("union-find decoder", () => {
  test.each([3, 5, 7])("surface d=%i corrects every X, Z and Y error of weight ≤ (d−1)/2", (d) => {
    const c = surfaceCode(d), t = (d - 1) / 2;
    for (const qs of subsets(c.n, t)) {
      for (const p of ["X", "Z", "Y"] as const) {
        const ex = new Uint8Array(c.n), ez = new Uint8Array(c.n);
        for (const q of qs) { if (p !== "Z") ex[q] = 1; if (p !== "X") ez[q] = 1; }
        const r = decodeAll(c, ex, ez);
        expect(r.repair).toBe(true);
        expect(r.logicalX || r.logicalZ, `${p} on ${qs}`).toBe(false);
      }
    }
  }, 30_000); // exhaustive: ~2.6 s alone at d = 7, more when the suite runs in parallel

  test("mixed errors too: every pair of single-qubit Paulis on d=5", () => {
    const c = surfaceCode(5);
    for (let a = 0; a < c.n; a++) for (let b = a + 1; b < c.n; b++) for (const pa of "XYZ") for (const pb of "XYZ") {
      const { ex, ez } = parseErrors(c, `${pa}${a} ${pb}${b}`);
      const r = decodeAll(c, ex, ez);
      expect(r.logicalX || r.logicalZ).toBe(false);
    }
  });

  test.each([3, 5, 7, 9])("repetition d=%i: corrects ⌊d/2⌋ bit flips; the syndrome sees no phase flips", (d) => {
    const c = repetitionCode(d);
    for (const qs of subsets(d, (d - 1) / 2)) {
      const ex = new Uint8Array(d);
      qs.forEach((q) => (ex[q] = 1));
      expect(decodeAll(c, ex, new Uint8Array(d)).logicalX).toBe(false);
    }
    expect(syndromeOf(c, new Uint8Array(d), new Uint8Array(d).fill(1)).every((b) => b === 0)).toBe(true);
  });
});

describe("code-capacity Monte Carlo", () => {
  test("repetition code: the logical rate matches the binomial tail Σ_{k>d/2} C(d,k) pᵏ(1−p)^{d−k}, within 4σ", () => {
    const d = 5, p = 0.12, shots = 20000;
    const choose = (n: number, k: number): number => (k === 0 ? 1 : (choose(n, k - 1) * (n - k + 1)) / k);
    let exact = 0;
    for (let k = 3; k <= d; k++) exact += choose(d, k) * p ** k * (1 - p) ** (d - k);
    const got = logicalErrorRate(repetitionCode(d), p, "bitflip", shots, 11);
    expect(Math.abs(got - exact)).toBeLessThan(4 * Math.sqrt((exact * (1 - exact)) / shots));
  });

  test("surface code: below threshold bigger codes are better, above it worse (bit flips, code capacity)", () => {
    const rate = (d: number, p: number) => logicalErrorRate(surfaceCode(d), p, "bitflip", 3000, 3);
    expect(rate(7, 0.03)).toBeLessThan(rate(3, 0.03));
    expect(rate(7, 0.2)).toBeGreaterThan(rate(3, 0.2));
  });
});

describe("the syndrome-extraction circuit", () => {
  test("QC-1's simulation of it flips exactly the lit checks (d=3 statevector, d=5 stabilizer)", () => {
    for (const [c, errs] of [[surfaceCode(3), "X4 Z0 Y8"], [surfaceCode(3), "Z5"], [surfaceCode(5), "X3 Z11 Y20 X24"], [repetitionCode(7), "X2 X3"]] as const) {
      const { ex, ez } = parseErrors(c, errs);
      const tape = extractionTape(c, ex, ez);
      const n = c.n + c.checks.length;
      const reg = n <= 20 ? new Register(n, tape) : new StabilizerRegister(n, tape);
      expect([...flipsOf(c, reg.tape)]).toEqual([...syndromeOf(c, ex, ez)]);
    }
  });
});
