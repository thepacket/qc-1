import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { importQasm } from "../src/qasm/import";
import { Register } from "../src/calc/register";

/** The example's state at t (measurements sampled afresh). */
function run(file: string, t: number) {
  const { n, tape } = importQasm(readFileSync(`examples/${file}`, "utf8"));
  const st = new Register(n, tape, { t }).state;
  const dim = 1 << n;
  const p = (i: number) => st[2 * i] ** 2 + st[2 * i + 1] ** 2;
  /** Probability that the listed qubits read `bits` (qubit q is bit q of the index, as in Qiskit). */
  const marginal = (qs: number[], bits: number[]) => {
    let s = 0;
    for (let i = 0; i < dim; i++) if (qs.every((q, k) => ((i >> q) & 1) === bits[k])) s += p(i);
    return s;
  };
  const bloch = (q: number) => {
    const m = 1 << q;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < dim; i++) {
      if (i & m) continue;
      const [a0r, a0i, a1r, a1i] = [st[2 * i], st[2 * i + 1], st[2 * (i | m)], st[2 * (i | m) + 1]];
      // ρ10 = a1 · conj(a0): x = 2 Re ρ10, y = 2 Im ρ10
      x += 2 * (a1r * a0r + a1i * a0i);
      y += 2 * (a1i * a0r - a1r * a0i);
      z += a0r ** 2 + a0i ** 2 - a1r ** 2 - a1i ** 2;
    }
    return [x, y, z];
  };
  return { n, p, marginal, bloch };
}

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);
const closeVec = (a: number[], b: number[]) => a.forEach((x, i) => close(x, b[i]));
const curve = (t: number, k: number) => [Math.sin(t) * Math.cos(k * t), Math.sin(t) * Math.sin(k * t), Math.cos(t)];

describe("animation examples do what their comments say", () => {
  test("entanglement dial: cos(t/2)|00⟩ + sin(t/2)|11⟩; each Bloch vector has length |cos t|", () => {
    const r = run("anim_entanglement_dial.qasm", Math.PI / 2);
    close(r.p(0), 0.5);
    close(r.p(3), 0.5);
    for (const t of [0.3, 1.9, 4]) close(Math.hypot(...run("anim_entanglement_dial.qasm", t).bloch(0)), Math.abs(Math.cos(t)));
  });

  test("GHZ sensing: P(0000) = cos²(2t) on q0..3, P(0) = cos²(t/2) on q4", () => {
    for (const t of [0.4, 1.3, 2.2]) {
      const r = run("anim_ghz_ramsey.qasm", t);
      close(r.marginal([0, 1, 2, 3], [0, 0, 0, 0]), Math.cos(2 * t) ** 2);
      close(r.marginal([4], [0]), Math.cos(t / 2) ** 2);
    }
  });

  test("quantum walk: t = 0 splits to sites 1 and 7; t = π zig-zags to sites 3 and 5", () => {
    const site = (r: ReturnType<typeof run>, s: number) => r.marginal([0, 1, 2], [s & 1, (s >> 1) & 1, (s >> 2) & 1]); // q0 is the least significant bit
    const a = run("anim_quantum_walk.qasm", 0);
    close(site(a, 1), 0.5);
    close(site(a, 7), 0.5);
    const b = run("anim_quantum_walk.qasm", Math.PI);
    close(site(b, 3), 0.5);
    close(site(b, 5), 0.5);
  });

  test("magnon: exactly one spin flipped at every t; at t = π/2 it arrives at q4 intact", () => {
    close(run("anim_magnon.qasm", Math.PI / 2).marginal([4], [1]), 1);
    const r = run("anim_magnon.qasm", 0.9);
    close([0, 1, 2, 3, 4].reduce((s, k) => s + r.p(1 << (4 - k)), 0), 1);
  });

  test("detuned Rabi: at t = π, P(1) = 1, 0.75, 0.25", () => {
    const r = run("anim_detuned_rabi.qasm", Math.PI);
    close(r.marginal([0], [1]), 1);
    close(r.marginal([1], [1]), 0.75);
    close(r.marginal([2], [1]), 0.25);
  });

  test("Bloch Lissajous: polar angle t, azimuth k·t", () => {
    const t = 0.8;
    const r = run("anim_bloch_lissajous.qasm", t);
    [1, 2, 3].forEach((k, q) => closeVec(r.bloch(q), curve(t, k)));
  });

  test("teleportation: q2 ends in q0's moving state, whatever the outcomes", () => {
    for (let k = 0; k < 8; k++) closeVec(run("anim_teleport_moving.qasm", 1.1).bloch(2), curve(1.1, 2));
  });

  test("phase estimation: t = 2πk/8 reads k on q0..q2, exactly", () => {
    for (let k = 0; k < 8; k++) {
      const r = run("anim_phase_estimation.qasm", (2 * Math.PI * k) / 8);
      close(r.marginal([0, 1, 2], [k & 1, (k >> 1) & 1, (k >> 2) & 1]), 1); // q0 is k's least significant bit
    }
  });

  test("every loop closes: the probabilities at t = 2π are those at t = 0", () => {
    for (const f of ["entanglement_dial", "ghz_ramsey", "quantum_walk", "magnon", "detuned_rabi", "bloch_lissajous", "phase_estimation"]) {
      const a = run(`anim_${f}.qasm`, 0), b = run(`anim_${f}.qasm`, 2 * Math.PI);
      for (let i = 0; i < 1 << a.n; i++) close(a.p(i), b.p(i));
    }
  });
});
