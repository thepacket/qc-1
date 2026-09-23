/**
 * Error-correction playground: the rotated surface code and the repetition
 * code at any odd distance, a union-find decoder, code-capacity Monte Carlo,
 * and the syndrome-extraction circuit as a tape.
 *
 * Surface code (distance d): data qubits on a d×d grid, index r·d + c. Checks
 * are plaquettes on the (d+1)×(d+1) vertex grid, plaquette (i, j) touching
 * data (i−1, j−1), (i−1, j), (i, j−1), (i, j). Bulk plaquettes alternate X/Z
 * ((i + j) even → X); weight-2 plaquettes are X on the top and bottom edges
 * and Z on the left and right: d² − 1 checks. Logical Z is Z on row 0,
 * logical X is X on column 0.
 *
 * Decoding is per error type: X errors light Z checks, Z errors light X
 * checks, a Y does both. The union-find decoder (Delfosse & Nickerson 2021)
 * grows clusters around lit checks by half-edges until each has even parity
 * or reaches the boundary, then peels a spanning forest into a correction. It
 * corrects every error of weight ≤ (d − 1)/2 (tested exhaustively).
 */
import type { Entry, Step } from "../calc/steps";
import { mulberry32 } from "../sim/measure";

export type CheckType = "X" | "Z";
export type Check = { type: CheckType; qubits: number[]; pos: [number, number] };
export type Code = {
  name: string; d: number; n: number;
  /** Data qubit positions (row, column) for drawing. */
  coords: [number, number][];
  checks: Check[];
  logicalX: number[]; logicalZ: number[];
  /** Grid size for drawing: rows × columns of data. */
  rows: number; cols: number;
};

export function surfaceCode(d: number): Code {
  if (d < 3 || d % 2 === 0) throw new Error("distance: odd, 3 or more");
  const checks: Check[] = [];
  for (let i = 0; i <= d; i++) {
    for (let j = 0; j <= d; j++) {
      const qs: number[] = [];
      for (const [r, c] of [[i - 1, j - 1], [i - 1, j], [i, j - 1], [i, j]]) if (r >= 0 && r < d && c >= 0 && c < d) qs.push(r * d + c);
      const type: CheckType = (i + j) % 2 === 0 ? "X" : "Z";
      if (qs.length < 2) continue;
      if (qs.length === 2 && (i === 0 || i === d) && type !== "X") continue;
      if (qs.length === 2 && (j === 0 || j === d) && type !== "Z") continue;
      checks.push({ type, qubits: qs, pos: [i, j] });
    }
  }
  return {
    name: `surface code d=${d}`, d, n: d * d, rows: d, cols: d,
    coords: Array.from({ length: d * d }, (_, q) => [Math.floor(q / d), q % d]),
    checks,
    logicalZ: Array.from({ length: d }, (_, c) => c),
    logicalX: Array.from({ length: d }, (_, r) => r * d),
  };
}

/** The bit-flip repetition code: Z Z checks between neighbours; it cannot see Z errors. */
export function repetitionCode(d: number): Code {
  if (d < 3 || d % 2 === 0) throw new Error("distance: odd, 3 or more");
  return {
    name: `repetition code d=${d}`, d, n: d, rows: 1, cols: d,
    coords: Array.from({ length: d }, (_, q) => [0, q]),
    checks: Array.from({ length: d - 1 }, (_, i) => ({ type: "Z" as const, qubits: [i, i + 1], pos: [0, i + 1] as [number, number] })),
    logicalX: Array.from({ length: d }, (_, q) => q),
    logicalZ: [0],
  };
}

/** Lit checks for Pauli errors given as X and Z bit masks (a Y sets both). */
export function syndromeOf(code: Code, ex: Uint8Array, ez: Uint8Array): Uint8Array {
  return Uint8Array.from(code.checks, (ch) => ch.qubits.reduce((s, q) => s ^ (ch.type === "Z" ? ex[q] : ez[q]), 0));
}

/**
 * Union-find decoding of the lit checks of one type (Z checks see X errors,
 * X checks see Z errors). Returns the data qubits to flip.
 */
export function decode(code: Code, type: CheckType, syndrome: Uint8Array): number[] {
  const idx = code.checks.flatMap((ch, k) => (ch.type === type ? [k] : []));
  const node = new Map(idx.map((k, i) => [k, i]));
  const B = idx.length; // the boundary node
  // One edge per data qubit: between the (one or two) checks of this type on it.
  const edges: { q: number; u: number; v: number }[] = [];
  for (let q = 0; q < code.n; q++) {
    const on = idx.filter((k) => code.checks[k].qubits.includes(q)).map((k) => node.get(k)!);
    if (on.length === 2) edges.push({ q, u: on[0], v: on[1] });
    else if (on.length === 1) edges.push({ q, u: on[0], v: B });
  }
  const N = B + 1;
  const defect = Uint8Array.from({ length: N }, (_, i) => (i < B ? syndrome[idx[i]] : 0));
  const parent = Int32Array.from({ length: N }, (_, i) => i);
  const parity = Uint8Array.from(defect);
  const boundary = Uint8Array.from({ length: N }, (_, i) => (i === B ? 1 : 0));
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => {
    a = find(a); b = find(b);
    if (a === b) return;
    parent[b] = a;
    parity[a] ^= parity[b];
    boundary[a] |= boundary[b];
  };
  const active = (x: number) => { const r = find(x); return parity[r] === 1 && !boundary[r]; };
  const support = new Uint8Array(edges.length);
  for (let guard = 0; guard < 4 * N + 4; guard++) {
    if (![...Array(B).keys()].some((i) => defect[i] && active(i))) break;
    const grow = edges.map((e) => (active(e.u) ? 1 : 0) + (active(e.v) ? 1 : 0));
    const done: number[] = [];
    edges.forEach((_, k) => {
      if (support[k] < 2 && grow[k]) {
        support[k] = Math.min(2, support[k] + grow[k]);
        if (support[k] === 2) done.push(k);
      }
    });
    for (const k of done) union(edges[k].u, edges[k].v);
  }
  // Peel: a spanning forest of the grown edges, rooted at the boundary where a tree reaches it.
  const adj: [number, number][][] = Array.from({ length: N }, () => []);
  edges.forEach((e, k) => { if (support[k] === 2) { adj[e.u].push([e.v, k]); adj[e.v].push([e.u, k]); } });
  const seen = new Uint8Array(N);
  const mark = Uint8Array.from(defect);
  const flip: number[] = [];
  const peel = (root: number) => {
    const order: number[] = [], up = new Int32Array(N).fill(-1), upEdge = new Int32Array(N).fill(-1);
    seen[root] = 1;
    for (let h = 0, queue = [root]; h < queue.length; h++) {
      const x = queue[h];
      order.push(x);
      for (const [y, k] of adj[x]) if (!seen[y]) { seen[y] = 1; up[y] = x; upEdge[y] = k; queue.push(y); }
    }
    for (let i = order.length - 1; i > 0; i--) {
      const x = order[i];
      if (mark[x]) { flip.push(edges[upEdge[x]].q); mark[x] = 0; mark[up[x]] ^= 1; }
    }
  };
  peel(B);
  for (let i = 0; i < B; i++) if (!seen[i] && adj[i].length) peel(i);
  return flip;
}

/** Decode both error types; the residual (error ⊕ correction) decides a logical failure. */
export function decodeAll(code: Code, ex: Uint8Array, ez: Uint8Array) {
  const s = syndromeOf(code, ex, ez);
  const cx = new Uint8Array(code.n), cz = new Uint8Array(code.n);
  for (const q of decode(code, "Z", s)) cx[q] ^= 1;
  if (code.checks.some((c) => c.type === "X")) for (const q of decode(code, "X", s)) cz[q] ^= 1;
  const rx = ex.map((b, q) => b ^ cx[q]), rz = ez.map((b, q) => b ^ cz[q]);
  // X residual flips the logical if it anticommutes with logical Z (odd overlap), and likewise for Z.
  const odd = (mask: Uint8Array, support: number[]) => support.reduce((s2, q) => s2 ^ mask[q], 0) === 1;
  const repair = syndromeOf(code, rx, rz).every((b) => b === 0);
  return {
    syndrome: s, cx, cz, repair,
    logicalX: odd(rx, code.logicalZ),
    // The repetition code has no X checks: Z errors are simply not corrected, and not counted.
    logicalZ: code.checks.some((c) => c.type === "X") ? odd(rz, code.logicalX) : false,
  };
}

export type NoiseKind = "bitflip" | "depolarizing";

/** Code-capacity Monte Carlo: independent errors on data qubits, perfect syndromes. Returns the logical error rate. */
export function logicalErrorRate(code: Code, p: number, kind: NoiseKind, shots: number, seed = 7): number {
  const rng = mulberry32(seed);
  let fails = 0;
  const ex = new Uint8Array(code.n), ez = new Uint8Array(code.n);
  for (let s = 0; s < shots; s++) {
    ex.fill(0); ez.fill(0);
    for (let q = 0; q < code.n; q++) {
      if (rng() >= p) continue;
      if (kind === "bitflip") ex[q] = 1;
      else {
        const w = Math.floor(rng() * 3); // X, Y, Z with p/3 each
        if (w !== 2) ex[q] = 1;
        if (w !== 0) ez[q] = 1;
      }
    }
    const r = decodeAll(code, ex, ez);
    if (r.logicalX || r.logicalZ) fails++;
  }
  return fails / shots;
}

/** Parse "X4 Z7 Y12" (qubit numbers are data indices) into masks. */
export function parseErrors(code: Code, text: string): { ex: Uint8Array; ez: Uint8Array } {
  const ex = new Uint8Array(code.n), ez = new Uint8Array(code.n);
  for (const tok of text.toUpperCase().split(/[\s,]+/).filter(Boolean)) {
    const m = /^([XYZ])(\d+)$/.exec(tok);
    if (!m) throw new Error(`"${tok}": write errors like X4 Z7 Y12`);
    const q = Number(m[2]);
    if (q >= code.n) throw new Error(`no data qubit ${q} (0–${code.n - 1})`);
    if (m[1] !== "Z") ex[q] ^= 1;
    if (m[1] !== "X") ez[q] ^= 1;
  }
  return { ex, ez };
}

/**
 * The syndrome-extraction circuit as a tape on code.n data + one ancilla per
 * check: a first round (projects the data into the code; X-check outcomes are
 * random), the errors as gates, a second round. The errors are what flips
 * between the rounds: ancilla k's two outcomes differ exactly where check k is lit.
 */
export function extractionTape(code: Code, ex: Uint8Array, ez: Uint8Array): Entry[] {
  let id = 0;
  const st = (gateId: string, targets: number[], controls: number[] = []): Step => ({ id: `qec${id++}`, gateId, column: 0, targets, controls, clbits: [], params: [] });
  const tape: Entry[] = [];
  const round = () => {
    code.checks.forEach((ch, k) => {
      const a = code.n + k;
      if (ch.type === "X") {
        tape.push([st("h", [a])]);
        for (const q of ch.qubits) tape.push([st("x", [q], [a])]);
        tape.push([st("h", [a])]);
      } else {
        for (const q of ch.qubits) tape.push([st("x", [a], [q])]);
      }
      tape.push([st("measure", [a])]);
      tape.push([st("reset", [a])]);
    });
  };
  round();
  for (let q = 0; q < code.n; q++) {
    if (ex[q] && ez[q]) tape.push([st("y", [q])]);
    else if (ex[q]) tape.push([st("x", [q])]);
    else if (ez[q]) tape.push([st("z", [q])]);
  }
  round();
  return tape;
}

/** Ancilla outcomes flipped between the two rounds of an extraction tape (by check). */
export function flipsOf(code: Code, tape: Entry[]): Uint8Array {
  const outs: number[][] = code.checks.map(() => []);
  for (const e of tape) for (const s of e) if (s.gateId === "measure") outs[s.targets[0] - code.n].push(s.outcome ?? 0);
  return Uint8Array.from(outs, (o) => (o[0] ?? 0) ^ (o[1] ?? 0));
}
