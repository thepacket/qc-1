import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { importQasm } from "../src/qasm/import";
import { Register } from "../src/calc/register";
import { StabilizerRegister } from "../src/stab/register";
import { branchTree } from "../src/calc/branches";
import { setCustomGates } from "../src/calc/custom";

// The examples' comments make physics claims; these check them (Qiskit
// agreement is checked separately, in test/validated/examples.test.ts).

const source = (file: string) => readFileSync(`examples/${file}`, "utf8");

/** Probabilities, marginals and Bloch vectors of a program's state (measurements sampled afresh). */
function state(src: string, scope: Record<string, number> = {}) {
  const { n, tape, gates } = importQasm(src);
  setCustomGates(gates);
  const st = new Register(n, tape, scope).state;
  const dim = 1 << n;
  const amp = (i: number) => [st[2 * i], st[2 * i + 1]];
  const p = (i: number) => st[2 * i] ** 2 + st[2 * i + 1] ** 2;
  const marginal = (qs: number[], bits: string) => {
    let s = 0;
    for (let i = 0; i < dim; i++) if (qs.every((q, k) => ((i >> q) & 1) === +bits[k])) s += p(i);
    return s;
  };
  const bloch = (q: number) => {
    const m = 1 << q;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < dim; i++) {
      if (i & m) continue;
      const [a0r, a0i] = amp(i), [a1r, a1i] = amp(i | m);
      x += 2 * (a1r * a0r + a1i * a0i);
      y += 2 * (a1i * a0r - a1r * a0i);
      z += a0r ** 2 + a0i ** 2 - a1r ** 2 - a1i ** 2;
    }
    return [x, y, z];
  };
  return { n, amp, p, marginal, bloch, idx: (bits: string) => parseInt(bits, 2) };
}
const run = (file: string, scope: Record<string, number> = {}) => state(source(file), scope);

const close = (a: number, b: number, digits = 10) => expect(a).toBeCloseTo(b, digits);
const THETAS = [0.3, 1.2, 2.5, 4.4];

describe("intro", () => {
  test("interference: q0 back to 0, q1 ends at 1", () => close(run("interference.qasm").p(0b10), 1)); // |q1 q0⟩ = |10⟩

  test("Mach–Zehnder: P(0) = cos²(θ/2)", () => {
    for (const theta of THETAS) close(run("mach_zehnder.qasm", { theta }).marginal([0], "0"), Math.cos(theta / 2) ** 2);
  });

  test("measurement collapse: afterwards the pair is |00⟩ or |11⟩", () => {
    for (let k = 0; k < 6; k++) {
      const r = run("measurement_collapse.qasm");
      expect([r.p(0), r.p(3)].map((x) => Math.round(x * 1e9) / 1e9).sort()).toEqual([0, 1]);
    }
  });

  test("quantum eraser: marked → no fringe; erased and corrected → cos²(θ/2), whatever the outcome", () => {
    for (const theta of THETAS) for (let k = 0; k < 4; k++) {
      const r = run("quantum_eraser.qasm", { theta });
      close(r.marginal([0], "0"), 0.5);
      close(r.marginal([2], "0"), Math.cos(theta / 2) ** 2);
    }
  });
});

describe("protocols and error correction", () => {
  test("Zeno: the all-zeros record has probability cos¹²(t/12); the free qubit reaches sin²(t/2)", () => {
    for (const t of [1, Math.PI]) {
      const { n, tape } = importQasm(source("quantum_zeno.qasm"));
      const zeros = branchTree(n, tape, { t }, 10).leaves.find((l) => l.path === "000000")!;
      close(zeros.p, Math.cos(t / 12) ** 12);
      close(run("quantum_zeno.qasm", { t }).marginal([0], "1"), Math.sin(t / 2) ** 2);
    }
    expect(Math.cos(Math.PI / 12) ** 12).toBeCloseTo(0.66, 2);
  });

  test("deferred measurement: q2 and q5 end in the same state", () => {
    for (const theta of THETAS) {
      const r = run("deferred_measurement.qasm", { theta });
      r.bloch(2).forEach((x, i) => close(x, r.bloch(5)[i]));
      close(Math.hypot(...r.bloch(2)), 1);
    }
  });

  test("bit-flip code: the data end exactly as encoded, wherever the error is", () => {
    const src = source("bitflip_correct.qasm");
    // syndrome bits as Qiskit writes them (q5 q4 q3) for an error on q0, q1, q2; the data (q2 q1 q0) on the right
    for (const [q, syn] of [[0, "001"], [1, "111"], [2, "010"]] as const) {
      for (const theta of THETAS) {
        const r = state(src.replace("x q[1];", `x q[${q}];`), { theta });
        const [c, s] = [Math.cos(theta / 2), Math.sin(theta / 2)];
        close(r.amp(r.idx(syn + "000"))[0], c);
        close(r.amp(r.idx(syn + "111"))[0], s);
      }
    }
  });
});

describe("decompositions: each ends back in |00⟩ exactly", () => {
  test.each(["decomp_cz.qasm", "decomp_swap.qasm", "decomp_iswap.qasm"])("%s", (f) => close(run(f).p(0), 1));

  test("controlled-U (ABC), for any θ", () => {
    for (const theta of THETAS) close(run("decomp_controlled_u.qasm", { theta }).p(0), 1);
  });

  test("√T: the Clifford+T sequence tracks RZ(π/8) on |+⟩ to within 0.07, with 13 T gates", () => {
    const r = run("decomp_sqrt_t.qasm");
    const d = Math.hypot(...r.bloch(0).map((x, i) => x - r.bloch(1)[i]));
    expect(d).toBeLessThan(0.07);
    expect(d).toBeGreaterThan(0.01); // an approximation, not exact
    expect(source("decomp_sqrt_t.qasm").match(/^t q\[0\];/gm)).toHaveLength(13);
  });
});

describe("algorithms", () => {
  test("HHL: the q0 = 1 branch holds x ∝ (3, 1), with probability 5/8", () => {
    const r = run("hhl_2x2.qasm");
    const a = r.amp(r.idx("0001")), b = r.amp(r.idx("1001")); // |q3 q2 q1 q0⟩: q0 = 1, and q0 = q3 = 1
    close(Math.hypot(...a) / Math.hypot(...b), 3);
    close(a[0] * b[1] - a[1] * b[0], 0); // same phase
    close(r.marginal([0], "1"), 5 / 8);
  });

  test("Fourier addition: b = 10 + 01 = 11 exactly, a unchanged (bug #60)", () => {
    close(run("quantum_fourier_addition_4q.qasm").p(0b1101), 1); // |b1 b0 a1 a0⟩ = |11 01⟩
  });

  test("Draper adder: 2 + 1 = 3", () => close(run("draper_adder.qasm").p(0b11), 1));

  test("quantum counting: the clock reads 010 or 110 (q2 q1 q0), half each", () => {
    const r = run("quantum_counting.qasm");
    close(r.marginal([0, 1, 2], "010"), 0.5); // k = 2: q1 = 1
    close(r.marginal([0, 1, 2], "011"), 0.5); // k = 6: q1 = q2 = 1 (bits listed for q0, q1, q2)
  });
});

describe("noise examples (ideal behaviour)", () => {
  test("Hahn echo: Ramsey drifts as cos²(2θ); the echo ends at |0⟩ for every θ", () => {
    for (const theta of THETAS) {
      const r = run("hahn_echo.qasm", { theta });
      close(r.marginal([0], "0"), Math.cos(2 * theta) ** 2);
      close(r.marginal([1], "0"), 1);
    }
  });

  test("mirror circuit: back to |000⟩", () => close(run("mirror_circuit.qasm").p(0), 1));
});

describe("stabilizer mode (above 20 qubits)", () => {
  const tab = (file: string) => {
    const { n, tape } = importQasm(source(file));
    const reg = new StabilizerRegister(n, tape);
    const ev = (ops: Record<number, "X" | "Y" | "Z">) => reg.tab.pauliExpectation(Array.from({ length: n }, (_, q) => ops[q] ?? "I"));
    return { n, reg, ev };
  };

  test("GHZ 100: X on all is +1, Z Z on every neighbouring pair is +1, a lone Z is 0", () => {
    const { n, ev } = tab("ghz_100q.qasm");
    expect(n).toBe(100);
    expect(ev(Object.fromEntries(Array.from({ length: 100 }, (_, q) => [q, "X"])))).toBe(1);
    for (let q = 0; q < 99; q++) expect(ev({ [q]: "Z", [q + 1]: "Z" })).toBe(1);
    expect(ev({ 50: "Z" })).toBe(0);
  });

  test("cluster 64: Z X Z on every qubit (X Z, Z X at the ends)", () => {
    const { ev } = tab("cluster_64q.qasm");
    expect(ev({ 0: "X", 1: "Z" })).toBe(1);
    expect(ev({ 62: "Z", 63: "X" })).toBe(1);
    for (let q = 1; q < 63; q++) expect(ev({ [q - 1]: "Z", [q]: "X", [q + 1]: "Z" })).toBe(1);
  });

  test("repetition code: only c[36] and c[37] fire, and the logical |+⟩ survives", () => {
    const { reg, ev } = tab("repetition_code_49q.qasm");
    const fired = [...reg.cbits].flatMap((b, q) => (b ? [q] : []));
    expect(fired).toEqual([36, 37]);
    expect(ev(Object.fromEntries(Array.from({ length: 25 }, (_, q) => [q, "X"])))).toBe(1);
  });
});
