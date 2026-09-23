import { MAX_QUBITS } from "./register";
import { STAB_MAX } from "../stab/register";
import { evalParam, exprOk, formatEntry, NONUNITARY, type Entry, type Scope, type Step } from "./steps";
import { CATALOG, type CatalogItem } from "./catalog";
import { CUSTOM_PREFIX, defineGate, setCustomGates, type CustomGate } from "./custom";
import { blockGate, qaoaLayer, type BlockKind } from "./blocks";
import { matrixGate, parseMatrix, parseState, stateGate } from "./typed";
import { importQasm } from "../qasm/import";
import { stepCaptions } from "../qasm/captions";
import { DEFAULT_NOISE, isIdeal, sanitiseNoise, type NoiseModel } from "../noise/model";
import { ANALYSIS_BY_ID, CATEGORIES, analysesIn } from "../analysis/catalog";
import type { AnalysisReply, AnalysisResult, Opts, Proposal } from "../analysis/types";
import { splitArgs, TOKENS, toDisplay, VARS, varToken, symbolGlyph, type Token } from "./entry";
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
type GateKey = { gate: string; arity: number; params: string[] };
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
  swap: "iswap", meas: "reset", h: "sy", x: "measx", y: "measy", z: "if",
  sx: "sxdg", s: "sdg", t: "tdg", rx: "rxx", ry: "ryy", rz: "rzz",
  p: "u", div: "lparen", mul: "rparen", minus: "plus", pi: "sqrt",
  ".": "tsym", ",": "var", "7": "sin", "8": "cos", "9": "exp", eq: "sto", bs: "rcl",
};

/** A saved register in a memory slot M1–M9. */
export type Memory = { n: number; tape: Entry[]; scope: Scope };

export type Mark = { q: number; anti: boolean };
export type Message = { text: string; kind: "info" | "error" };

export type LabLevel = "cats" | "list" | "view";
export type LabState = { level: LabLevel; cat: number; index: number; id: string | null; opts: Record<string, Opts> };

export type Saved = {
  v: 1; n: number; sel: number; mode: Mode; shots: number; tape: Entry[];
  lab?: LabState; scope?: Scope; memory?: Record<number, Memory>;
  /** Custom gates (DEFINE). */
  gates?: CustomGate[];
  /** The noise model (LAB → Noise). */
  noise?: NoiseModel;
};

/** t playback on the PARAM screen: pull-based (next frame after the last view). */
export type Playback = { name: string; hz: number; startValue: number; startAt: number; frames: number; fps: number };

/** The analysis currently shown in LAB, and where its computation stands. */
export type AnalysisView = {
  id: string;
  status: "busy" | "done";
  result: AnalysisResult | null;
  /** Register revision the result was computed from. */
  rev: number;
  ms: number;
};

/** Restart the analysis worker if it has been busy this long with outdated work. */
const STALE_MS = 150;
/** A "live" analysis slower than this stops auto-refreshing (shows stale · RUN). */
const LIVE_BUDGET_MS = 400;

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
const tapeIds = (tape: Entry[]) => tape.map((e) => e.map((s) => s.id).join(",")).join(";");

export class Calculator {
  n: number;
  tape: Entry[];
  /** Symbol values (ASCII names) and the symbols the tape uses. */
  scope: Scope = {};
  symbols: string[] = [];
  memory: Record<number, Memory> = {};
  /** PARAM screen (symbol sliders) and its highlighted row. */
  param = { open: false, index: 0 };
  playback: Playback | null = null;
  redoDepth = 0;
  view: ViewData | null = null;
  busy = false;

  sel = 0;
  entry: Token[] = [];
  shift = false;
  all = false;
  marks: Mark[] = [];
  /** IF (2ND+Z): the next gate runs only when c[clbit] == value. */
  pendingIf: { clbit: number; value: number } | null = null;
  mode: Mode = "ket";
  shots = 1024;
  /** Bumped to force a fresh shot sample without a state change. */
  shotSeed = 0;
  /** TAPE scrubber: views show the state after this many entries (null = the end). */
  scrub: number | null = null;
  message: Message | null = null;
  /** CATALOG list open on the LCD, and its highlighted row. */
  catalog: { open: boolean; index: number; typing: "state" | "matrix" | null } = { open: false, index: 0, typing: null };
  /** The help screen is open. */
  helpOpen = false;
  /** The AI chat screen (ui/ChatView.tsx). */
  chatOpen = false;
  /** LAB results pinned for the session report (newest last, at most 12; this session only). */
  pins: { title: string; result: AnalysisResult; at: string; steps: number; n: number }[] = [];
  /** The session report overlay, and the live KET view it shows (fetched on open). */
  reportOpen = false;
  reportKet: Extract<ViewData, { mode: "ket" }> | null = null;
  /**
   * Step-through: captions for a loaded example, one per tape entry. It
   * applies while the tape is the one loaded (same step ids); an edit hides
   * it and UNDO brings it back.
   */
  guide: { title: string; intro: string; captions: string[]; ids: string } | null = null;
  /** Custom gates defined with DEFINE (G1, G2, …). */
  customGates: CustomGate[] = [];
  /** The noise model; when on, PROB/BLOCH/SHOTS and the noise analyses use it. */
  noise: NoiseModel = { ...DEFAULT_NOISE };
  /** The latest noisy PROB/BLOCH/SHOTS view (computed in the analysis worker). */
  noisyView: { view: NonNullable<AnalysisResult["view"]> | null; error?: string; rev: number; seq: number } | null = null;
  private vSeq = 0;
  /** LAB browser position and per-analysis options. */
  lab: LabState = { level: "cats", cat: 0, index: 0, id: null, opts: {} };
  analysis: AnalysisView | null = null;
  /** Register revision (from the core); analyses compare against it. */
  rev = 0;
  private aSeq = 0;
  private aInflight: { seq: number; at: number } | null = null;
  private aPending = false;
  version = 0;

  /** One slot per in-flight command (replies arrive in send order). */
  private reporters: (((r: Result) => void) | null)[] = [];
  private awaitingView = false;
  private busyTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(readonly engine: Engine, saved?: Saved | null) {
    engine.onResult = (r) => this.onResult(r);
    engine.onView = (v) => this.onView(v);
    engine.onAnalysis = (r) => this.onAnalysis(r);
    engine.onSync = (r) => this.onSync(r);
    const ok = saved && saved.v === 1 && Array.isArray(saved.tape);
    // Mirror the saved session up front so the first save can't clobber it.
    this.n = ok ? saved.n : 2;
    this.tape = ok ? saved.tape : [];
    if (ok) {
      this.sel = Math.max(0, Math.min(saved.sel, saved.n - 1));
      this.mode = saved.mode;
      this.shots = saved.shots;
      if (saved.lab && typeof saved.lab === "object") this.lab = { ...this.lab, ...saved.lab, opts: saved.lab.opts ?? {} };
      if (saved.scope) this.scope = { ...saved.scope };
      if (saved.memory) this.memory = saved.memory;
      if (Array.isArray(saved.gates)) this.customGates = saved.gates;
      if (saved.noise) this.noise = sanitiseNoise(saved.noise);
    }
    this.send({ t: "view", req: this.viewReq() });
    // Definitions go first: the saved tape may use them.
    if (this.customGates.length) {
      setCustomGates(this.customGates);
      this.send({ t: "gates", defs: this.customGates });
    }
    if (ok) this.send({ t: "load", n: saved.n, tape: saved.tape, scope: saved.scope });
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
    return {
      v: 1, n: this.n, sel: this.sel, mode: this.mode, shots: this.shots, tape: this.tape,
      lab: this.lab, scope: this.scope, memory: this.memory, gates: this.customGates, noise: this.noise,
    };
  }

  get entryText(): string {
    return toDisplay(this.entry);
  }

  private viewReq() {
    return { mode: this.mode, shots: this.shots, shotSeed: this.shotSeed, upTo: this.scrub };
  }

  /** Send a command; `report` runs with its reply unless the reply is an error. */
  private send(cmd: Cmd, report?: (r: Result) => void) {
    if (this.scrub !== null && (cmd.t === "push" || cmd.t === "repeat")) {
      // While scrubbed, a gate goes in at the scrub point and the views follow it.
      const at = this.scrub;
      this.scrub = at + 1;
      this.send({ t: "view", req: this.viewReq() });
      cmd = { t: "insert", at, entry: cmd.t === "push" ? cmd.entry : null };
    } else if (this.scrub !== null && cmd.t !== "view" && cmd.t !== "scope" && cmd.t !== "insert" && cmd.t !== "delete") {
      // Any other edit ends a scrub: views go back to the live state.
      this.scrub = null;
      this.send({ t: "view", req: this.viewReq() });
    }
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
    const changed = r.rev !== this.rev;
    this.rev = r.rev;
    this.n = r.n;
    this.tape = r.tape;
    this.redoDepth = r.redo;
    this.symbols = r.symbols;
    // Keep the local value of a symbol being dragged/played; take the rest.
    this.scope = { ...r.scope, ...this.localScope };
    if (this.sel >= r.n) this.sel = r.n - 1;
    this.marks = this.marks.filter((m) => m.q < r.n);
    if (r.error) this.error(r.error);
    else report?.(r);
    if (!r.error && r.notes?.length) this.info(r.notes[r.notes.length - 1]);
    if (changed) {
      this.refreshLiveAnalysis();
      this.requestNoisyView();
    }
    this.changed();
  }

  /** A register update not tied to a command (deferred symbol replay). */
  private onSync(r: Result) {
    const changed = r.rev !== this.rev;
    this.rev = r.rev;
    this.n = r.n;
    this.tape = r.tape;
    this.redoDepth = r.redo;
    this.symbols = r.symbols;
    this.scope = { ...r.scope, ...this.localScope };
    if (r.notes?.length) this.info(r.notes[r.notes.length - 1]);
    if (changed) {
      this.refreshLiveAnalysis();
      this.requestNoisyView();
    }
    this.changed();
  }

  /** A t-sweep being recorded to video (ui/recorder.ts): frames done of total. */
  recording: { frame: number; frames: number } | null = null;
  private viewWaiters: (() => void)[] = [];

  /** Resolves when the next view from the core arrives (recorder frame pacing). */
  nextView(): Promise<void> {
    return new Promise((resolve) => this.viewWaiters.push(resolve));
  }

  setRecording(r: { frame: number; frames: number } | null) {
    this.recording = r;
    this.changed();
  }

  private onView(v: ViewData) {
    if (this.playback) this.scheduleFrame();
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
    if (this.reportOpen && v.mode === "ket" && v.at === undefined) this.reportKet = v;
    this.changed();
    const waiting = this.viewWaiters;
    this.viewWaiters = [];
    for (const w of waiting) w();
  }

  /** Scrub the views to the state after `k` tape entries (null or ≥ length = live). */
  setScrub(k: number | null) {
    const next = k === null || k >= this.tape.length ? null : Math.max(0, Math.floor(k));
    if (next === this.scrub) return;
    this.scrub = next;
    this.send({ t: "view", req: this.viewReq() });
    this.changed();
  }

  /** Remove the entry the scrubber stands after (the last one when live); undoable. */
  deleteStep() {
    const at = this.scrub ?? this.tape.length;
    if (at === 0) return;
    if (this.scrub !== null) {
      this.scrub = at - 1;
      this.send({ t: "view", req: this.viewReq() });
    }
    const gone = this.tape[at - 1];
    this.send({ t: "delete", at: at - 1 }, () => this.info(`deleted ${at}: ${formatEntry(gone)} (UNDO restores)`));
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
    this.requestNoisyView();
    if (m === "lab" && this.lab.level === "view") this.requestAnalysis();
    this.changed();
  }

  // ─── LAB ────────────────────────────────────────────────────────────

  /** Open an analysis screen (from a tap or = in the list). */
  openAnalysis(id: string) {
    const meta = ANALYSIS_BY_ID[id];
    if (!meta) return;
    const cat = CATEGORIES.findIndex((c) => c.id === meta.category);
    this.lab = { ...this.lab, level: "view", id, cat, index: analysesIn(meta.category).findIndex((a) => a.id === id) };
    this.analysis = null;
    this.requestAnalysis();
    this.changed();
  }

  labOpts(id: string): Opts {
    return this.lab.opts[id] ?? {};
  }

  setLabOpts(id: string, patch: Opts) {
    this.lab = { ...this.lab, opts: { ...this.lab.opts, [id]: { ...this.labOpts(id), ...patch } } };
    if (this.lab.id === id) this.requestAnalysis();
    this.changed();
  }

  labBack() {
    const lvl = this.lab.level;
    this.lab = lvl === "view" ? { ...this.lab, level: "list" } : { ...this.lab, level: "cats", index: this.lab.cat };
    if (lvl === "view") {
      this.analysis = null;
      this.engine.cancelAnalysis();
      this.aInflight = null;
      this.aPending = false;
    }
    this.changed();
  }

  labPick(level: "cats" | "list", index: number) {
    if (level === "cats") this.lab = { ...this.lab, level: "list", cat: index, index: 0 };
    else {
      const a = analysesIn(CATEGORIES[this.lab.cat].id)[index];
      if (a) return this.openAnalysis(a.id);
    }
    this.changed();
  }

  /** Run (or re-run) the open analysis. Latest request wins. */
  requestAnalysis() {
    const id = this.lab.id;
    if (!id || this.lab.level !== "view") return;
    const now = Date.now();
    if (this.aInflight) {
      // Outdated work still running: abandon it if it has taken a while,
      // otherwise wait for it and send the newest request afterwards.
      if (now - this.aInflight.at > STALE_MS) {
        this.engine.cancelAnalysis();
        this.aInflight = null;
      } else {
        this.aPending = true;
        return;
      }
    }
    const seq = ++this.aSeq;
    this.aInflight = { seq, at: now };
    this.aPending = false;
    this.analysis = { id, status: "busy", result: this.analysis?.id === id ? this.analysis.result : null, rev: this.analysis?.rev ?? -1, ms: 0 };
    // Compare reads a memory slot, which lives here, not in the workers.
    const opts = id === "compare" ? { ...this.labOpts(id), other: this.memory[Number(this.labOpts(id).slot) || 1] } : this.labOpts(id);
    this.engine.analyze({ seq, id, opts, noise: this.noiseOn ? this.noise : undefined });
  }

  /** True when the noise model is on and does something. */
  get noiseOn(): boolean {
    return !isIdeal(this.noise);
  }

  /** Change the noise model (sanitised); views and the open analysis follow. */
  setNoise(patch: Partial<NoiseModel>) {
    this.noise = sanitiseNoise({ ...this.noise, ...patch });
    this.noisyView = null;
    this.requestNoisyView();
    if (this.mode === "lab") this.requestAnalysis();
    this.changed();
  }

  /** PROB/BLOCH/SHOTS under noise: computed off the key path, in the analysis worker. */
  private requestNoisyView() {
    if (!this.noiseOn || !["prob", "bloch", "shots"].includes(this.mode)) return;
    const seq = ++this.vSeq;
    this.engine.analyze({ seq, id: "__view", opts: { mode: this.mode, shots: this.shots, seed: this.shotSeed }, noise: this.noise });
  }

  cancelAnalysis() {
    this.engine.cancelAnalysis();
    this.aInflight = null;
    this.aPending = false;
    if (this.analysis) this.analysis = { ...this.analysis, status: "done" };
    this.changed();
  }

  private refreshLiveAnalysis() {
    const id = this.lab.id;
    if (this.mode !== "lab" || this.lab.level !== "view" || !id) return;
    if (ANALYSIS_BY_ID[id]?.mode !== "live") return;
    // Too slow to recompute on every key press at this size: wait for RUN.
    if (this.analysis?.id === id && this.analysis.ms > LIVE_BUDGET_MS) return;
    this.requestAnalysis();
  }

  private onAnalysis(r: AnalysisReply) {
    if (r.id === "__view") {
      if (r.seq === this.vSeq) this.noisyView = { view: r.result.view ?? null, error: r.result.error, rev: r.rev, seq: r.seq };
      this.changed();
      return;
    }
    if (this.aInflight?.seq === r.seq) this.aInflight = null;
    // Ignore replies for another analysis or one superseded by a newer reply.
    if (r.id === this.lab.id && r.seq >= (this.lastShownSeq ?? 0)) {
      this.lastShownSeq = r.seq;
      this.analysis = { id: r.id, status: this.aPending ? "busy" : "done", result: r.result, rev: r.rev, ms: r.ms };
    }
    if (this.aPending) this.requestAnalysis();
    this.changed();
  }

  private lastShownSeq = 0;

  /** Keys that behave differently while browsing LAB. Returns true if handled. */
  private labKey(id: string): boolean {
    const { level } = this.lab;
    if (level === "view") {
      // AC never clears the register from LAB: it clears the entry, then goes back.
      if (id === "ac" && this.entry.length === 0 && this.marks.length === 0 && !this.all) {
        this.labBack();
        return true;
      }
      return false;
    }
    const len = level === "cats" ? CATEGORIES.length : analysesIn(CATEGORIES[this.lab.cat].id).length;
    // Categories with nothing in them yet are skipped.
    const usable = (i: number) => level !== "cats" || analysesIn(CATEGORIES[i].id).length > 0;
    const step = (d: number) => {
      let i = this.lab.index;
      for (let k = 0; k < len; k++) {
        i = (i + d + len) % len;
        if (usable(i)) break;
      }
      this.lab = { ...this.lab, index: i };
    };
    switch (id) {
      case "left": step(-1); return true;
      case "right": step(1); return true;
      case "eq": this.labPick(level, this.lab.index); return true;
      case "ac":
        if (this.entry.length > 0 || this.marks.length > 0 || this.all) return false;
        if (level === "list") this.labBack();
        return true;
    }
    return false;
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
      if (this.param.open && this.paramKey(id)) return this.changed();
      if (this.mode === "lab" && !this.catalog.open && this.labKey(id)) return this.changed();
      this.dispatch(id);
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
    }
    if (key !== "2nd") this.lastKey = id;
    this.changed();
  }

  private lastKey = "";
  /** Symbol values set locally (slider, playback) and not yet confirmed by the core. */
  private localScope: Scope = {};

  // ─── Symbols and the PARAM screen ─────────────────────────────────

  openParams() {
    this.param = { open: true, index: Math.min(this.param.index, Math.max(0, this.symbols.length - 1)) };
    this.changed();
  }

  /** Close PARAM; a running t playback keeps going (watch it in any view). */
  closeParams() {
    this.param = { ...this.param, open: false };
    this.changed();
  }

  /** Set one symbol's value (slider, keypad, playback). Coalesced in the core. */
  setSymbol(name: string, value: number) {
    this.scope = { ...this.scope, [name]: value };
    this.localScope[name] = value;
    this.send({ t: "scope", values: { [name]: value } }, () => {
      if (this.localScope[name] === value) delete this.localScope[name];
    });
    this.changed();
  }

  /** Set several symbols at once (e.g. the optimizer's result). */
  /**
   * Load an OpenQASM program (import, example, share link) as one undoable
   * replace. Its gate definitions join the custom gates; `scope` sets symbol
   * values (others start at 0). Returns the importer's notes, or throws its
   * error (with the line).
   */
  loadQasm(src: string, label: string, scope: Scope = {}, guide?: { title: string; intro: string }): string[] {
    const r = importQasm(src, this.customGates);
    this.guide = guide ? { ...guide, captions: stepCaptions(src, r.lines), ids: tapeIds(r.tape) } : null;
    if (r.gates.length) {
      this.customGates = [...this.customGates, ...r.gates];
      setCustomGates(this.customGates);
      this.send({ t: "gates", defs: this.customGates });
    }
    this.sel = Math.min(this.sel, r.n - 1);
    this.send({ t: "replace", n: r.n, tape: r.tape, scope: { ...scope }, label }, () => this.info(`${label}: ${r.tape.length} steps, n=${r.n}`));
    if (guide && r.tape.length) {
      // Start before the first step (set directly: the mirrored tape isn't updated yet).
      this.scrub = 0;
      this.send({ t: "view", req: this.viewReq() });
    }
    this.changed();
    return r.notes;
  }

  /** The step-through guide, while the tape is still the one it was made for. */
  get activeGuide() {
    return this.guide && this.guide.ids === tapeIds(this.tape) ? this.guide : null;
  }

  endGuide() {
    this.guide = null;
    this.setScrub(null);
    this.changed();
  }

  /** Replace the tape by a circuit tool's verified output (one undoable step). */
  applyProposal(p: Proposal) {
    if (!p.verified) return;
    const label = this.lab.id ? ANALYSIS_BY_ID[this.lab.id]?.title ?? "tool" : "tool";
    // Symbols the new tape uses keep their values; new ones start at 0 in the register.
    this.send({ t: "replace", n: p.n, tape: p.tape, scope: { ...this.scope }, label }, () => this.info(`${label}: ${p.tape.length} steps`));
    this.changed();
  }

  applyScope(values: Scope) {
    for (const [k, v] of Object.entries(values)) this.setSymbol(k, v);
    this.info(`set ${Object.entries(values).map(([k, v]) => `${symbolGlyph(k)}=${v.toFixed(3)}`).join(" ")}`);
    this.changed();
  }

  /** Keys on the PARAM screen: ◀ ▶ pick a symbol, = sets it from the entry. */
  private paramKey(id: string): boolean {
    const len = this.symbols.length;
    switch (id) {
      case "left": case "right":
        if (len) this.param = { ...this.param, index: (this.param.index + (id === "left" ? len - 1 : 1)) % len };
        return true;
      case "eq": {
        const name = this.symbols[this.param.index];
        if (!name || this.entry.length === 0) return true;
        const [expr] = splitArgs(this.entry);
        const v = evalParam(expr, this.scope);
        this.entry = [];
        if (Number.isFinite(v)) this.setSymbol(name, v);
        else this.error("not a number");
        return true;
      }
    }
    return false;
  }

  togglePlayback(name = "t", hz = this.playback?.hz ?? 0.25) {
    if (this.playback) return this.stopPlayback();
    this.playback = { name, hz, startValue: this.scope[name] ?? 0, startAt: Date.now(), frames: 0, fps: 0 };
    this.scheduleFrame();
    this.changed();
  }

  setPlaybackSpeed(hz: number) {
    if (!this.playback) return;
    const { name } = this.playback;
    this.playback = { name, hz, startValue: this.scope[name] ?? 0, startAt: Date.now(), frames: 0, fps: this.playback.fps };
    this.changed();
  }

  stopPlayback() {
    this.playback = null;
    this.changed();
  }

  private frameQueued = false;
  /** Advance the played symbol to wall-clock time. Pull-based: called after each view. */
  private scheduleFrame() {
    const pb = this.playback;
    if (!pb || this.frameQueued) return;
    this.frameQueued = true;
    setTimeout(() => {
      this.frameQueued = false;
      const cur = this.playback;
      if (!cur) return;
      const secs = (Date.now() - cur.startAt) / 1000;
      const v = (cur.startValue + 2 * Math.PI * cur.hz * secs) % (2 * Math.PI);
      cur.frames++;
      cur.fps = secs > 0.5 ? cur.frames / secs : cur.fps;
      this.setSymbol(cur.name, v);
    }, 16);
  }

  /** Memory slot 1–9 from the entry line (STO/RCL argument). */
  private slotFromEntry(what: string): number | null {
    if (this.entry.length === 0) {
      this.error(`enter 1–9, then ${what}`);
      return null;
    }
    const k = this.takeInt();
    if (k === null) return null;
    if (k < 1 || k > 9) {
      this.error("memory M1–M9");
      return null;
    }
    return k;
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
    const len = this.catalogItems.length;
    switch (id) {
      case "left": case "n-": this.catalog.index = (this.catalog.index + len - 1) % len; return true;
      case "right": case "n+": this.catalog.index = (this.catalog.index + 1) % len; return true;
      case "eq": this.applyCatalog(this.catalog.index); return true;
      case "cat": this.catalog.open = false; this.catalog.typing = null; return true;
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

  /** CATALOG rows: the built-in gates, then the custom gates and DEFINE. */
  get catalogItems(): CatalogItem[] {
    return [
      ...CATALOG,
      ...this.customGates.map((d): CatalogItem => ({
        gate: CUSTOM_PREFIX + d.name, label: d.name, group: "CUSTOM", arity: d.k, params: [], argNames: [],
        note: `${d.tape.length} step${d.tape.length > 1 ? "s" : ""} on ${d.k} qubit${d.k > 1 ? "s" : ""}`,
      })),
      {
        gate: "define", label: "DEFINE", group: "CUSTOM", arity: 1, params: [], argNames: [],
        note: "the last k steps (entry k, else the whole tape) as a new gate",
      },
    ];
  }

  private applyCatalog(index: number) {
    const item = this.catalogItems[index];
    if (item.gate === "define") this.define();
    else if (item.gate.startsWith("block:")) this.block(item.gate.slice(6) as BlockKind, item.params);
    else if (item.gate.startsWith("typed:")) {
      this.catalog.typing = item.gate.slice(6) as "state" | "matrix";
      return; // the CATALOG stays open with its text field
    }
    else this.gate({ gate: item.gate, arity: item.arity, params: item.params });
    this.catalog.open = false;
  }

  /**
   * An algorithm block (calc/blocks.ts) on the CTRL-marked qubits plus the
   * selected one, ascending (the first is the most significant), or on every
   * qubit when nothing is marked. QFT, QFT† and the diffuser are custom gates
   * (QFT3…), defined on first use; QAOA is two entries taking the entry γ,β.
   */
  private block(kind: BlockKind, defaults: string[]) {
    if (this.marks.some((m) => m.anti)) throw new Error("blocks take CTRL marks, not ○CTRL");
    const qs = this.marks.length ? [...new Set([...this.marks.map((m) => m.q), this.sel])].sort((a, b) => a - b) : [...Array(this.n).keys()];
    if (this.pendingIf) throw new Error("IF applies to a single gate");
    if (kind === "qaoa") {
      if (qs.length < 2) throw new Error("QAOA needs 2+ qubits");
      const args = this.entry.length ? splitArgs(this.entry) : [];
      if (args.length > 2) throw new Error("γ,β");
      for (const a of args) if (!exprOk(a)) throw new Error("syntax error");
      const [gamma, beta] = [args[0] ?? defaults[0], args[1] ?? defaults[1]];
      this.entry = [];
      this.marks = [];
      for (const e of qaoaLayer(qs, gamma, beta)) {
        const entry = e.map((s) => ({ ...s, id: newId(), column: this.tape.length }));
        this.send({ t: "push", entry }, (r) => r.done && this.info(`QAOA layer (γ=${gamma}, β=${beta})`));
      }
      return;
    }
    const def = blockGate(kind, qs.length);
    const same = (a: CustomGate) => JSON.stringify(a.tape.map((e) => e.map(({ id: _, ...s }) => s))) === JSON.stringify(def.tape.map((e) => e.map(({ id: _, ...s }) => s)));
    const taken = this.customGates.find((d) => d.name === def.name);
    if (taken && !same(taken)) throw new Error(`${def.name} is another gate here (imported?)`);
    if (!taken) {
      this.customGates = [...this.customGates, def];
      setCustomGates(this.customGates);
      this.send({ t: "gates", defs: this.customGates });
    }
    this.marks = [];
    this.all = false;
    const entry: Entry = [{ id: newId(), gateId: CUSTOM_PREFIX + def.name, column: this.tape.length, targets: qs, controls: [], clbits: [], params: [] }];
    this.send({ t: "push", entry }, (r) => r.done && this.info(formatEntry(r.done)));
  }

  /** Cancel the CATALOG's STATE…/MATRIX… text field. */
  cancelTyped() {
    this.catalog.typing = null;
    this.changed();
  }

  /**
   * STATE…/MATRIX… (calc/typed.ts): the typed text becomes gate PSIj or Mj,
   * placed on the CTRL-marked qubits plus the selected one (ascending), or on
   * q0…q(k−1). A state is "reset, then prepare". Throws with a message the
   * text field shows; on success the CATALOG closes.
   */
  enterTyped(text: string) {
    const kind = this.catalog.typing;
    if (!kind) return;
    const parsed = kind === "state" ? parseState(text) : parseMatrix(text);
    const k = parsed.k;
    const qs = this.marks.length ? [...new Set([...this.marks.map((m) => m.q), this.sel])].sort((a, b) => a - b) : [...Array(k).keys()];
    if (qs.length !== k) throw new Error(`the ${kind} is on ${k} qubit${k > 1 ? "s" : ""}; ${qs.length} marked`);
    if (k > this.n) throw new Error(`needs ${k} qubits: set N first`);
    if (this.marks.some((m) => m.anti)) throw new Error("mark with CTRL, not ○CTRL");
    const prefix = kind === "state" ? "PSI" : "M";
    let j = 1;
    while (this.customGates.some((d) => d.name === `${prefix}${j}`)) j++;
    const def = kind === "state" ? stateGate(`PSI${j}`, parsed as ReturnType<typeof parseState>) : matrixGate(`M${j}`, parsed as ReturnType<typeof parseMatrix>);
    this.customGates = [...this.customGates, def];
    setCustomGates(this.customGates);
    this.send({ t: "gates", defs: this.customGates });
    this.marks = [];
    this.all = false;
    this.pendingIf = null;
    const col = this.tape.length;
    if (kind === "state") {
      this.send({ t: "push", entry: qs.map((q) => ({ id: newId(), gateId: "reset", column: col, targets: [q], controls: [], clbits: [], params: [] })) });
    }
    const entry: Entry = [{ id: newId(), gateId: CUSTOM_PREFIX + def.name, column: col, targets: qs, controls: [], clbits: [], params: [] }];
    const drift = "drift" in parsed && parsed.drift > 1e-12 ? ` (made exactly unitary: it was off by ${parsed.drift.toPrecision(2)})` : "";
    this.send({ t: "push", entry }, (r) => r.done && this.info(`${formatEntry(r.done)}${drift}`));
    this.catalog.typing = null;
    this.catalog.open = false;
    this.changed();
  }

  /** DEFINE: the last k tape entries (entry k, else all) become gate G#. */
  private define() {
    let k = this.tape.length;
    if (this.entry.length > 0) {
      const v = this.takeInt();
      if (v === null) return;
      k = v;
    }
    if (k < 1 || k > this.tape.length) throw new Error(this.tape.length ? `k = 1–${this.tape.length}` : "the tape is empty");
    const entries = this.tape.slice(-k);
    if (entries.some((e) => e.some((s) => NONUNITARY.has(s.gateId)))) throw new Error("a gate can't measure, reset or prepare");
    let i = 1;
    while (this.customGates.some((d) => d.name === `G${i}`)) i++;
    const def = defineGate(`G${i}`, entries);
    this.customGates = [...this.customGates, def];
    setCustomGates(this.customGates);
    this.send({ t: "gates", defs: this.customGates });
    this.info(`G${i} = ${k} step${k > 1 ? "s" : ""} on ${def.k} qubit${def.k > 1 ? "s" : ""} (CATALOG)`);
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
        if (this.entry.length === 0) return this.error(`enter 1–${STAB_MAX}, then N (above ${MAX_QUBITS}: Clifford tapes)`);
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
      case "cat": this.catalog.open = true; this.catalog.typing = null; return;
      case "if": {
        // Entry "k" or "k,v": the next gate runs only if c[k] == v (v = 1 by default).
        if (this.pendingIf && this.entry.length === 0) {
          this.pendingIf = null;
          return this.info("IF off");
        }
        const args = splitArgs(this.entry).map((a) => Number(a));
        const [k, v = 1] = args;
        if (args.length === 0 || args.length > 2 || !Number.isInteger(k) || k < 0 || k >= n || (v !== 0 && v !== 1)) {
          return this.error(`IF: enter k or k,v (bit c[k] of q${0}–q${n - 1}, v = 0/1)`);
        }
        this.entry = [];
        this.pendingIf = { clbit: k, value: v };
        return this.info(`next gate only if c[${k}] = ${v}`);
      }
      case "undo":
        return this.send({ t: "undo" }, (r) => this.info(r.op ? `undo ${opLabel(r.op)}` : "nothing to undo"));
      case "redo":
        return this.send({ t: "redo" }, (r) => this.info(r.op ? `redo ${opLabel(r.op)}` : "nothing to redo"));
      case "var": {
        // Repeated 2ND+, cycles the symbol just inserted: θ → φ → λ → …
        const last = this.entry[this.entry.length - 1];
        const i = last ? VARS.indexOf(last.disp) : -1;
        if (this.lastKey === "var" && i >= 0) this.entry[this.entry.length - 1] = varToken(VARS[(i + 1) % VARS.length]);
        else if (this.entry.length < 40) this.entry.push(varToken(VARS[0]));
        return;
      }
      case "sto": {
        const k = this.slotFromEntry("STO");
        if (k === null) return;
        this.memory = { ...this.memory, [k]: { n: this.n, tape: [...this.tape], scope: { ...this.scope } } };
        return this.info(`M${k} ← ${this.tape.length} steps, n=${this.n}`);
      }
      case "rcl": {
        const k = this.slotFromEntry("RCL");
        if (k === null) return;
        const m = this.memory[k];
        if (!m) return this.error(`M${k} is empty`);
        return this.send({ t: "replace", n: m.n, tape: m.tape, scope: m.scope, label: `RCL M${k}` }, () => this.info(`RCL M${k}`));
      }
      case "bs": this.entry.pop(); return;
      case "ac": {
        if (this.param.open && this.entry.length === 0) {
          this.closeParams();
          return;
        }
        if (this.entry.length > 0 || this.marks.length > 0 || this.all || this.pendingIf) {
          this.entry = [];
          this.marks = [];
          this.all = false;
          this.pendingIf = null;
          return;
        }
        return this.send({ t: "clear" }, (r) => this.info(`|${"0".repeat(r.n)}⟩ (UNDO restores)`));
      }
      case "eq":
        return this.send({ t: "repeat" }, (r) => r.done && this.info(formatEntry(r.done)));
    }
  }

  /** The entry as `initialize` amplitudes: α,β (real) or Reα,Imα,Reβ,Imβ. */
  private amplitudes(): string {
    const args = splitArgs(this.entry);
    if (this.entry.length === 0 || (args.length !== 2 && args.length !== 4)) throw new Error("enter α,β then |ψ⟩");
    const v = args.map((a) => evalParam(a));
    if (v.some((x) => !Number.isFinite(x))) throw new Error("syntax error");
    const [ar, ai, br, bi] = v.length === 2 ? [v[0], 0, v[1], 0] : v;
    const norm = Math.hypot(ar, ai, br, bi);
    if (norm < 1e-12) throw new Error("zero state");
    return `(${[ar, ai, br, bi].map((x) => x / norm).join(", ")})`;
  }

  private resize(n: number) {
    if (n < 1 || n > STAB_MAX) throw new Error(`n must be 1–${STAB_MAX}`);
    this.send({ t: "resize", n }, (r) => this.info(r.n > MAX_QUBITS ? `n = ${r.n} · stabilizer mode (Clifford gates only)` : `n = ${r.n}`));
  }

  /** Pin the LAB result on screen to the session report. */
  pinAnalysis() {
    const a = this.analysis;
    if (!a?.result || a.result.error) return;
    const title = ANALYSIS_BY_ID[a.id]?.title ?? a.id;
    this.pins = [...this.pins.slice(-11), { title, result: a.result, at: new Date().toLocaleTimeString(), steps: this.tape.length, n: this.n }];
    this.info(`pinned to the report (${this.pins.length}): TAPE ≡ → Report`);
    this.changed();
  }

  unpin(i: number) {
    this.pins = this.pins.filter((_, k) => k !== i);
    this.changed();
  }

  /** Open or close the report. Opening asks the core for a KET view of the live state; closing restores the mode's view. */
  toggleReport() {
    this.reportOpen = !this.reportOpen;
    this.reportKet = null;
    this.send({ t: "view", req: this.reportOpen ? { ...this.viewReq(), mode: "ket", upTo: null } : this.viewReq() });
    this.changed();
  }

  toggleChat() {
    this.chatOpen = !this.chatOpen;
    this.changed();
  }

  toggleHelp() {
    this.helpOpen = !this.helpOpen;
    this.changed();
  }

  /** Above 20 qubits the register is a stabilizer tableau. */
  get stabilizerMode(): boolean {
    return this.n > MAX_QUBITS;
  }

  private gate(k: GateKey) {
    const n = this.n;
    let params = k.params;
    if (k.gate === "initialize") {
      params = [this.amplitudes()];
    } else if (k.params.length > 0 && this.entry.length > 0) {
      const args = splitArgs(this.entry);
      if (args.length > k.params.length) throw new Error(`${k.params.length} argument${k.params.length > 1 ? "s" : ""} max`);
      for (const a of args) if (!exprOk(a)) throw new Error("syntax error");
      params = k.params.map((d, i) => args[i] ?? d);
    }
    if (NONUNITARY.has(k.gate) && this.marks.length > 0) throw new Error("can't control a non-unitary");

    const controls = this.marks.map((m) => m.q);
    const controlStates = this.marks.some((m) => m.anti) ? this.marks.map((m) => !m.anti) : undefined;
    const col = this.tape.length;
    const cond = this.pendingIf;
    const mk = (targets: number[], ctrls: number[], states?: boolean[]): Step => ({
      id: newId(), gateId: k.gate, column: col, targets, controls: ctrls, clbits: [], params,
      ...(states ? { controlStates: states } : {}),
      ...(cond ? { condition: { ...cond } } : {}),
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
    this.pendingIf = null;
    this.send({ t: "push", entry }, (r) => r.done && this.info(formatEntry(r.done)));
  }
}

/** Short label of an undone/redone operation. */
function opLabel(op: NonNullable<Result["op"]>): string {
  return op.k === "entry" ? formatEntry(op.entry) : op.label;
}

export { symbolGlyph };
