/**
 * LAB "Error correction": the QEC playground and a threshold sweep, on the
 * codes and union-find decoder of src/noise/qec.ts. Code capacity: errors on
 * the data qubits only, perfect syndromes. The playground can also put the
 * syndrome-extraction circuit on the tape; its proposal is verified by
 * simulating that circuit (a stabilizer tableau) and comparing the flipped
 * ancillas with the lit checks.
 */
import type { AnalysisContext, AnalysisResult, Chart, Opts } from "./types";
import { ANALYSIS_BY_ID, inputValue } from "./catalog";
import { decodeAll, extractionTape, flipsOf, logicalErrorRate, parseErrors, repetitionCode, surfaceCode, type Code } from "../noise/qec";
import { StabilizerRegister, STAB_MAX } from "../stab/register";
import { mulberry32 } from "../sim/measure";

type Run = (ctx: AnalysisContext, opts: Opts) => AnalysisResult;
const num = (id: string, key: string, opts: Opts, n: number) => inputValue(ANALYSIS_BY_ID[id].inputs.find((s) => s.key === key)!, opts, n);
const odd = (d: number) => (d % 2 ? d : d + 1);
const codeOf = (kind: number, d: number): Code => (kind === 1 ? repetitionCode(odd(d)) : surfaceCode(odd(d)));
const pauli = (x: number, z: number) => (x && z ? "Y" : x ? "X" : z ? "Z" : undefined);

export const QEC_RUNS: Record<string, Run> = {
  qecplay(ctx, opts) {
    const code = codeOf(num("qecplay", "code", opts, ctx.n), num("qecplay", "d", opts, ctx.n));
    const text = typeof opts.errors === "string" ? opts.errors.trim() : "";
    let ex: Uint8Array, ez: Uint8Array;
    if (text) ({ ex, ez } = parseErrors(code, text));
    else {
      // Random errors: each data qubit gets X, Y or Z with probability p (only X on the repetition code).
      const p = num("qecplay", "p", opts, ctx.n) / 100, rng = mulberry32(1000 + num("qecplay", "seed", opts, ctx.n));
      ex = new Uint8Array(code.n); ez = new Uint8Array(code.n);
      const rep = code.checks.every((c) => c.type === "Z");
      for (let q = 0; q < code.n; q++) {
        if (rng() >= p) continue;
        const w = rep ? 0 : Math.floor(rng() * 3);
        if (w !== 2) ex[q] = 1;
        if (w !== 0) ez[q] = 1;
      }
    }
    const r = decodeAll(code, ex, ez);
    const lattice: Chart = {
      kind: "lattice", title: code.name, rows: code.rows, cols: code.cols,
      qubits: code.coords.map(([row, c], q) => ({ r: row, c, label: String(q), error: pauli(ex[q], ez[q]), fix: pauli(r.cx[q], r.cz[q]) })),
      checks: code.checks.map((ch, k) => ({ type: ch.type, qubits: ch.qubits, lit: r.syndrome[k] === 1 })),
    };
    const weight = (a: Uint8Array, b: Uint8Array) => a.reduce((s, x, q) => s + (x | b[q]), 0);
    const logical = [r.logicalX && "X̄", r.logicalZ && "Z̄"].filter(Boolean).join(" and ") || "none";
    const errs = [...Array(code.n).keys()].filter((q) => ex[q] || ez[q]).map((q) => `${pauli(ex[q], ez[q])}${q}`).join(" ");
    const res: AnalysisResult = {
      charts: [lattice],
      scalars: [
        { label: "errors", value: errs || "none" },
        { label: "lit checks", value: r.syndrome.reduce((s, b) => s + b, 0) },
        { label: "correction weight", value: weight(r.cx, r.cz) },
        { label: "logical error", value: logical },
      ],
      notes: [
        `${code.n} data qubits, ${code.checks.length} checks. The decoder corrects any ${(code.d - 1) / 2} errors; beyond that it can fail.${code.checks.every((c) => c.type === "Z") ? " The repetition code checks Z Z only: it corrects bit flips, not phase flips." : ""}`,
        "Qubits are numbered row by row. Type errors like X4 Z7 Y12, or leave the field empty for random errors at the rate and seed below.",
      ],
    };
    // The circuit: two rounds of syndrome extraction around the errors, checked by simulating it.
    const n = code.n + code.checks.length;
    if (n <= STAB_MAX) {
      const tape = extractionTape(code, ex, ez);
      const flips = flipsOf(code, new StabilizerRegister(n, tape).tape);
      const ok = flips.every((b, k) => b === r.syndrome[k]);
      res.proposal = {
        label: `APPLY · the extraction circuit (n = ${n})`, n, tape, verified: ok,
        check: ok ? "simulated: the ancillas that flip between the two rounds are exactly the lit checks" : "the simulated syndrome differs: not offered",
      };
    }
    return res;
  },

  qecthreshold(ctx, opts) {
    const kind = num("qecthreshold", "code", opts, ctx.n);
    const noise = num("qecthreshold", "noise", opts, ctx.n) === 1 ? "depolarizing" : "bitflip";
    const shots = num("qecthreshold", "shots", opts, ctx.n);
    const ps = [0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2];
    const ds = [3, 5, 7];
    const series = ds.map((d) => ({ name: `d = ${d}`, y: ps.map((p, i) => logicalErrorRate(codeOf(kind, d), p, noise, shots, 100 * d + i)) }));
    // Where d = 3 and d = 7 cross (linear interpolation between grid points).
    let cross: number | null = null;
    for (let i = 1; i < ps.length && cross === null; i++) {
      const a = series[2].y[i - 1] - series[0].y[i - 1], b = series[2].y[i] - series[0].y[i];
      if (a < 0 && b >= 0) cross = ps[i - 1] + ((ps[i] - ps[i - 1]) * -a) / (b - a);
    }
    const rep = kind === 1;
    return {
      charts: [{ kind: "lines", title: `${rep ? "repetition" : "surface"} code, ${noise === "bitflip" ? "bit flips" : "depolarizing"}`, x: ps, xLabel: "physical error rate p", yLabel: "logical error rate", yMin: 0, series }],
      scalars: [{ label: "curves cross near", value: cross === null ? "not in range" : `p ≈ ${cross.toFixed(3)}` }],
      notes: [
        `${shots} samples per point; statistical error about √(P(1−P)/${shots}).`,
        rep ? "Code capacity: the repetition code against bit flips reaches p = 1/2." : "Code capacity with union-find decoding: the surface code's threshold is about 10% for bit flips (optimal matching: 10.3%) and about 15% for depolarizing noise, counting a logical X̄ or Z̄ as a failure.",
      ],
    };
  },
};
