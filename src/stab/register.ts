/**
 * The register above 20 qubits: a stabilizer tableau (Aaronson–Gottesman,
 * sim/stabilizer.ts) instead of a statevector, up to 1024 qubits. Same
 * contract as calc/register.ts — tape, undoable ops, recorded measurement
 * outcomes, classical bits, IF — for Clifford tapes: every gate must be
 * Clifford (stab/clifford.ts), and symbols aren't allowed (an angle's value
 * decides whether a gate is Clifford).
 */
import { Stabilizer } from "../sim/stabilizer";
import { classicalBits, exportedSteps, MEASURE_IDS, stepSymbols, type Entry, type Scope, type Step } from "../calc/steps";
import type { Contents, Op } from "../calc/register";
import { cliffordPrims } from "./clifford";

export const STAB_MAX = 1024;

const forced = (o: 0 | 1) => () => (o === 1 ? 0.9 : 0.1);

/** Apply one step to the tableau; returns the step with its (possibly new) outcome. */
function applyTab(tab: Stabilizer, s: Step, rng: () => number, cbits: Uint8Array, notes: string[], where: number): Step {
  if (s.condition && cbits[s.condition.clbit] !== s.condition.value) return s;
  if (stepSymbols(s).length) throw new Error("symbols need the statevector (n ≤ 20)");
  let outcome: 0 | 1 | undefined = s.outcome;
  for (const x of exportedSteps(s)) {
    if (MEASURE_IDS.has(x.gateId)) {
      // measure (exported steps already rotate measure_x / measure_y), or reset
      const q = x.targets[0];
      let o: number;
      if (outcome === undefined) o = tab.measureZ(q, rng);
      else {
        // The recorded outcome is forced; a deterministic one stands (the recorded one became impossible).
        o = tab.measureZ(q, isDeterministic(tab, q) ? rng : forced(outcome));
        if (o !== outcome) notes.push(`measurement at step ${where} changed ${outcome}→${o}`);
      }
      if (x.gateId === "reset") { if (o === 1) tab.x(q); }
      else cbits[q] = o;
      outcome = o as 0 | 1;
      continue;
    }
    const prims = cliffordPrims({ ...x, condition: undefined });
    if (!prims) throw new Error(`${x.gateId.toUpperCase()} isn't a Clifford gate: above 20 qubits only Clifford gates run`);
    for (const p of prims) {
      if (p.gate === "h") tab.h(p.qubits[0]);
      else if (p.gate === "s") tab.s(p.qubits[0]);
      else tab.cnot(p.qubits[0], p.qubits[1]);
    }
  }
  return outcome === s.outcome ? s : { ...s, outcome };
}

/** Is a Z measurement of qubit q deterministic (no stabilizer generator anticommutes with Z_q)? */
function isDeterministic(tab: Stabilizer, q: number): boolean {
  return tab.pauliExpectation(Array.from({ length: tab.n }, (_, i) => (i === q ? "Z" : "I"))) !== 0;
}

export class StabilizerRegister {
  n: number;
  tab: Stabilizer;
  tape: Entry[] = [];
  scope: Scope;
  cbits: Uint8Array;
  ops: Op[] = [];
  redoOps: Op[] = [];
  notes: string[] = [];

  constructor(n: number, tape: Entry[] = [], scope: Scope = {}) {
    if (n < 1 || n > STAB_MAX) throw new Error(`n must be 1–${STAB_MAX}`);
    this.n = n;
    this.scope = { ...scope };
    this.tab = new Stabilizer(n);
    this.cbits = new Uint8Array(n);
    for (const e of tape) this.apply(e, Math.random);
    this.ops = this.tape.map((entry) => ({ k: "entry", entry }));
  }

  private apply(entry: Entry, rng: () => number): Entry {
    const where = this.tape.length + 1;
    const done = entry.map((s) => applyTab(this.tab, s, rng, this.cbits, this.notes, where));
    this.tape.push(done);
    return done;
  }

  push(entry: Entry, rng: () => number = Math.random): Entry {
    this.notes = [];
    this.redoOps = [];
    // Check first: a refused gate must leave the tableau untouched.
    const probe = this.tab.clone(), cb = this.cbits.slice();
    entry.forEach((s) => applyTab(probe, s, () => 0.5, cb, [], 0));
    const done = this.apply(entry, rng);
    this.ops.push({ k: "entry", entry: done });
    return done;
  }

  private rebuild(tape: Entry[]) {
    this.tab = new Stabilizer(this.n);
    this.cbits = new Uint8Array(this.n);
    this.tape = [];
    for (const e of tape) this.apply(e, Math.random);
  }

  undo(): Op | null {
    this.notes = [];
    const op = this.ops.pop();
    if (!op) return null;
    this.redoOps.push(op);
    if (op.k === "replace") this.load(op.before);
    else this.rebuild(this.tape.slice(0, -1));
    return op;
  }

  redo(): Op | null {
    this.notes = [];
    const op = this.redoOps.pop();
    if (!op) return null;
    if (op.k === "replace") this.load(op.after);
    else this.apply(op.entry, Math.random);
    this.ops.push(op);
    return op;
  }

  replace(after: Contents, label: string): void {
    this.notes = [];
    const before = this.contents();
    this.load(after);
    this.ops.push({ k: "replace", before, after: this.contents(), label });
    this.redoOps = [];
  }

  contents(): Contents {
    return { n: this.n, tape: [...this.tape], scope: { ...this.scope } };
  }

  /** Swap in new contents; built aside first, so a refused (non-Clifford) tape leaves the register as it was. */
  private load(c: Contents) {
    const next = new StabilizerRegister(c.n, c.tape, c.scope);
    this.n = next.n;
    this.scope = next.scope;
    this.tab = next.tab;
    this.cbits = next.cbits;
    this.tape = next.tape;
    this.notes = next.notes;
  }

  resize(n: number): void {
    this.notes = [];
    if (n < 1 || n > STAB_MAX) throw new Error(`n must be 1–${STAB_MAX}`);
    const used = Math.max(-1, ...this.tape.flat().flatMap((s) => [...s.controls, ...s.targets]));
    if (n <= used) throw new Error(`q${used} in use`);
    this.n = n;
    this.rebuild(this.tape);
  }

  clear(): void {
    this.replace({ n: this.n, tape: [], scope: this.scope }, "AC");
  }

  symbols(): string[] {
    return [];
  }

  firstSymbolic(): number {
    return this.tape.length;
  }

  setScope(values: Scope): void {
    Object.assign(this.scope, values);
  }

  /** The tableau after the first `len` entries (TAPE scrubber), with recorded outcomes. */
  tableauAt(len: number): Stabilizer {
    if (len >= this.tape.length) return this.tab;
    const tab = new Stabilizer(this.n);
    const cb = classicalBits(this.n, this.tape, 0);
    for (const e of this.tape.slice(0, len)) for (const s of e) applyTab(tab, s, Math.random, cb, [], 0);
    return tab;
  }
}
