import { MAX_QUBITS } from "./register";
import { evalParam, formatEntry, NONUNITARY, type Entry, type Step } from "./steps";
import { CATALOG } from "./catalog";
import { splitArgs, TOKENS, toDisplay, type Token } from "./entry";
import type { Cmd, Mode, Result, ViewData } from "./core";
import type { Engine } from "./engine";

export type { Mode };

export type KeyId =
  | "2nd" | "left" | "right" | "q" | "undo"
  | "ctrl" | "all" | "swap" | "meas" | "ac"
  | "h" | "x" | "y" | "z" | "sx"
  | "s" | "t" | "rx" | "ry" | "rz"
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "." | "," | "div" | "mul" | "minus" | "pi" | "bs" | "p" | "eq";

/** Gate keys: base gate id, qubit arity, and default parameters. */
type GateKey = { gate: string; arity: 1 | 2 | 3 | 4; params: string[] };
const GATE_KEYS: Record<string, GateKey> = {
  h: { gate: "h", arity: 1, params: [] },
  sy: { gate: "sy", arity: 1, params: [] },
  x: { gate: "x", arity: 1, params: [] },
  y: { gate: "y", arity: 1, params: [] },
  z: { gate: "z", arity: 1, params: [] },
  sx: { gate: "sx", arity: 1, params: [] },
  sxdg: { gate: "sxdg", arity: 1, params: [] },
  s: { gate: "s", arity: 1, params: [] },
  sdg: { gate: "sdg", arity: 1, params: [] },
  t: { gate: "t", arity: 1, params: [] },
  tdg: { gate: "tdg", arity: 1, params: [] },
  rx: { gate: "rx", arity: 1, params: ["π/2"] },
  ry: { gate: "ry", arity: 1, params: ["π/2"] },
  rz: { gate: "rz", arity: 1, params: ["π/2"] },
  p: { gate: "p", arity: 1, params: ["π/2"] },
  u: { gate: "u", arity: 1, params: ["π/2", "0", "π"] },
  swap: { gate: "swap", arity: 2, params: [] },
  iswap: { gate: "iswap", arity: 2, params: [] },
  rxx: { gate: "rxx", arity: 2, params: ["π/2"] },
  ryy: { gate: "ryy", arity: 2, params: ["π/2"] },
  rzz: { gate: "rzz", arity: 2, params: ["π/2"] },
  meas: { gate: "measure", arity: 1, params: [] },
  measx: { gate: "measure_x", arity: 1, params: [] },
  measy: { gate: "measure_y", arity: 1, params: [] },
  reset: { gate: "reset", arity: 1, params: [] },
};

/** What a key does with 2ND held. Keys absent here ignore 2ND. */
export const SHIFTED: Partial<Record<KeyId, string>> = {
  left: "n-", right: "n+", q: "n", undo: "redo", ctrl: "actrl", all: "cat",
  swap: "iswap", meas: "reset", h: "sy", x: "measx", y: "measy",
  sx: "sxdg", s: "sdg", t: "tdg", rx: "rxx", ry: "ryy", rz: "rzz",
  p: "u", div: "lparen", mul: "rparen", minus: "plus", pi: "sqrt",
};

export type Mark = { q: number; anti: boolean };
export type Message = { text: string; kind: "info" | "error" };

export type Saved = { v: 1; n: number; sel: number; mode: Mode; shots: number; tape: Entry[] };

let stepId = 0;
const newId = () => `k${Date.now().toString(36)}${(stepId++).toString(36)}`;

/** Show BUSY only when the simulator lags this long (ms), to avoid flicker. */
const BUSY_DELAY = 120;

/**
 * The key-press state machine. Immediate mode: every gate key applies to
 * the register at once. Modifiers (2ND, CTRL marks, ALL) are one-shot and
 * clear after the next gate. Numeric entry is the argument to the next
 * key that takes one (rotations, Q, N, SHOTS).
 *
 * The statevector lives in the Engine (a Web Worker in the app). This class
 * keeps a mirror of its register — n, tape, redo depth — plus the latest
 * view summary, updated as replies arrive.
 */
export class Calculator {
  n: number;
  tape: Entry[];
  redoDepth = 0;
  view: ViewData | null = null;
  busy = false;

  sel = 0;
  entry: Token[] = [];
  shift = false;
  all = false;
  marks: Mark[] = [];
  mode: Mode = "ket";
  shots = 1024;
  /** Bumped to force a fresh shot sample without a state change. */
  shotSeed = 0;
  message: Message | null = null;
  /** CATALOG list open on the LCD, and its highlighted row. */
  catalog = { open: false, index: 0 };
  version = 0;

  /** One slot per in-flight command (replies arrive in send order). */
  private reporters: (((r: Result) => void) | null)[] = [];
  private awaitingView = false;
  private busyTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(readonly engine: Engine, saved?: Saved | null) {
    engine.onResult = (r) => this.onResult(r);
    engine.onView = (v) => this.onView(v);
    const ok = saved && saved.v === 1 && Array.isArray(saved.tape);
    // Mirror the saved session up front so the first save can't clobber it.
    this.n = ok ? saved.n : 2;
    this.tape = ok ? saved.tape : [];
    if (ok) {
      this.sel = Math.max(0, Math.min(saved.sel, saved.n - 1));
      this.mode = saved.mode;
      this.shots = saved.shots;
    }
    this.send({ t: "view", req: this.viewReq() });
    if (ok) this.send({ t: "load", n: saved.n, tape: saved.tape });
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  save(): Saved {
    return { v: 1, n: this.n, sel: this.sel, mode: this.mode, shots: this.shots, tape: this.tape };
  }

  get entryText(): string {
    return toDisplay(this.entry);
  }

  private viewReq() {
    return { mode: this.mode, shots: this.shots, shotSeed: this.shotSeed };
  }

  /** Send a command; `report` runs with its reply unless the reply is an error. */
  private send(cmd: Cmd, report?: (r: Result) => void) {
    this.reporters.push(report ?? null);
    this.awaitingView = true;
    if (!this.busyTimer) {
      this.busyTimer = setTimeout(() => {
        this.busyTimer = null;
        if (this.reporters.length > 0 || this.awaitingView) {
          this.busy = true;
          this.changed();
        }
      }, BUSY_DELAY);
    }
    this.engine.send(cmd);
  }

  private onResult(r: Result) {
    const report = this.reporters.shift();
    this.n = r.n;
    this.tape = r.tape;
    this.redoDepth = r.redo;
    if (this.sel >= r.n) this.sel = r.n - 1;
    this.marks = this.marks.filter((m) => m.q < r.n);
    if (r.error) this.error(r.error);
    else report?.(r);
    this.changed();
  }

  private onView(v: ViewData) {
    // More views follow while commands are still in flight.
    this.awaitingView = this.reporters.length > 0;
    if (!this.awaitingView) {
      this.busy = false;
      if (this.busyTimer) {
        clearTimeout(this.busyTimer);
        this.busyTimer = null;
      }
    }
    this.view = v;
    this.changed();
  }

  setMode(m: Mode) {
    this.message = null;
    if (m === "shots" && this.entry.length > 0) {
      const v = this.takeInt();
      if (v === null) return this.changed();
      if (v < 1 || v > 1_000_000) {
        this.error("shots 1–1000000");
        return this.changed();
      }
      this.shots = v;
    }
    if (m === "shots" && this.mode === "shots") this.shotSeed++;
    this.mode = m;
    this.send({ t: "view", req: this.viewReq() });
    this.changed();
  }

  select(q: number) {
    if (q >= 0 && q < this.n) this.sel = q;
    this.changed();
  }

  press(key: KeyId) {
    this.message = null;
    const id = this.shift ? (SHIFTED[key] ?? key) : key;
    if (key !== "2nd") this.shift = false;
    try {
      this.dispatch(id);
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
    }
    this.changed();
  }

  /** Show a status line from outside the key flow (copy / share results). */
  notify(text: string, kind: Message["kind"] = "info") {
    this.message = { text, kind };
    this.changed();
  }

  private error(text: string) {
    this.message = { text, kind: "error" };
  }

  private info(text: string) {
    this.message = { text, kind: "info" };
  }

  /** Consume the entry as an integer; reports an error and returns null otherwise. */
  private takeInt(): number | null {
    const [expr] = splitArgs(this.entry);
    const v = evalParam(expr);
    this.entry = [];
    if (!Number.isFinite(v) || Math.abs(v - Math.round(v)) > 1e-9) {
      this.error("not an integer");
      return null;
    }
    return Math.round(v);
  }

  /** Keys that behave differently while the CATALOG is open. Returns true if handled. */
  private catalogKey(id: string): boolean {
    const len = CATALOG.length;
    switch (id) {
      case "left": case "n-": this.catalog.index = (this.catalog.index + len - 1) % len; return true;
      case "right": case "n+": this.catalog.index = (this.catalog.index + 1) % len; return true;
      case "eq": this.applyCatalog(this.catalog.index); return true;
      case "cat": this.catalog.open = false; return true;
      case "ac":
        // Never clears the register from inside the catalog.
        if (this.entry.length > 0 || this.marks.length > 0 || this.all) return false;
        this.catalog.open = false;
        return true;
    }
    if (id in GATE_KEYS) this.catalog.open = false;
    return false;
  }

  /** Tap on a catalog row: first tap highlights, a tap on the highlighted row applies. */
  pickCatalog(index: number) {
    this.message = null;
    if (index === this.catalog.index) {
      try {
        this.applyCatalog(index);
      } catch (e) {
        this.error(e instanceof Error ? e.message : String(e));
      }
    } else {
      this.catalog.index = index;
    }
    this.changed();
  }

  private applyCatalog(index: number) {
    const item = CATALOG[index];
    this.gate({ gate: item.gate, arity: item.arity, params: item.params });
    this.catalog.open = false;
  }

  private dispatch(id: string) {
    const n = this.n;
    if (this.catalog.open && this.catalogKey(id)) return;
    if (id in TOKENS) {
      if (this.entry.length < 40) this.entry.push(TOKENS[id]);
      return;
    }
    if (id in GATE_KEYS) return this.gate(GATE_KEYS[id]);

    switch (id) {
      case "2nd": this.shift = !this.shift; return;
      case "left": this.sel = (this.sel + n - 1) % n; return;
      case "right": this.sel = (this.sel + 1) % n; return;
      case "n-": return this.resize(n - 1);
      case "n+": return this.resize(n + 1);
      case "q": {
        if (this.entry.length === 0) return this.error("enter qubit #, then Q");
        const v = this.takeInt();
        if (v === null) return;
        if (v < 0 || v >= n) return this.error(`q0–q${n - 1} only`);
        this.sel = v;
        return;
      }
      case "n": {
        if (this.entry.length === 0) return this.error(`enter 1–${MAX_QUBITS}, then N`);
        const v = this.takeInt();
        if (v !== null) this.resize(v);
        return;
      }
      case "ctrl":
      case "actrl": {
        const anti = id === "actrl";
        const i = this.marks.findIndex((m) => m.q === this.sel);
        if (i >= 0 && this.marks[i].anti === anti) this.marks.splice(i, 1);
        else if (i >= 0) this.marks[i] = { q: this.sel, anti };
        else this.marks.push({ q: this.sel, anti });
        return;
      }
      case "all": this.all = !this.all; return;
      case "cat": this.catalog.open = true; return;
      case "undo":
        return this.send({ t: "undo" }, (r) => this.info(r.done ? `undo ${formatEntry(r.done)}` : "nothing to undo"));
      case "redo":
        return this.send({ t: "redo" }, (r) => this.info(r.done ? `redo ${formatEntry(r.done)}` : "nothing to redo"));
      case "bs": this.entry.pop(); return;
      case "ac": {
        if (this.entry.length > 0 || this.marks.length > 0 || this.all) {
          this.entry = [];
          this.marks = [];
          this.all = false;
          return;
        }
        return this.send({ t: "clear" }, (r) => this.info(`|${"0".repeat(r.n)}⟩`));
      }
      case "eq":
        return this.send({ t: "repeat" }, (r) => r.done && this.info(formatEntry(r.done)));
    }
  }

  /** The entry as `initialize` amplitudes: α,β (real) or Reα,Imα,Reβ,Imβ. */
  private amplitudes(): string {
    const args = splitArgs(this.entry);
    if (this.entry.length === 0 || (args.length !== 2 && args.length !== 4)) throw new Error("enter α,β then |ψ⟩");
    const v = args.map(evalParam);
    if (v.some((x) => !Number.isFinite(x))) throw new Error("syntax error");
    const [ar, ai, br, bi] = v.length === 2 ? [v[0], 0, v[1], 0] : v;
    const norm = Math.hypot(ar, ai, br, bi);
    if (norm < 1e-12) throw new Error("zero state");
    return `(${[ar, ai, br, bi].map((x) => x / norm).join(", ")})`;
  }

  private resize(n: number) {
    if (n < 1 || n > MAX_QUBITS) throw new Error(`n must be 1–${MAX_QUBITS}`);
    this.send({ t: "resize", n }, (r) => this.info(`n = ${r.n}`));
  }

  private gate(k: GateKey) {
    const n = this.n;
    let params = k.params;
    if (k.gate === "initialize") {
      params = [this.amplitudes()];
    } else if (k.params.length > 0 && this.entry.length > 0) {
      const args = splitArgs(this.entry);
      if (args.length > k.params.length) throw new Error(`${k.params.length} argument${k.params.length > 1 ? "s" : ""} max`);
      for (const a of args) if (!Number.isFinite(evalParam(a))) throw new Error("syntax error");
      params = k.params.map((d, i) => args[i] ?? d);
    }
    if (NONUNITARY.has(k.gate) && this.marks.length > 0) throw new Error("can't control a non-unitary");

    const controls = this.marks.map((m) => m.q);
    const controlStates = this.marks.some((m) => m.anti) ? this.marks.map((m) => !m.anti) : undefined;
    const col = this.tape.length;
    const mk = (targets: number[], ctrls: number[], states?: boolean[]): Step => ({
      id: newId(), gateId: k.gate, column: col, targets, controls: ctrls, clbits: [], params,
      ...(states ? { controlStates: states } : {}),
    });

    let entry: Entry;
    if (k.arity === 1) {
      if (!this.all && controls.includes(this.sel)) throw new Error(`q${this.sel} is a control`);
      const targets = this.all ? [...Array(n).keys()].filter((q) => !controls.includes(q)) : [this.sel];
      if (targets.length === 0) throw new Error("no target left");
      entry = targets.map((t) => mk([t], controls, controlStates));
    } else {
      // The last arity−1 marks are the gate's other qubits; earlier marks are controls.
      const need = k.arity - 1;
      if (controls.length < need) {
        throw new Error(need === 1 ? "CTRL-mark a partner qubit first" : `CTRL-mark ${need} partner qubits first`);
      }
      if (this.all) throw new Error("ALL is for 1-qubit gates");
      const partners = controls.slice(-need);
      if (partners.includes(this.sel)) throw new Error("partner = target");
      if (controlStates?.slice(-need).some((on) => !on)) throw new Error("○CTRL can't mark a partner");
      entry = [mk([...partners, this.sel], controls.slice(0, -need), controlStates?.slice(0, -need))];
    }
    if (params !== k.params) this.entry = [];
    this.marks = [];
    this.all = false;
    this.send({ t: "push", entry }, (r) => r.done && this.info(formatEntry(r.done)));
  }
}
