/**
 * Circuit tools and structure analyses (LAB "Circuit tools" / "Circuit
 * structure"). Each tool rewrites the tape with a ported upstream pass and
 * checks its own output before offering it: the same operator up to a global
 * phase (src/calc/equiv.ts), or the requested target reached. The passes
 * themselves are validated against Qiskit (test/validated/tools, synth).
 */
import type { AnalysisContext, AnalysisResult, Chart, Opts, Proposal } from "./types";
import { ANALYSIS_BY_ID, inputValue, pauliValue } from "./catalog";
import { toolCircuit, raiseCircuit } from "../calc/toolCircuit";
import { equivalent, FULL_MAX } from "../calc/equiv";
import { circuitResources, type CircuitResources } from "../calc/resources";
import { lowerTape, namedCircuit } from "../calc/lower";
import { Register } from "../calc/register";
import { applyStep, NONUNITARY, stepSymbols, type Entry, type Scope } from "../calc/steps";
import { optimiseCircuit } from "../sim/optimisePasses";
import { transpile, type TranspileTarget } from "../sim/transpile";
import { routeCircuit, countConnectivityViolations } from "../sim/router";
import { compileForDevice } from "../sim/compile";
import { inverseGates } from "../sim/inverse";
import { buildTrotterCircuit, parsePauliSum } from "../sim/trotter";
import { statePrepCircuit, parseTargetState } from "../sim/statePrep";
import { synthesizeUnitary, type Cx } from "../sim/unitarySynth";
import { interactionGraph } from "../sim/interaction";
import { tannerGraph } from "../sim/tanner";
import { StabilizerRegister } from "../stab/register";
import { branchTree } from "../calc/branches";
import { hermitianEig } from "../sim/eig";
import { pauliSparse } from "../sim/pauliMatrix";
import type { Complex } from "../sim/density";

type Run = (ctx: AnalysisContext, opts: Opts) => AnalysisResult;

const num = (id: string, key: string, opts: Opts, n: number) =>
  inputValue(ANALYSIS_BY_ID[id].inputs.find((s) => s.key === key)!, opts, n);

// ─── Coupling maps ─────────────────────────────────────────────────────

export const COUPLING_NAMES = ["line", "ring", "grid"] as const;

/** Adjacency lists: a line, a ring, or a 2-row grid (q = row·cols + col). */
export function coupling(name: string, n: number): number[][] {
  if (name === "ring" && n >= 3) return Array.from({ length: n }, (_, i) => [(i + n - 1) % n, (i + 1) % n]);
  if (name === "grid" && n >= 4) {
    const cols = Math.ceil(n / 2);
    return Array.from({ length: n }, (_, q) => {
      const r = Math.floor(q / cols), c = q % cols;
      return [[r, c - 1], [r, c + 1], [r - 1, c], [r + 1, c]]
        .filter(([rr, cc]) => rr >= 0 && rr < 2 && cc >= 0 && cc < cols)
        .map(([rr, cc]) => rr * cols + cc)
        .filter((j) => j < n);
    });
  }
  return Array.from({ length: n }, (_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < n));
}

// ─── Checks and summaries ──────────────────────────────────────────────

const e2 = (x: number) => x.toExponential(1);

/**
 * Same operator up to a global phase, at the current symbol values — and, when
 * the tape has symbols, at a second, unrelated set of values too (a rewrite
 * must hold for every value, not just the current one).
 */
function sameOperator(ctx: AnalysisContext, a: Entry[], b: Entry[], opts: { perm?: number[]; what?: string } = {}) {
  const syms = [...new Set([...a, ...b].flat().flatMap(stepSymbols))];
  const scopes: Scope[] = [ctx.scope];
  if (syms.length) scopes.push(Object.fromEntries(syms.map((s, i) => [s, 0.731 + 0.419 * i])));
  let worst = 0, ok = true, method = "";
  for (const scope of scopes) {
    const r = equivalent(ctx.n, a, b, { scope, perm: opts.perm });
    worst = Math.max(worst, r.maxErr);
    ok &&= r.equal;
    method = r.method === "unitary" ? "every column" : "3 random states";
  }
  const what = opts.what ?? "same operator up to a global phase";
  return {
    verified: ok,
    check: ok
      ? `${what} (${method}${syms.length ? ", two symbol settings" : ""}, err ${e2(worst)})`
      : `NOT the ${what.replace(/^same /, "same ")} (err ${e2(worst)}) — not offered`,
  };
}

const METRICS: [keyof CircuitResources, string][] = [
  ["gates", "gates"], ["depth", "depth"], ["twoQubit", "2-qubit"], ["multiQubit", "3+ qubit"], ["cxCount", "CX"], ["tCount", "T count"], ["tDepth", "T-depth"],
];

function compareTable(n: number, before: Entry[], after: Entry[], afterN = n): Chart {
  const a = circuitResources(n, before), b = circuitResources(afterN, after);
  return {
    kind: "table", headers: ["", "before", "after"],
    rows: METRICS.filter(([k]) => a[k] || b[k] || k === "gates" || k === "depth").map(([k, label]) => [label, a[k] as number, b[k] as number]),
  };
}

function proposal(label: string, n: number, tape: Entry[], check: { verified: boolean; check: string }): Proposal {
  return { label, n, tape, ...check };
}

const TARGETS: TranspileTarget[] = ["clifford-t", "ibm-heavy-hex", "rigetti"];
const TARGET_LABEL: Record<TranspileTarget, string> = { "clifford-t": "Clifford+T", "ibm-heavy-hex": "IBM (RZ, SX, CX)", rigetti: "Rigetti (RZ, RX±π/2, CZ)" };

function layoutNote(perm: number[]): string | null {
  const moved = perm.map((p, l) => [l, p]).filter(([l, p]) => l !== p);
  return moved.length ? `Final layout: ${moved.map(([l, p]) => `q${l}→q${p}`).join(", ")} (the output state has these qubits relabelled).` : null;
}

// ─── Exact evolution for the Trotter error ─────────────────────────────

function denseH(n: number, text: string): Complex[][] {
  const d = 1 << n;
  const H: Complex[][] = Array.from({ length: d }, () => Array.from({ length: d }, () => ({ re: 0, im: 0 })));
  for (const t of parsePauliSum(text)) {
    const P = pauliSparse(n, t.paulis);
    for (let c = 0; c < d; c++) {
      H[P.perm[c]][c].re += t.coefficient * P.phRe[c];
      H[P.perm[c]][c].im += t.coefficient * P.phIm[c];
    }
  }
  return H;
}

/** Largest entry of U − e^{iφ}·V after aligning the global phase (U, V as column states). */
function opDistance(U: Float64Array[], V: Float64Array[]): number {
  let best = -1, bj = 0, bi = 0;
  U.forEach((col, j) => { for (let i = 0; i < col.length / 2; i++) { const m = col[2 * i] ** 2 + col[2 * i + 1] ** 2; if (m > best) { best = m; bj = j; bi = i; } } });
  const [ar, ai] = [U[bj][2 * bi], U[bj][2 * bi + 1]], [br, bim] = [V[bj][2 * bi], V[bj][2 * bi + 1]];
  const d = br * br + bim * bim, pr = (ar * br + ai * bim) / d, pi = (ai * br - ar * bim) / d;
  let err = 0;
  U.forEach((col, j) => {
    for (let i = 0; i < col.length / 2; i++) {
      const vr = V[j][2 * i], vi = V[j][2 * i + 1];
      err = Math.max(err, Math.hypot(col[2 * i] - (pr * vr - pi * vi), col[2 * i + 1] - (pr * vi + pi * vr)));
    }
  });
  return err;
}

// ─── Stabilizer tableau of a Clifford tape ─────────────────────────────

/** Generators of a Clifford tape's state (stabilizer register: every Clifford gate, recorded outcomes); null if not Clifford. */
export function cliffordGenerators(n: number, tape: Entry[]): string[] | null {
  try {
    return new StabilizerRegister(n, tape).tab.stabilizers();
  } catch {
    return null;
  }
}

// ─── The runs ──────────────────────────────────────────────────────────

export const TOOL_RUNS: Record<string, Run> = {
  simplify(ctx, opts) {
    const deep = num("simplify", "deep", opts, ctx.n) === 1;
    const r = optimiseCircuit(toolCircuit(ctx.n, ctx.tape), { deep });
    const tape = raiseCircuit(r.circuit);
    const fired = Object.entries(r.rulesFired).filter(([, v]) => v > 0);
    return {
      scalars: [{ label: "gates", value: `${r.before} → ${r.after}` }, { label: "passes", value: r.passes }],
      charts: [compareTable(ctx.n, ctx.tape, tape), ...(fired.length ? [{ kind: "table" as const, title: "rules fired", headers: ["rule", "times"], rows: fired }] : [])],
      notes: r.after === r.before ? ["Nothing to simplify: no adjacent cancellations or merges."] : [],
      proposal: r.after < r.before ? proposal("APPLY · replace the circuit", ctx.n, tape, sameOperator(ctx, ctx.tape, tape)) : undefined,
    };
  },

  transpile(ctx, opts) {
    const target = TARGETS[num("transpile", "target", opts, ctx.n)];
    const r = transpile(toolCircuit(ctx.n, ctx.tape), target);
    const tape = raiseCircuit(r.circuit);
    const skipped = [...new Set(r.skipped.map((s) => s.gateId))];
    return {
      scalars: [{ label: "target", value: TARGET_LABEL[target] }],
      charts: [compareTable(ctx.n, ctx.tape, tape)],
      notes: skipped.length ? [`Left as is (no exact ${TARGET_LABEL[target]} form here): ${skipped.join(", ")}.${target === "clifford-t" ? " Arbitrary angles need approximate synthesis, which isn't done." : " Symbolic angles block the 2-qubit (KAK) decomposition."}`] : [],
      proposal: proposal("APPLY · replace the circuit", ctx.n, tape, sameOperator(ctx, ctx.tape, tape)),
    };
  },

  route(ctx, opts) {
    const name = COUPLING_NAMES[num("route", "coupling", opts, ctx.n)];
    const map = coupling(name, ctx.n);
    const circ = toolCircuit(ctx.n, ctx.tape);
    const r = routeCircuit(circ, map);
    const tape = raiseCircuit(r.circuit);
    const after = countConnectivityViolations(namedCircuit(ctx.n, tape), map);
    return {
      scalars: [
        { label: "coupling", value: name },
        { label: "2-qubit gates off the map", value: `${r.violationsBefore} → ${after}` },
        { label: "SWAPs inserted", value: r.swapsInserted },
      ],
      charts: [compareTable(ctx.n, ctx.tape, tape)],
      notes: [
        ...(after ? ["Gates on 3+ qubits aren't routed."] : []),
        ...[layoutNote(r.finalMapping)].filter((x): x is string => !!x),
      ],
      proposal: r.swapsInserted || r.violationsBefore || tape.length !== ctx.tape.length
        ? proposal("APPLY · replace the circuit", ctx.n, tape, sameOperator(ctx, ctx.tape, tape, { perm: r.finalMapping, what: "same operator up to the final layout and a global phase" }))
        : undefined,
    };
  },

  compile(ctx, opts) {
    const target = TARGETS[num("compile", "target", opts, ctx.n)];
    const ci = num("compile", "coupling", opts, ctx.n);
    const map = ci === 0 ? undefined : coupling(COUPLING_NAMES[ci - 1], ctx.n);
    const r = compileForDevice(toolCircuit(ctx.n, ctx.tape), target, map);
    const tape = raiseCircuit(r.circuit);
    return {
      charts: [
        { kind: "table", title: "stages", headers: ["stage", "gates", "depth"], rows: r.stages.map((s) => [s.name, s.gates, s.depth]) },
        compareTable(ctx.n, ctx.tape, tape),
      ],
      notes: [layoutNote(r.finalMapping)].filter((x): x is string => !!x),
      proposal: proposal("APPLY · replace the circuit", ctx.n, tape, sameOperator(ctx, ctx.tape, tape, { perm: r.finalMapping, what: "same operator up to the final layout and a global phase" })),
    };
  },

  inverse(ctx, opts) {
    const append = num("inverse", "mode", opts, ctx.n) === 0;
    const circ = toolCircuit(ctx.n, ctx.tape);
    const { inverted, skipped } = inverseGates(circ, 0, Number.MAX_SAFE_INTEGER);
    if (skipped.length) throw new Error(`can't invert ${[...new Set(skipped.map((g) => g.gateId))].join(", ")}`);
    const inv = raiseCircuit({ ...circ, gates: inverted });
    const tape = append ? [...ctx.tape, ...inv] : inv;
    // Either way U·U† must be the identity.
    const check = sameOperator(ctx, [...ctx.tape, ...inv], [], { what: "U followed by U† is the identity, up to a global phase" });
    return {
      scalars: [{ label: "U† gates", value: inv.length }],
      charts: [compareTable(ctx.n, ctx.tape, tape)],
      notes: append ? ["Appending U† returns the state to |0…0⟩: a mirror (echo) circuit."] : [],
      proposal: proposal(append ? "APPLY · append U†" : "APPLY · replace by U†", ctx.n, tape, check),
    };
  },

  trotter(ctx, opts) {
    const text = pauliValue(opts, "ham", ctx.n);
    const terms = parsePauliSum(text);
    const n = terms[0].paulis.length;
    if (n > 10) throw new Error("the Hamiltonian acts on more than 10 qubits");
    const steps = num("trotter", "steps", opts, ctx.n);
    const order = ([1, 2, 4] as const)[num("trotter", "order", opts, ctx.n)];
    const qdrift = num("trotter", "mode", opts, ctx.n) === 1;
    let seed = 0x2545f491;
    const rng = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
    const tape = raiseCircuit(buildTrotterCircuit(terms, { steps, delta: "t", order, mode: qdrift ? "qdrift" : "trotter", samples: 16, rng }));
    // Error against the exact e^{−iH·steps·t} at the current t (1 if unset).
    const t = ctx.scope.t ?? 1;
    const scalars: AnalysisResult["scalars"] = [{ label: "gates", value: tape.length }, { label: "total time", value: `${steps}·t` }];
    if (n <= FULL_MAX) {
      const { values, vectors } = hermitianEig(denseH(n, text));
      const d = 1 << n, T = steps * t;
      const exact: Float64Array[] = [], trot: Float64Array[] = [];
      for (let j = 0; j < d; j++) {
        const col = new Float64Array(2 * d);
        values.forEach((E, k) => {
          const v = vectors[k], c = Math.cos(-E * T), s = Math.sin(-E * T);
          // Σ_k |v_k⟩ e^{−iE T} ⟨v_k|j⟩
          const wr = v[j].re * c + v[j].im * s, wi = v[j].re * s - v[j].im * c;
          for (let i = 0; i < d; i++) { col[2 * i] += v[i].re * wr - v[i].im * wi; col[2 * i + 1] += v[i].re * wi + v[i].im * wr; }
        });
        exact.push(col);
        const psi = new Float64Array(2 * d);
        psi[2 * j] = 1;
        const cbits = new Uint8Array(n);
        for (const s of tape.flat()) applyStep(psi, n, s, Math.random, { ...ctx.scope, t }, cbits);
        trot.push(psi);
      }
      scalars.push({ label: `error at t = ${Math.round(t * 1000) / 1000}`, value: opDistance(trot, exact), unit: "max |ΔU|" });
    }
    return {
      scalars,
      notes: [
        `${qdrift ? "QDrift (16 random samples per step, fixed seed)" : `Order-${order} product formula`}, each step e^{−iH·t}; t is the circuit's symbol (PARAM plays it).`,
        ...(n !== ctx.n ? [`Replacing resizes the register to n = ${n}.`] : []),
      ],
      proposal: proposal("APPLY · replace the circuit", n, tape, { verified: true, check: "Trotter formula checked against Qiskit's PauliEvolutionGate (orders 1, 2, 4)" }),
    };
  },

  stateprep(ctx, opts) {
    const text = typeof opts.target === "string" && opts.target.trim() ? opts.target.trim() : "current";
    let n = ctx.n, re: number[], im: number[];
    if (text === "current") {
      re = Array.from({ length: 1 << n }, (_, i) => ctx.state[2 * i]);
      im = Array.from({ length: 1 << n }, (_, i) => ctx.state[2 * i + 1]);
    } else {
      const label = text.replace(/[|⟩〉>\s]/g, "");
      if (/^[01]+$/.test(label)) n = label.length;
      else {
        const k = Math.log2(text.split(/[\s,]+/).filter(Boolean).length);
        if (!Number.isInteger(k)) throw new Error("give |bits⟩ or 2ⁿ amplitudes separated by commas");
        n = k;
      }
      if (n > 8) throw new Error("state preparation is capped at 8 qubits");
      const parsed = parseTargetState(text, n);
      if (!parsed) throw new Error("can't read the target: |011⟩, or amplitudes like 1, 0, 0, i");
      ({ re, im } = parsed);
    }
    if (n > 8) throw new Error("state preparation is capped at 8 qubits");
    const circ = statePrepCircuit(re, im, n);
    if (!circ) throw new Error("the target is the zero vector");
    const tape = raiseCircuit(circ);
    const reg = new Register(n, tape);
    const nrm = Math.sqrt(re.reduce((s, x, i) => s + x * x + im[i] * im[i], 0));
    let pr = 0, pi = 0;
    for (let i = 0; i < 1 << n; i++) {
      pr += (re[i] * reg.state[2 * i] + im[i] * reg.state[2 * i + 1]) / nrm;
      pi += (re[i] * reg.state[2 * i + 1] - im[i] * reg.state[2 * i]) / nrm;
    }
    const ov = Math.hypot(pr, pi);
    const ok = Math.abs(ov - 1) < 1e-9;
    const res = circuitResources(n, tape);
    return {
      scalars: [{ label: "|⟨target|ψ⟩|", value: ov }, { label: "gates", value: res.gates }, { label: "CX", value: res.cxCount }],
      notes: ["Möttönen et al. uniformly controlled RY/RZ cascade from |0…0⟩; exact up to a global phase, not gate-optimal."],
      proposal: proposal("APPLY · replace the circuit", n, tape, {
        verified: ok, check: ok ? `prepares the target from |0…0⟩ (overlap 1 − ${e2(1 - ov)})` : `misses the target (overlap ${ov}) — not offered`,
      }),
    };
  },

  synth(ctx) {
    if (ctx.tape.some((e) => e.some((s) => NONUNITARY.has(s.gateId)))) throw new Error("the circuit isn't unitary (it measures, resets or prepares a state)");
    const d = 1 << ctx.n;
    const U: Cx[][] = Array.from({ length: d }, () => new Array<Cx>(d));
    for (let j = 0; j < d; j++) {
      const psi = new Float64Array(2 * d);
      psi[2 * j] = 1;
      const cbits = new Uint8Array(ctx.n);
      for (const s of ctx.tape.flat()) applyStep(psi, ctx.n, s, Math.random, ctx.scope, cbits);
      for (let i = 0; i < d; i++) U[i][j] = { re: psi[2 * i], im: psi[2 * i + 1] };
    }
    const gates = synthesizeUnitary(U, ctx.n);
    if (!gates) throw new Error("synthesis failed");
    const tape = raiseCircuit({ numQubits: ctx.n, numClbits: 0, gates });
    const syms = ctx.tape.flat().some((s) => stepSymbols(s).length > 0);
    const r = equivalent(ctx.n, ctx.tape, tape, { scope: ctx.scope });
    return {
      charts: [compareTable(ctx.n, ctx.tape, tape)],
      notes: [
        "Gray-code two-level decomposition into controlled 2×2 gates (u_arb): exact but not gate-optimal.",
        ...(syms ? ["Synthesised at the current symbol values: the output has numbers, not symbols."] : []),
      ],
      proposal: proposal("APPLY · replace the circuit", ctx.n, tape, {
        verified: r.equal, check: r.equal ? `same operator up to a global phase at the current values (err ${e2(r.maxErr)})` : `differs (err ${e2(r.maxErr)}) — not offered`,
      }),
    };
  },

  resources(ctx, opts) {
    const r = circuitResources(ctx.n, ctx.tape, ctx.scope);
    const ci = num("resources", "coupling", opts, ctx.n);
    const rows: (string | number)[][] = [
      ["gates", r.gates], ["depth", r.depth], ["1-qubit", r.oneQubit], ["2-qubit", r.twoQubit], ["3+ qubit", r.multiQubit],
      ["CX", r.cxCount], ["T count", r.tCount], ["T-depth", r.tDepth], ["Clifford gates", r.cliffordCount],
      ["with angles", r.parameterized], ["measurements", r.measurements], ["resets", r.resets], ["busiest qubit", r.longestQubit],
    ];
    if (ci > 0) rows.push([`off a ${COUPLING_NAMES[ci - 1]} map`, countConnectivityViolations(namedCircuit(ctx.n, ctx.tape), coupling(COUPLING_NAMES[ci - 1], ctx.n))]);
    return {
      scalars: r.symbols.length ? [{ label: "symbols", value: r.symbols.join(" ") }] : [],
      charts: [{ kind: "table", headers: ["", "count"], rows }],
      notes: ["Counted as the QASM export's instructions, with Qiskit's definitions (size, depth, T-depth = most T/T† on any path)."],
    };
  },

  interaction(ctx) {
    const r = interactionGraph(namedCircuit(ctx.n, ctx.tape));
    if (r.totalEdges === 0) return { scalars: [{ label: "multi-qubit gates", value: 0 }], notes: ["No gate acts on two or more qubits."] };
    const q = [...Array(ctx.n).keys()].map((i) => `q${i}`);
    return {
      scalars: [{ label: "interacting pairs", value: r.weight.flat().filter((w) => w > 0).length / 2 }],
      charts: [{ kind: "heatmap", scale: "seq", min: 0, max: r.maxWeight, rows: q, cols: q, values: r.weight, title: "gates acting on both qubits" }],
      notes: ["Each gate on k qubits adds 1 to every pair among them (controls included)."],
    };
  },

  tanner(ctx) {
    const t = tannerGraph(lowerTape(ctx.n, ctx.tape));
    if (!t.checks.length) return { scalars: [{ label: "checks (measurements)", value: 0 }], notes: ["No measurements in the circuit: key MEAS to add checks."] };
    const q = [...Array(ctx.n).keys()].map((i) => `q${i}`);
    return {
      scalars: [{ label: "checks (measurements)", value: t.checks.length }],
      charts: [{
        kind: "heatmap", scale: "seq", min: 0, max: 1, rows: t.checks.map((c, i) => `m${i + 1}·q${c.qubit}`), cols: q,
        values: t.checks.map((c) => q.map((_, k) => (c.support.includes(k) ? 1 : 0))), codes: { 1: "in the check's cone", 0: "outside" },
      }],
      notes: ["Each measurement's backward light cone: the qubits that can influence its outcome (an upper bound on the check's support)."],
    };
  },

  branches(ctx) {
    const t = branchTree(ctx.n, ctx.tape, ctx.scope, 8);
    if (t.events === 0) return { scalars: [{ label: "measurements", value: 0 }], notes: ["No measurements or resets: a single branch."] };
    const leaves = [...t.leaves].sort((a, b) => b.p - a.p);
    const bits = [...Array(ctx.n).keys()].map((q) => `c${q}`).join("");
    return {
      scalars: [{ label: "branches", value: t.leaves.length }, { label: "events on the longest path", value: t.events }],
      charts: [
        ...(t.leaves.length <= 16 ? [{ kind: "tree" as const, nodes: t.nodes, title: "every measurement history (edge width ∝ outcome probability)" }] : []),
        { kind: "table", title: `outcome histories (${bits} = final classical bits)`, headers: ["outcomes", bits, "p"], rows: leaves.slice(0, 64).map((l) => [l.path, l.cbits, l.p]) },
      ],
      notes: ["All histories, not just the recorded one: each measurement splits the state; IF conditions follow each branch's bits."],
    };
  },

  tableau(ctx) {
    const g = cliffordGenerators(ctx.n, ctx.tape);
    if (!g) {
      return {
        scalars: [{ label: "Clifford circuit", value: "no" }],
        notes: ["Only for Clifford circuits (every gate Clifford, no symbols): Paulis, H, S, √X, √Y, SWAP, iSWAP, CX, CZ, ECR, rotations by multiples of π/2, measurements, resets, preps."],
      };
    }
    return {
      charts: [{ kind: "table", title: "stabilizer generators (q0 leftmost)", headers: ["", "sign", "Pauli"], rows: g.map((s, i) => [`g${i + 1}`, s[0], s.slice(1)]) }],
      notes: ["The state is the unique +1 eigenstate of every generator (Aaronson–Gottesman tableau; measurements take their recorded outcomes)."],
    };
  },
};
