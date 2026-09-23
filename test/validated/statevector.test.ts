import { describe, test, expect } from "vitest";
import { Register } from "../../src/calc/register";
import { exportQasm3 } from "../../src/qasm/fromTape";
import { setCustomGates, type CustomGate } from "../../src/calc/custom";
import { loadFixture, maxDiff, sameQasm, type CVec } from "./fixtures";

// References: Qiskit's statevector of QC-1's own QASM 3 export.
for (const group of ["gates", "random-tapes"]) {
  const fx = loadFixture<CVec>(group);
  describe(`${group} (vs ${fx.meta.reference}, qiskit ${fx.meta.versions.qiskit})`, () => {
    test.each(fx.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
      setCustomGates((c as { gates?: CustomGate[] }).gates ?? []);
      // The export must still be the program Qiskit validated…
      expect(sameQasm(exportQasm3(c.n, c.tape))).toBe(sameQasm(c.qasm));
      // …and the simulator must still produce Qiskit's state.
      expect(maxDiff(new Register(c.n, c.tape).state, c.expected)).toBeLessThan(fx.meta.tol.abs);
    });
  });
}
