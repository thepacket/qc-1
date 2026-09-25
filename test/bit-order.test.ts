import { describe, test, expect } from "vitest";
import { calc, add, stateOf } from "./ed";
import { ket } from "../src/ui/format";
import { pauliSumExpectation, parsePauliSumFor } from "./bit-order-helpers";
import { StabilizerRegister } from "../src/stab/register";
import { qiskitGenerators } from "../src/calc/order";
import { exportQasm3 } from "../src/qasm/fromTape";
import { branchTree } from "../src/calc/branches";
import { runAnalysis } from "../src/analysis/run";

/**
 * QC-1 writes states as Qiskit does: qubit q is bit q of a basis index, so q0
 * is the RIGHTMOST character of kets, bitstrings and Pauli labels.
 */
describe("Qiskit's bit order", () => {
  test("X on q0 of 3 qubits: index 1, KET |001⟩, SHOTS 001", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "x", [0]);
    const st = stateOf(c);
    expect(st[2]).toBeCloseTo(1, 12); // amplitude of index 1
    expect(ket(1, 3)).toBe("|001⟩");
    c.setMode("shots");
    const v = c.view!;
    if (v.mode !== "shots") throw new Error(v.mode);
    expect(v.rows.map((r) => ket(r.i, 3))).toEqual(["|001⟩"]);
  });

  test("a Pauli label reads q0 on its right: ⟨IIZ⟩ = −1 and ⟨ZII⟩ = +1 after X on q0", () => {
    const c = calc();
    c.setQubitCount(3);
    add(c, "x", [0]);
    expect(pauliSumExpectation(stateOf(c), 3, parsePauliSumFor("IIZ"))).toBeCloseTo(-1, 12);
    expect(pauliSumExpectation(stateOf(c), 3, parsePauliSumFor("ZII"))).toBeCloseTo(1, 12);
  });

  test.each(["IIZ", "iiz", "IiZ", "I I Z", " i\tI\nz "])("accepted Pauli spelling %j still targets q0", async (obs) => {
    const c = calc(); c.setQubitCount(3); add(c, "x", [0]);
    const ctx = { n: c.n, tape: c.tape, scope: {}, state: stateOf(c) };
    const result = await runAnalysis("expectation", ctx, { obs });
    expect(result.error).toBeUndefined();
    expect(result.scalars!.find(s => s.label === "⟨H⟩")!.value).toBe(-1);
  });

  test("Pauli sums preserve signed scientific coefficients and display Qiskit term labels", async () => {
    const c = calc(); c.setQubitCount(3); add(c, "x", [0]);
    const ctx = { n: c.n, tape: c.tape, scope: {}, state: stateOf(c) };
    const result = await runAnalysis("expectation", ctx, { obs: "1e-1*i I z - 2E+0*Z i I" });
    expect(result.error).toBeUndefined();
    expect(result.scalars!.find(s => s.label === "⟨H⟩")!.value).toBe(-2.1);
    const bars = result.charts!.find(c => c.kind === "bars")!;
    expect(bars.labels).toEqual(["IIZ", "ZII"]);
    expect(bars.values).toEqual([-0.1, -2]);
  });

  test("Classical Shadows labels identify the observables whose values are shown", async () => {
    const c = calc(); c.setQubitCount(3); add(c, "x", [0]);
    const ctx = { n: c.n, tape: c.tape, scope: {}, state: stateOf(c) };
    const result = await runAnalysis("shadows", ctx, { obs: "iiz + 2*zii" });
    expect(result.error).toBeUndefined();
    const table = result.charts!.find(c => c.kind === "table")!;
    expect(table.rows.map(row => [row[0], row[1], row[4]])).toEqual([["IIZ", 1, -1], ["ZII", 2, 1]]);
  });

  test("stabilizer generators and shots, above 20 qubits too, are written as Qiskit writes them", () => {
    const x0 = [[{ id: "x", gateId: "x", column: 0, targets: [0], controls: [], clbits: [], params: [] }]];
    const gens = qiskitGenerators(new StabilizerRegister(3, x0).tab.stabilizers());
    expect(gens).toContain("-IIZ"); // Z on q0 has eigenvalue −1
    const c = calc();
    c.setQubitCount(24);
    add(c, "x", [0]);
    c.setMode("shots");
    const v = c.view!;
    if (v.mode !== "shots") throw new Error(v.mode);
    expect((v.rows[0] as { bits: string }).bits).toBe("0".repeat(23) + "1");
  });

  test("classical bits print c[k−1] … c[0], as Qiskit's counts", () => {
    const c = calc();
    c.setQubitCount(2);
    add(c, "x", [0]);
    add(c, "measure", [0]);
    add(c, "measure", [1]);
    expect(branchTree(2, c.tape).leaves.map((l) => l.cbits)).toEqual(["01"]); // c0 = 1 on the right
  });

  test("the export is gate-level: the same OpenQASM whatever the bit order", () => {
    const c = calc();
    add(c, "x", [0]);
    expect(exportQasm3(c.n, c.tape)).toContain("x q[0];");
  });
});
