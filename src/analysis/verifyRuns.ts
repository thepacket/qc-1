/**
 * LAB "Verification & export": compare the tape with a memory slot, custom
 * sweep plots, and the in-app self-test (the committed Qiskit/numpy
 * fixtures, replayed on this device).
 */
import type { AnalysisContext, AnalysisResult, Chart, Opts } from "./types";
import { ANALYSIS_BY_ID, inputValue, pauliValue } from "./catalog";
import { Register } from "../calc/register";
import { equivalent } from "../calc/equiv";
import { circuitResources } from "../calc/resources";
import { NONUNITARY, applyStep, stepSymbols, type Entry, type Scope } from "../calc/steps";
import { reducedDensityMatrix, purity } from "../sim/density";
import { entropyProfile } from "../sim/entanglement";
import { magic } from "../sim/magic";
import { allPauliExpectations } from "../sim/pauliSpectrum";
import { parsePauliSum } from "../sim/trotter";
import { pauliSumExpectation } from "../sim/expectation";
import { setCustomGates, type CustomGate } from "../calc/custom";

type Run = (ctx: AnalysisContext, opts: Opts) => AnalysisResult | Promise<AnalysisResult>;
const num = (id: string, key: string, opts: Opts, n: number) => inputValue(ANALYSIS_BY_ID[id].inputs.find((s) => s.key === key)!, opts, n);
type Slot = { n: number; tape: Entry[]; scope: Scope };

/** The full unitary's columns (n ≤ 10), with IF bits starting at 0. */
function columns(n: number, tape: Entry[], scope: Scope): Float64Array[] {
  const d = 1 << n;
  return Array.from({ length: d }, (_, j) => {
    const v = new Float64Array(2 * d);
    v[2 * j] = 1;
    const cb = new Uint8Array(n);
    for (const s of tape.flat()) applyStep(v, n, s, Math.random, scope, cb);
    return v;
  });
}

export const VERIFY_RUNS: Record<string, Run> = {
  compare(ctx, opts) {
    const other = opts.other as Slot | undefined;
    const slot = num("compare", "slot", opts, ctx.n);
    if (!other) return { scalars: [{ label: `M${slot}`, value: "empty" }], notes: [`Store a tape first: entry ${slot}, then 2ND = (STO).`] };
    if (other.n !== ctx.n) throw new Error(`M${slot} has ${other.n} qubits, the register ${ctx.n}`);
    const scalars: AnalysisResult["scalars"] = [];
    const unitary = [ctx.tape, other.tape].every((t) => t.every((e) => e.every((s) => !NONUNITARY.has(s.gateId) && !s.condition)));
    if (unitary && ctx.n <= 10) {
      const eq = equivalent(ctx.n, ctx.tape, other.tape, { scope: ctx.scope });
      const d = 1 << ctx.n, A = columns(ctx.n, ctx.tape, ctx.scope), B = columns(ctx.n, other.tape, { ...other.scope, ...ctx.scope });
      // Tr(A†B) = Σ_j ⟨A e_j | B e_j⟩
      let re = 0, im = 0;
      for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) {
        const [ar, ai, br, bi] = [A[j][2 * i], A[j][2 * i + 1], B[j][2 * i], B[j][2 * i + 1]];
        re += ar * br + ai * bi;
        im += ar * bi - ai * br;
      }
      const Fp = (re * re + im * im) / (d * d);
      scalars.push(
        { label: "same operator (up to phase)", value: eq.equal ? "yes" : "no" },
        { label: "process fidelity |Tr(U†V)|²/d²", value: Fp },
        { label: "average gate fidelity", value: (d * Fp + 1) / (d + 1) },
      );
    }
    const a = new Register(ctx.n, ctx.tape, ctx.scope).state, b = new Register(other.n, other.tape, { ...other.scope, ...ctx.scope }).state;
    let re = 0, im = 0;
    for (let i = 0; i < a.length / 2; i++) { re += a[2 * i] * b[2 * i] + a[2 * i + 1] * b[2 * i + 1]; im += a[2 * i] * b[2 * i + 1] - a[2 * i + 1] * b[2 * i]; }
    scalars.push({ label: "state fidelity |⟨ψ|φ⟩|²", value: re * re + im * im });
    const ra = circuitResources(ctx.n, ctx.tape, ctx.scope), rb = circuitResources(other.n, other.tape, other.scope);
    const rows = (["gates", "depth", "twoQubit", "cxCount", "tCount"] as const).map((k) => [k, ra[k], rb[k]]);
    return {
      scalars,
      charts: [{ kind: "table", headers: ["", "tape", `M${slot}`], rows }],
      notes: ["Fidelities at the current symbol values; measurements take their recorded outcomes."],
    };
  },

  plot(ctx, opts) {
    const qty = num("plot", "quantity", opts, ctx.n);
    const sweep = num("plot", "sweep", opts, ctx.n);
    const n = ctx.n;
    // The quantity of one state: a vector over qubits, or a scalar.
    const perQubit = qty <= 4;
    const evaluate = (psi: Float64Array): number[] => {
      switch (qty) {
        case 0: case 1: case 2: {
          const P = "ZXY"[qty];
          return [...Array(n).keys()].map((q) => pauliSumExpectation(psi, n, [{ coefficient: 1, paulis: Array.from({ length: n }, (_, k) => (k === q ? P : "I")).join("") }]));
        }
        case 3: return [...Array(n).keys()].map((q) => { const p = purity(reducedDensityMatrix(psi, n, [q])); return p; });
        case 4: return [...Array(n).keys()].map((q) => {
          const r = reducedDensityMatrix(psi, n, [q]);
          const tr = r[0][0].re + r[1][1].re, det = r[0][0].re * r[1][1].re - (r[0][1].re ** 2 + r[0][1].im ** 2);
          const l = Math.sqrt(Math.max(0, tr * tr / 4 - det)), ev = [tr / 2 + l, tr / 2 - l].filter((x) => x > 1e-15);
          return -ev.reduce((a, x) => a + x * Math.log2(x), 0);
        });
        case 5: return [n >= 2 ? entropyProfile(psi, n)!.entropy[Math.floor(n / 2) - 1] : 0];
        case 6: return [2 * (1 - [...Array(n).keys()].reduce((a, q) => a + purity(reducedDensityMatrix(psi, n, [q])), 0) / n)];
        case 7: {
          if (n > 10) throw new Error("magic needs n ≤ 10");
          return [magic(allPauliExpectations(psi, n), n).m2];
        }
        default: {
          const terms = parsePauliSum(pauliValue(opts, "obs", n));
          if (terms[0].paulis.length !== n) throw new Error(`Pauli strings need ${n} letters`);
          return [pauliSumExpectation(psi, n, terms)];
        }
      }
    };
    const names = ["⟨Z⟩", "⟨X⟩", "⟨Y⟩", "purity of qᵢ", "S(qᵢ) bits", "mid-cut entropy", "Meyer–Wallach Q", "magic M₂", "⟨H⟩"];
    let xs: number[], xLabel: string, states: Float64Array[];
    if (sweep === 0) {
      const k = Math.min(ctx.tape.length, 96);
      xs = Array.from({ length: k + 1 }, (_, i) => i);
      xLabel = "after step";
      states = xs.map((i) => new Register(n, ctx.tape.slice(0, i), ctx.scope).state);
    } else {
      const syms = [...new Set(ctx.tape.flat().flatMap(stepSymbols))];
      const name = sweep === 1 ? "t" : syms.find((s) => s !== "t");
      if (!name || !syms.includes(name)) throw new Error(sweep === 1 ? "the tape has no t" : "the tape has no other symbol");
      const [lo, hi] = sweep === 1 ? [0, 2 * Math.PI] : [-Math.PI, Math.PI];
      xs = Array.from({ length: 49 }, (_, i) => lo + ((hi - lo) * i) / 48);
      xLabel = `${name}`;
      states = xs.map((v) => new Register(n, ctx.tape, { ...ctx.scope, [name]: v }).state);
    }
    const values = states.map(evaluate);
    const chart: Chart = perQubit && n > 3
      ? { kind: "heatmap", scale: qty <= 2 ? "div" : "seq", min: qty <= 2 ? -1 : 0, max: 1, rows: [...Array(n).keys()].map((q) => `q${q}`), cols: xs.map((x, i) => (i % Math.ceil(xs.length / 8) === 0 ? (sweep === 0 ? String(x) : x.toFixed(2)) : "")), values: [...Array(n).keys()].map((q) => values.map((v) => v[q])), title: `${names[qty]}: rows qubits` }
      : { kind: "lines", x: xs, xLabel, yLabel: names[qty], series: values[0].map((_, q) => ({ name: perQubit ? `q${q}` : names[qty], y: values.map((v) => v[q]) })) };
    return { charts: [chart], notes: ["Each point is an exact statevector (the tape truncated, or a symbol swept); measurements keep their recorded outcomes."] };
  },

  async selftest() {
    const t0 = performance.now();
    const rows: (string | number)[][] = [];
    const report = (name: string, total: number, bad: number, worst: number) => rows.push([name, `${total - bad}/${total}`, worst]);
    const maxDiff = (a: Float64Array, re: number[], im: number[]) => re.reduce((m, r, i) => Math.max(m, Math.hypot(a[2 * i] - r, a[2 * i + 1] - im[i])), 0);
    type Sv = { n: number; tape: Entry[]; gates?: CustomGate[]; expected: { re: number[]; im: number[] } };
    for (const [name, load] of [
      ["gates vs Qiskit", () => import("../../test/fixtures/gates.json")],
      ["random tapes vs Qiskit", () => import("../../test/fixtures/random-tapes.json")],
    ] as const) {
      const fx = (await load()).default as unknown as { cases: Sv[] };
      let bad = 0, worst = 0;
      for (const c of fx.cases) {
        setCustomGates(c.gates ?? []);
        const e = maxDiff(new Register(c.n, c.tape).state, c.expected.re, c.expected.im);
        worst = Math.max(worst, e);
        if (e > 1e-9) bad++;
      }
      report(name, fx.cases.length, bad, worst);
    }
    {
      const fx = (await import("../../test/fixtures/symbolic.json")).default as unknown as { cases: (Sv & { expected: { re: number[]; im: number[] }[] })[] };
      const { POINTS } = await import("../../validation/cases/groups/symbolic");
      let bad = 0, worst = 0;
      for (const c of fx.cases) {
        setCustomGates(c.gates ?? []);
        POINTS.forEach((p, k) => {
          const e = maxDiff(new Register(c.n, c.tape, p).state, c.expected[k].re, c.expected[k].im);
          worst = Math.max(worst, e);
          if (e > 1e-9) bad++;
        });
      }
      report("symbols vs Qiskit (5 points)", fx.cases.length * POINTS.length, bad, worst);
    }
    {
      const fx = (await import("../../test/fixtures/classical.json")).default as unknown as { cases: { n: number; tape: Entry[]; cbits: number[] }[] };
      let bad = 0;
      for (const c of fx.cases) if (Array.from(new Register(c.n, c.tape).cbits).join() !== c.cbits.join()) bad++;
      report("mid-circuit measurement & IF", fx.cases.length, bad, 0);
    }
    {
      const fx = (await import("../../test/fixtures/noise.json")).default as unknown as { cases: { kind: string; n: number; tape: Entry[]; model: string; rho?: { re: number[]; im: number[] } }[] };
      const { models } = await import("../../validation/cases/groups/noise");
      const { noisyDensity } = await import("../noise/sim");
      let bad = 0, worst = 0, total = 0;
      for (const c of fx.cases) {
        if (c.kind !== "unitary" || !c.rho) continue;
        total++;
        const { rho } = noisyDensity(c.n, c.tape, {}, models(c.n)[c.model]);
        const e = c.rho.re.reduce((m, r, i) => Math.max(m, Math.abs(rho[2 * i] - r), Math.abs(rho[2 * i + 1] - c.rho!.im[i])), 0);
        worst = Math.max(worst, e);
        if (e > 1e-10) bad++;
      }
      report("noise vs Aer channels", total, bad, worst);
    }
    {
      const fx = (await import("../../test/fixtures/stabilizer.json")).default as unknown as { cases: { n: number; tape: Entry[]; generators: string[] }[] };
      const { StabilizerRegister } = await import("../stab/register");
      let bad = 0;
      for (const c of fx.cases) if (new StabilizerRegister(c.n, c.tape).tab.stabilizers().join() !== c.generators.join()) bad++;
      report("stabilizer mode vs Qiskit", fx.cases.length, bad, 0);
    }
    setCustomGates([]);
    const failed = rows.some((r) => { const [ok, total] = String(r[1]).split("/"); return ok !== total; });
    return {
      scalars: [{ label: "result", value: failed ? "FAILURES" : "all passed" }, { label: "time", value: `${Math.round(performance.now() - t0)} ms` }],
      charts: [{ kind: "table", title: "committed references, replayed here", headers: ["check", "passed", "worst |Δ|"], rows }],
      notes: ["The references were computed with Qiskit 2.5 / Aer 0.17 / numpy (validation/). This replays them with this device's engine."],
    };
  },
};
