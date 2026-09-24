import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { Calculator } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";
import { importQasm } from "../src/qasm/import";
import { stepCaptions } from "../src/qasm/captions";
import { describeProgram } from "../src/examples";

const example = (f: string) => readFileSync(`examples/${f}`, "utf8");

describe("step-through captions", () => {
  test("each entry gets its line's comment, else the block above it; declarations and the header don't count", () => {
    const src = `// Header: what the program does.
OPENQASM 3.0;
include "stdgates.inc";
// about the register
qubit[2] q;
bit[2] c;
h q[0];
// Entangle.
// (two lines)
cx q[0], q[1];
x q[1]; // flip
z q[1];

// Measure.
c[0] = measure q[0];
`;
    const { lines } = importQasm(src);
    expect(stepCaptions(src, lines)).toEqual(["", "Entangle. (two lines)", "flip", "Entangle. (two lines)", "Measure."]);
  });

  test("a real example: Grover-style amplitude amplification", () => {
    const src = example("amplitude_amplification_3q.qasm");
    const r = importQasm(src);
    const caps = stepCaptions(src, r.lines);
    expect(caps).toHaveLength(r.tape.length);
    expect(caps[0]).toBe(""); // the first Hadamards come before any comment
    expect(caps[3]).toBe("Oracle: phase-flip on |001⟩ and |110⟩. |001⟩ — q[0]=0, q[1]=0, q[2]=1");
    expect(caps[caps.length - 1]).toBe("");
  });

  test("every example gets one caption per entry, and most steps have one", () => {
    let steps = 0, captioned = 0;
    for (const f of readdirSync("examples").filter((f) => f.endsWith(".qasm"))) {
      const src = example(f);
      const r = importQasm(src);
      const caps = stepCaptions(src, r.lines);
      expect(caps).toHaveLength(r.tape.length);
      steps += caps.length;
      captioned += caps.filter(Boolean).length;
    }
    expect(captioned / steps).toBeGreaterThan(0.5);
  });
});

describe("step-through guide", () => {
  test("loads scrubbed to the start; hides after an edit, returns on UNDO; ✕ ends it", () => {
    const c = new Calculator(new InlineEngine());
    const src = example("bell.qasm");
    c.loadQasm(src, "bell", {}, { title: "Bell state", intro: "intro" });
    expect(c.scrub).toBe(0);
    expect(c.activeGuide?.title).toBe("Bell state");
    c.setScrub(1);
    c.addGate("x", { targets: [0] }); // inserts at the scrub point: not the loaded tape any more
    expect(c.activeGuide).toBeNull();
    c.undo();
    expect(c.activeGuide).not.toBeNull();
    c.endGuide();
    expect(c.activeGuide).toBeNull();
    expect(c.scrub).toBeNull();
  });

  test("a plain load (no guide) clears an earlier guide", () => {
    const c = new Calculator(new InlineEngine());
    c.loadQasm(example("bell.qasm"), "bell", {}, { title: "Bell", intro: "" });
    c.loadQasm(example("bell.qasm"), "bell");
    expect(c.activeGuide).toBeNull();
  });
});

describe("example descriptions", () => {
  test("hard-wrapped comment lines join into paragraphs; lists and indented lines stay", () => {
    const src = `// First line of a paragraph
// that continues here.
//
//   q[0]: indented stays
//   q[1]: on its own line
// 1. a list item
// 2. another

OPENQASM 3.0;`;
    expect(describeProgram(src)).toBe("First line of a paragraph that continues here.\n\n  q[0]: indented stays\n  q[1]: on its own line\n1. a list item\n2. another");
  });
});
