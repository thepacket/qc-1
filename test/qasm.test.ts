import { describe, test, expect } from "vitest";
import { Calculator } from "../src/calc/calculator";
import { calc } from "./ed";
import { exportQasm3 } from "../src/qasm/fromTape";

const qasm = (edit: (c: Calculator) => void) => {
  const c = calc();
  edit(c);
  return exportQasm3(c.n, c.tape);
};
const h0 = (c: Calculator) => c.addGate("h", { targets: [0] });
const body = (q: string) => q.split("\n").filter((l) => l && !l.startsWith("//") && !l.startsWith("OPENQASM") && !l.startsWith("include"));

describe("QASM 3 export", () => {
  test("header and register", () => {
    const q = qasm(h0);
    expect(q).toMatch(/^\/\/ Quantum Calculator One \(QC-1\) circuit, 1 step\nOPENQASM 3\.0;\ninclude "stdgates\.inc";/);
    expect(body(q)).toEqual(["qubit[2] q;", "h q[0];"]);
  });

  test("controls use stdgates names where they exist, ctrl @ otherwise", () => {
    const q = qasm((c) => {
      c.addGate("x", { targets: [1], controls: [0] }); // cx
      c.addGate("s", { targets: [1], controls: [0] }); // ctrl @ s
      c.addGate("x", { targets: [1], controls: [0], controlStates: [false] }); // negctrl @ x
    });
    expect(body(q).slice(1)).toEqual(["cx q[0], q[1];", "ctrl @ s q[0], q[1];", "negctrl @ x q[0], q[1];"]);
  });

  test("angles stay symbolic; functions fold to numbers", () => {
    const q = qasm((c) => {
      c.addGate("rz", { targets: [0], params: ["3*π/4"] });
      c.addGate("rx", { targets: [0], params: ["1/sqrt(2)"] });
    });
    expect(body(q).slice(1)).toEqual(["rz(3*pi/4) q[0];", `rx(${1 / Math.SQRT2}) q[0];`]);
  });

  test("non-stdgates get exact definitions, only when used", () => {
    expect(qasm(h0)).not.toContain("gate ");
    const q = qasm((c) => {
      c.addGate("sy", { targets: [0] });
      c.addGate("rzz", { targets: [0, 1] });
    });
    expect(q).toContain("gate sy a { gphase(pi/4); ry(pi/2) a; }");
    expect(q).toContain("gate rzz(p0) a, b");
    expect(q).not.toContain("gate iswap");
    expect(body(q)).toContain("rzz(pi/2) q[0], q[1];");
  });

  test("measurements get one clbit each and note the observed outcome", () => {
    const q = qasm((c) => {
      h0(c);
      c.addGate("measure", { targets: [0] });
      c.addGate("measure_x", { targets: [1] });
      c.addGate("reset", { targets: [1] });
    });
    const b = body(q);
    expect(b).toContain("bit[2] c;");
    expect(b).toContain("c[0] = measure q[0];");
    expect(b).toContain("h q[1];"); // MX rotates into the Z basis
    expect(b).toContain("reset q[1];");
    expect(q).toMatch(/\/\/ note: QC-1 measured [01]/);
  });

  test("ALL expands to one line per qubit", () => {
    const q = qasm((c) => {
      c.setQubitCount(3);
      c.addBroadcast("h");
    });
    expect(body(q)).toEqual(["qubit[3] q;", "h q[0];", "h q[1];", "h q[2];"]);
  });
});
