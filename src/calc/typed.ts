/**
 * Typed states and matrices (CATALOG → STATE…, MATRIX…): text the user types
 * on the phone keyboard becomes a custom gate.
 *
 *   STATE:  "|00⟩ + |11⟩", "(1+i)|01⟩ − 0.5|10⟩", a basis label ("011"), or
 *           2^k amplitudes "1, 0, 0, i"; up to 8 qubits. Normalised. The
 *           gate PSIj maps |0…0⟩ to the state exactly (global phase included).
 *   MATRIX: rows separated by ";" or new lines, entries by ","; complex
 *           entries "a+bi", with π, √/sqrt, fractions. Up to 4 qubits (16×16).
 *           Checked unitary to 1e−3, then made exactly unitary (Gram–Schmidt
 *           on the columns); the gate Mj equals it exactly, phase included.
 *
 * The circuits come from the ported, validated state preparation (Möttönen)
 * and two-level unitary synthesis; both are exact only up to a global phase,
 * so each gate ends with an e^{iα}·I step (u_arb) that restores it, which
 * matters once the gate is controlled. Fixture `typed` checks the gates
 * against the typed matrices and states, and Qiskit's import of the export.
 */
import type { CustomGate } from "./custom";
import { applyStep, evalParam, type Entry, type Step } from "./steps";
import { statePrepCircuit } from "../sim/statePrep";
import { synthesizeUnitary, type Cx } from "../sim/unitarySynth";
import { raiseCircuit } from "./toolCircuit";

export const TYPED_MAX_QUBITS = 4; // matrices (the synthesis is O(4^k))
export const STATE_MAX_QUBITS = 8;

/** One complex literal: "0.5", "-i", "2i", "1/√2", "0.3+0.4i", "(1-i)/2" (parentheses around a sum). */
export function parseComplex(tok: string): [number, number] | null {
  const s = tok.replace(/\s+/g, "").replace(/−/g, "-").replace(/√\(?([\d.]+)\)?/g, "sqrt($1)").replace(/\bpi\b/g, "π");
  if (!s) return null;
  // (a+bi)/d or (a+bi)*d: a parenthesised sum with a real factor.
  const m = /^\((.+)\)([*/].+)?$/.exec(s);
  if (m && /[ij]/.test(m[1])) {
    const inner = parseComplex(m[1]);
    if (!inner) return null;
    const f = m[2] ? evalParam(m[2][0] === "*" ? m[2].slice(1) : `1/(${m[2].slice(1)})`) : 1;
    return Number.isFinite(f) ? [inner[0] * f, inner[1] * f] : null;
  }
  // Split off a trailing imaginary term: the last top-level + or − before a part ending in i/j.
  let re = s, im = "";
  if (/[ij]$/.test(s)) {
    let depth = 0, cut = 0;
    for (let k = s.length - 1; k > 0; k--) {
      if (s[k] === ")") depth++;
      else if (s[k] === "(") depth--;
      else if (depth === 0 && (s[k] === "+" || s[k] === "-") && !/[eE]/.test(s[k - 1])) { cut = k; break; }
    }
    re = s.slice(0, cut);
    im = s.slice(cut);
  }
  const num = (e: string) => evalParam(e);
  const r = re ? num(re) : 0;
  let i = 0;
  if (im) {
    const body = im.replace(/\*?[ij]$/, "");
    i = body === "" || body === "+" ? 1 : body === "-" ? -1 : num(body);
  }
  return Number.isFinite(r) && Number.isFinite(i) ? [r, i] : null;
}

/** A typed state: k qubits and its normalised amplitudes (q0 is the leftmost bit of a label). */
/** QC-1 (#59): typed text beyond this is refused before any parsing (a 16×16 matrix needs a few kB). */
export const TYPED_MAX_CHARS = 20_000;

export function parseState(text: string): { k: number; re: number[]; im: number[] } {
  if (text.length > TYPED_MAX_CHARS) throw new Error(`at most ${TYPED_MAX_CHARS} characters`);
  let t = text.trim().replace(/[〉>]/g, "⟩").replace(/−/g, "-");
  if (!t) throw new Error("type a state, e.g. |00⟩ + |11⟩");
  let re: number[], im: number[], k: number;
  if (t.includes("|")) {
    // Drop an overall factor: "(…)/√2" or "1/√2 (…)" — the state is normalised anyway.
    const outer = /^[^|]*?\((.*⟩.*)\)[^⟩]*$/.exec(t);
    if (outer) t = outer[1];
    const terms = [...t.matchAll(/([+-]?)\s*([^|+-]*(?:\([^)]*\))?[^|+-]*)\s*\|([01]+)⟩/g)];
    if (!terms.length) throw new Error("no |bits⟩ terms");
    k = terms[0][3].length;
    // QC-1 fix (docs/quantiom-bugs.md #59): check the size before allocating 2^k entries.
    if (k > STATE_MAX_QUBITS) throw new Error(`${STATE_MAX_QUBITS} qubits at most`);
    re = new Array(1 << k).fill(0);
    im = new Array(1 << k).fill(0);
    const rest = t.replace(/([+-]?)\s*([^|+-]*(?:\([^)]*\))?[^|+-]*)\s*\|([01]+)⟩/g, "").trim();
    if (rest) throw new Error(`can't read "${rest}"`);
    for (const [, sign, coef, bits] of terms) {
      if (bits.length !== k) throw new Error("all kets need the same number of qubits");
      const c = coef.trim() ? parseComplex(coef.trim().replace(/\*$/, "")) : [1, 0];
      if (!c) throw new Error(`can't read the coefficient "${coef.trim()}"`);
      const s = sign === "-" ? -1 : 1, j = parseInt(bits, 2);
      re[j] += s * c[0];
      im[j] += s * c[1];
    }
  } else if (/^[01]+$/.test(t)) {
    k = t.length;
    if (k > STATE_MAX_QUBITS) throw new Error(`${STATE_MAX_QUBITS} qubits at most`); // before allocating (#59)
    re = new Array(1 << k).fill(0);
    im = new Array(1 << k).fill(0);
    re[parseInt(t, 2)] = 1;
  } else {
    const toks = t.split(/[,;\s]+/).filter(Boolean);
    k = Math.log2(toks.length);
    if (!Number.isInteger(k) || k < 1) throw new Error("give 2, 4, 8… amplitudes, or |bits⟩ terms");
    if (k > STATE_MAX_QUBITS) throw new Error(`${STATE_MAX_QUBITS} qubits at most`);
    re = [];
    im = [];
    for (const x of toks) {
      const c = parseComplex(x);
      if (!c) throw new Error(`can't read "${x}"`);
      re.push(c[0]);
      im.push(c[1]);
    }
  }
  if (k > STATE_MAX_QUBITS) throw new Error(`${STATE_MAX_QUBITS} qubits at most`);
  const nrm = Math.sqrt(re.reduce((s, x, i) => s + x * x + im[i] * im[i], 0));
  if (!(nrm > 1e-12)) throw new Error("the state is zero");
  return { k, re: re.map((x) => x / nrm), im: im.map((x) => x / nrm) };
}

/** A typed matrix: square, 2^k × 2^k, rows by ";" or new lines. Returns rows of [re, im]. */
export function parseMatrix(text: string): { k: number; U: Cx[][]; drift: number } {
  if (text.length > TYPED_MAX_CHARS) throw new Error(`at most ${TYPED_MAX_CHARS} characters`);
  const rows = text.trim().replace(/−/g, "-").split(/[;\n]+/).map((r) => r.trim()).filter(Boolean)
    .map((r) => r.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean));
  const d = rows.length;
  const k = Math.log2(d);
  if (!Number.isInteger(k) || k < 1) throw new Error("2, 4, 8 or 16 rows, separated by ; or new lines");
  if (k > TYPED_MAX_QUBITS) throw new Error(`${TYPED_MAX_QUBITS} qubits (16×16) at most`);
  const U: Cx[][] = rows.map((r, i) => {
    if (r.length !== d) throw new Error(`row ${i + 1} has ${r.length} entries, not ${d}`);
    return r.map((x) => {
      const c = parseComplex(x);
      if (!c) throw new Error(`can't read "${x}"`);
      return { re: c[0], im: c[1] };
    });
  });
  // How far from unitary: max |U†U − I|.
  let drift = 0;
  for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) {
    let re = 0, im = 0;
    for (let i = 0; i < d; i++) { re += U[i][a].re * U[i][b].re + U[i][a].im * U[i][b].im; im += U[i][a].re * U[i][b].im - U[i][a].im * U[i][b].re; }
    drift = Math.max(drift, Math.hypot(re - (a === b ? 1 : 0), im));
  }
  if (drift > 1e-3) throw new Error(`not unitary (U†U is off by ${drift.toPrecision(2)})`);
  // Gram–Schmidt on the columns: exactly unitary, and equal to U when it already was.
  for (let b = 0; b < d; b++) {
    for (let a = 0; a < b; a++) {
      let re = 0, im = 0; // ⟨col a | col b⟩
      for (let i = 0; i < d; i++) { re += U[i][a].re * U[i][b].re + U[i][a].im * U[i][b].im; im += U[i][a].re * U[i][b].im - U[i][a].im * U[i][b].re; }
      for (let i = 0; i < d; i++) {
        U[i][b] = { re: U[i][b].re - (re * U[i][a].re - im * U[i][a].im), im: U[i][b].im - (re * U[i][a].im + im * U[i][a].re) };
      }
    }
    const nrm = Math.sqrt(U.reduce((s, r) => s + r[b].re ** 2 + r[b].im ** 2, 0));
    for (let i = 0; i < d; i++) U[i][b] = { re: U[i][b].re / nrm, im: U[i][b].im / nrm };
  }
  return { k, U, drift };
}

/** e^{iα}·I on local qubit 0, as u_arb. */
const phase = (alpha: number): Step => {
  const [c, s] = [String(Math.cos(alpha)), String(Math.sin(alpha))];
  return { id: `ph${seq++}`, gateId: "u_arb", column: 0, targets: [0], controls: [], clbits: [], params: [c, s, "0", "0", "0", "0", c, s] };
};
let seq = 0;

/** The operator of a tape on k qubits, column j = image of basis state j. */
function operator(k: number, tape: Entry[]): Float64Array[] {
  const d = 1 << k;
  return Array.from({ length: d }, (_, j) => {
    const st = new Float64Array(2 * d);
    st[2 * j] = 1;
    for (const e of tape) for (const s of e) applyStep(st, k, s, Math.random, {});
    return st;
  });
}

/** PSIj: a k-qubit gate taking |0…0⟩ to the state, exactly. */
export function stateGate(name: string, st: { k: number; re: number[]; im: number[] }): CustomGate {
  const circ = statePrepCircuit(st.re, st.im, st.k);
  if (!circ) throw new Error("the state is zero");
  const tape = raiseCircuit(circ);
  const col = operator(st.k, tape)[0];
  // ⟨prepared|target⟩ = e^{iα}: the prepared state is off by e^{−iα}.
  let pr = 0, pi = 0;
  for (let i = 0; i < 1 << st.k; i++) { pr += col[2 * i] * st.re[i] + col[2 * i + 1] * st.im[i]; pi += col[2 * i] * st.im[i] - col[2 * i + 1] * st.re[i]; }
  const alpha = Math.atan2(pi, pr);
  if (Math.abs(alpha) > 1e-14) tape.push([phase(alpha)]);
  return { name, k: st.k, tape };
}

/** Mj: a k-qubit gate equal to the matrix, exactly. */
export function matrixGate(name: string, m: { k: number; U: Cx[][] }): CustomGate {
  let tape: Entry[];
  if (m.k === 1) {
    const [[a, b], [c, dd]] = m.U;
    tape = [[{ id: `m${seq++}`, gateId: "u_arb", column: 0, targets: [0], controls: [], clbits: [], params: [a.re, a.im, b.re, b.im, c.re, c.im, dd.re, dd.im].map(String) }]];
  } else {
    const gates = synthesizeUnitary(m.U, m.k);
    if (!gates) throw new Error("synthesis failed");
    tape = raiseCircuit({ numQubits: m.k, numClbits: 0, gates });
  }
  // The phase between the circuit and U, read off the largest entry.
  const V = operator(m.k, tape);
  let bi = 0, bj = 0, big = -1;
  m.U.forEach((r, i) => r.forEach((z, j) => { const a = Math.hypot(z.re, z.im); if (a > big) { big = a; bi = i; bj = j; } }));
  const v = { re: V[bj][2 * bi], im: V[bj][2 * bi + 1] }, u = m.U[bi][bj];
  const alpha = Math.atan2(u.im, u.re) - Math.atan2(v.im, v.re);
  if (Math.abs(Math.sin(alpha)) > 1e-14 || Math.cos(alpha) < 0) tape.push([phase(alpha)]);
  return { name, k: m.k, tape };
}
