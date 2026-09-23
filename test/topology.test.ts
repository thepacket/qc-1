import { describe, test, expect } from "vitest";
import { chernNumber } from "../src/sim/chernNumber";
import { zxDiagram } from "../src/sim/zx";
import { lowerTape, namedCircuit } from "../src/calc/lower";
import type { Entry } from "../src/calc/steps";

const st = (g: string, t: number[], p: string[] = [], c: number[] = []): Entry => [
  { id: `${g}${t}${c}`, gateId: g, column: 0, targets: t, controls: c, clbits: [], params: p },
];

/**
 * Qi–Wu–Zhang two-band model h(k) = sin kx σx + sin ky σy + (m + cos kx + cos ky) σz.
 * Its lower band has Chern number ±1 for 0 < |m| < 2 and 0 for |m| > 2.
 * The lower-band state is the Bloch vector −d̂ = U(Θ, Φ, 0)|0⟩ with kx = θ, ky = φ.
 */
function qwz(m: number): Entry[] {
  const dx = "sin(θ)", dy = "sin(φ)", dz = `(${m}+cos(θ)+cos(φ))`;
  const norm = `sqrt(${dx}**2+${dy}**2+${dz}**2)`;
  const X = `(-${dx})`, Y = `(-${dy})`;
  const Theta = `acos(-${dz}/${norm})`;
  // atan2(Y, X) written with the evaluator's functions (JS ternaries are allowed in expressions).
  const Phi = `(${X}>0 ? atan(${Y}/${X}) : ${X}<0 ? atan(${Y}/${X}) + (${Y}>=0 ? π : -π) : (${Y}>=0 ? π/2 : -π/2))`;
  return [st("u", [0], [Theta, Phi, "0"])];
}

describe("topology", () => {
  test.each([[1, 1], [-1, 1], [0.5, 1], [3, 0], [-2.6, 0]])("QWZ m = %s → |C| = %s", (m, want) => {
    const res = chernNumber(lowerTape(1, qwz(m)), { theta: 0, phi: 0 }, [], "theta", "phi", 24)!;
    expect(Math.abs(res.chern)).toBeCloseTo(want, 6);
  });
});

describe("ZX diagrams", () => {
  test("GHZ: H box, CX as green control → red target", () => {
    const zx = zxDiagram(namedCircuit(3, [st("h", [0]), st("x", [1], [], [0]), st("x", [2], [], [1])]));
    expect(zx.nodes.filter((n) => n.kind === "H")).toHaveLength(1);
    expect(zx.nodes.filter((n) => n.kind === "Z").map((n) => n.qubit).sort()).toEqual([0, 1]);
    expect(zx.nodes.filter((n) => n.kind === "X").map((n) => n.qubit).sort()).toEqual([1, 2]);
    expect(zx.edges.every((e) => !e.hadamard)).toBe(true);
  });

  test("CZ is a Hadamard edge between two green spiders; T is a π/4 phase", () => {
    const zx = zxDiagram(namedCircuit(2, [st("z", [1], [], [0]), st("t", [0])]));
    expect(zx.edges).toHaveLength(1);
    expect(zx.edges[0].hadamard).toBe(true);
    expect(zx.nodes.some((n) => n.kind === "Z" && n.phase === "π/4")).toBe(true);
  });
});
