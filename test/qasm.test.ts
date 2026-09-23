import { describe, test, expect } from "vitest";
import { Calculator, type KeyId } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { exportQasm3 } from "../src/qasm/fromTape";

const qasm = (...ks: KeyId[]) => {
  const c = new Calculator(new InlineEngine());
  ks.forEach((k) => c.press(k));
  return exportQasm3(c.n, c.tape);
};
const body = (q: string) => q.split("\n").filter((l) => l && !l.startsWith("//") && !l.startsWith("OPENQASM") && !l.startsWith("include"));

describe("QASM 3 export", () => {
  test("header and register", () => {
    const q = qasm("h");
    expect(q).toMatch(/^\/\/ Quantum Calculator One \(QC-1\) circuit, 1 step\nOPENQASM 3\.0;\ninclude "stdgates\.inc";/);
    expect(body(q)).toEqual(["qubit[2] q;", "h q[0];"]);
  });

  test("controls use stdgates names where they exist, ctrl @ otherwise", () => {
    const q = qasm(
      "ctrl", "right", "x", //            cx
      "left", "ctrl", "right", "s", //    ctrl @ s
      "left", "2nd", "ctrl", "right", "x", // negctrl @ x
    );
    expect(body(q).slice(1)).toEqual(["cx q[0], q[1];", "ctrl @ s q[0], q[1];", "negctrl @ x q[0], q[1];"]);
  });

  test("angles stay symbolic; functions fold to numbers", () => {
    const q = qasm("3", "pi", "div", "4", "rz", "1", "div", "2nd", "pi", "2", "rx");
    expect(body(q).slice(1)).toEqual(["rz(3*pi/4) q[0];", `rx(${1 / Math.SQRT2}) q[0];`]);
  });

  test("non-stdgates get exact definitions, only when used", () => {
    expect(qasm("h")).not.toContain("gate ");
    const q = qasm("2nd", "h", "ctrl", "right", "2nd", "rz");
    expect(q).toContain("gate sy a { gphase(pi/4); ry(pi/2) a; }");
    expect(q).toContain("gate rzz(p0) a, b");
    expect(q).not.toContain("gate iswap");
    expect(body(q)).toContain("rzz(pi/2) q[0], q[1];");
  });

  test("measurements get one clbit each and note the observed outcome", () => {
    const q = qasm("h", "meas", "right", "2nd", "x", "2nd", "meas");
    const b = body(q);
    expect(b).toContain("bit[2] c;");
    expect(b).toContain("c[0] = measure q[0];");
    expect(b).toContain("h q[1];"); // MX rotates into the Z basis
    expect(b).toContain("reset q[1];");
    expect(q).toMatch(/\/\/ note: QC-1 measured [01]/);
  });

  test("ALL expands to one line per qubit", () => {
    const q = qasm("3", "2nd", "q", "all", "h");
    expect(body(q)).toEqual(["qubit[3] q;", "h q[0];", "h q[1];", "h q[2];"]);
  });
});
