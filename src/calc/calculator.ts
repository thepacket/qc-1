import { MAX_QUBITS } from "./register";
import { STAB_MAX } from "../stab/register";
import { canonicalName } from "./entry";
import { bitCount, evalParam, exprOk, formatEntry, NONUNITARY, plainExpr, writesBit, type Entry, type Scope, type Step } from "./steps";
import { CUSTOM_PREFIX, defineGate, expandCustom, setCustomGates, type CustomGate } from "./custom";
import { BLOCK_BY_ID, defaultSettings, describe as describeBlock, type Settings } from "./blockLib";
import { inverseGates } from "./inverse";
import { layoutTape } from "./diagram";
import {
  compact, copyEntries, endColumn, entriesIn, expandAt, freeColumn, groupEntries, moveEntry, pasteClip, placeEntry, removeEntries,
  repositionEntry, shape, type Clip,
} from "./grid";
import { matrixGate, parseComplex, parseMatrix, parseState, stateGate } from "./typed";
import { importQasm, invert } from "../qasm/import";
import { baseArity, BASE_ARITY, paramDefs, spanFrom, type PaletteItem } from "./gateSpecs";
import { GATES_BY_ID } from "../sim/gates";
import { stepCaptions } from "../qasm/captions";
import { DEFAULT_NOISE, isIdeal, sanitiseNoise, type NoiseModel } from "../noise/model";
import { ANALYSIS_BY_ID, CATEGORIES, FROM_LOCAL, FROM_SHOTS, FROM_TOMOGRAPHY, analysesIn, searchAnalyses } from "../analysis/catalog";

/** LAB panels that a periodic run's shots feed (Z sample or state tomography). */
const fromRun = (id: string) => FROM_SHOTS.has(id) || FROM_TOMOGRAPHY.has(id) || FROM_LOCAL.has(id);
import type { AnalysisMeta } from "../analysis/types";
import type { AnalysisReply, AnalysisResult, Opts, Proposal } from "../analysis/types";
import { symbolGlyph } from "./entry";
import type { Cmd, Mode, Result, ViewData } from "./core";
import type { Engine } from "./engine";

/** A typed angle: displayed text (π÷4, 2θ, γ₀) and phone spellings (gamma0, γ1) read as the canonical expression. */
const readExpr = (p: string) => {
  const kept = p.replace(/[A-Za-z_][A-Za-z0-9_]*/g, canonicalName);
  return exprOk(kept) ? kept : plainExpr(p);
};

export type { Mode };

/** Classical bits at most (the classical register, like the stabilizer register's qubits). */
export const MAX_CBITS = 1024;

/** Core commands that change the circuit: sending one clears an error message. */
const EDITS = new Set<Cmd["t"]>(["push", "insert", "replace", "delete", "undo", "redo", "clear", "resize", "repeat"]);

/** How a gate is placed (editing API). */
export type GateOpts = {
  targets: number[]; controls?: number[]; controlStates?: boolean[]; params?: string[];
  condition?: { clbit: number; value: 0 | 1 };
  /** Tape index to insert at (default: the insertion point). */
  at?: number;
  /** Diagram column to drop it in (the grid editor): the first free column there or right of it. */
  col?: number;
};

/** A saved register in a memory slot M1–M9. */
export type Memory = { n: number; tape: Entry[]; scope: Scope };

/**
 * The entry line's message. "info" is a key's echo (kept for tests and
 * screen readers, not shown); "note" is shown small (importer warnings,
 * re-sampled outcomes, confirmations of menu actions); "error" as an error.
 */
export type Message = { text: string; kind: "info" | "note" | "error" };

export type LabLevel = "cats" | "list" | "view";
/**
 * LAB navigation. `group` is a category id, or "fav" (★ Favourites), "recent"
 * or "search" (the query's matches). `index` is the lit row of the current level.
 */
export type LabState = {
  level: LabLevel; group: string; index: number; id: string | null; opts: Record<string, Opts>;
  favs: string[]; recent: string[]; query: string;
};
export type LabGroup = { id: string; label: string; items: AnalysisMeta[] };
const RECENT_MAX = 8;
/** Periodic SHOTS runs per second: from one every 10 s to 20 a second. */
export const SHOT_RATE: [number, number] = [0.1, 20];

export type Saved = {
  v: 1; n: number; sel: number; mode: Mode; shots: number; tape: Entry[];
  lab?: LabState; scope?: Scope; memory?: Record<number, Memory>;
  /** Custom gates (DEFINE). */
  gates?: CustomGate[];
  /** SHOTS: periodic runs (on/off) and their rate, runs per second. */
  autoShots?: boolean;
  experimentMode?: "simulation" | "hardware";
  shotRate?: number;
  /** SHOTS: undo the noise model's readout confusion in the estimates. */
  mitigateReadout?: boolean;
  /** The noise model (LAB → Noise). */
  noise?: NoiseModel;
  /** Classical bits declared (default: one per qubit). */
  nc?: number;
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
 * The app's state and its editing API. Every edit (a gate placed from the
 * palette, a drag, an Inspector change) goes through the core as a command,
 * so each is one UNDO.
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
  mode: Mode = "ket";
  shots = 1024;
  /** Bumped to force a fresh shot sample without a state change. */
  shotSeed = 0;
  /** TAPE scrubber: views show the state after this many entries (null = the end). */
  scrub: number | null = null;
  message: Message | null = null;
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
  lab: LabState = { level: "cats", group: "state", index: 2, id: null, opts: {}, favs: [], recent: [], query: "" };
  analysis: AnalysisView | null = null;
  /** Register revision (from the core); analyses compare against it. */
  rev = 0;
  private aSeq = 0;
  private aInflight: { seq: number; at: number } | null = null;
  private aPending = false;
  version = 0;

  /** One slot per in-flight command (replies arrive in send order). */
  private reporters: (((r: Result) => void) | null)[] = [];
  /** Alongside `reporters`: what to undo if that command fails (a refused insert's scrub advance). */
  private failures: ((() => void) | null)[] = [];
  private awaitingView = false;
  private busyTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  /** A saved session is being loaded (its reply hasn't arrived yet). */
  private restoring = false;

  constructor(readonly engine: Engine, saved?: Saved | null) {
    engine.onResult = (r) => this.onResult(r);
    engine.onView = (v) => this.onView(v);
    engine.onAnalysis = (r) => this.onAnalysis(r);
    engine.onSync = (r) => this.onSync(r);
    const ok = saved && saved.v === 1 && Array.isArray(saved.tape);
    this.restoring = !!ok; // before the first command: its reply comes from the default register
    // Mirror the saved session up front so the first save can't clobber it.
    this.n = ok ? saved.n : 2;
    this.tape = ok ? saved.tape : [];
    if (ok) {
      this.sel = Math.max(0, Math.min(saved.sel, saved.n - 1));
      this.mode = saved.mode;
      this.shots = saved.shots;
      if (typeof saved.autoShots === "boolean") this.autoShots = saved.autoShots;
      this.experimentMode = saved.experimentMode === "hardware" || (saved.experimentMode === undefined && this.autoShots) ? "hardware" : "simulation";
      if (this.experimentMode === "simulation") this.autoShots = false;
      if (typeof saved.mitigateReadout === "boolean") this.mitigateReadout = saved.mitigateReadout;
      if (typeof saved.shotRate === "number" && saved.shotRate >= SHOT_RATE[0] && saved.shotRate <= SHOT_RATE[1]) this.shotRate = saved.shotRate;
      if (saved.lab && typeof saved.lab === "object") {
        const l = saved.lab as Partial<LabState>;
        const ids = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string" && i in ANALYSIS_BY_ID) : []);
        this.lab = { ...this.lab, opts: l.opts ?? {}, favs: ids(l.favs), recent: ids(l.recent) };
        // Sessions from before groups kept a category index: reopen the panel, else start at the list of groups.
        if (l.level === "view" && l.id && ANALYSIS_BY_ID[l.id]) {
          const home = ANALYSIS_BY_ID[l.id].category;
          this.lab = { ...this.lab, level: "view", id: l.id, group: home, index: Math.max(0, analysesIn(home).findIndex((a) => a.id === l.id)) };
        }
      }
      if (saved.scope) this.scope = { ...saved.scope };
      if (saved.memory) this.memory = saved.memory;
      if (Array.isArray(saved.gates)) this.customGates = saved.gates;
      if (saved.noise) this.noise = sanitiseNoise(saved.noise);
      // Sessions from before the classical register had one bit per qubit.
      this.nc = Number.isInteger(saved.nc) && saved.nc! >= 0 && saved.nc! <= MAX_CBITS ? saved.nc! : saved.n;
    }
    this.send({ t: "view", req: this.viewReq() });
    // Definitions go first: the saved tape may use them.
    if (this.customGates.length) this.setGates(this.customGates);
    if (ok) {
      this.send({ t: "load", n: saved.n, tape: saved.tape, scope: saved.scope }, () => { this.restoring = false; });
    }
    if (this.autoShots) this.startShotLoop();
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
      v: 1, n: this.n, sel: this.sel, mode: this.mode, shots: this.shots, tape: this.tape, autoShots: this.autoShots, experimentMode: this.experimentMode, shotRate: this.shotRate, mitigateReadout: this.mitigateReadout,
      lab: this.lab, scope: this.scope, memory: this.memory, gates: this.customGates, noise: this.noise, nc: this.nc,
    };
  }

  private viewReq() {
    return { mode: this.mode, shots: this.shots, shotSeed: this.shotSeed, upTo: this.scrub, estimate: this.estimating };
  }

  /** Send a command; `report` runs with its reply unless the reply is an error. */
  private send(cmd: Cmd, report?: (r: Result) => void) {
    // An edit that goes through ends what an earlier refusal was about: its error goes.
    if (EDITS.has(cmd.t)) this.clearError();
    let fail: (() => void) | null = null;
    if (this.scrub !== null && (cmd.t === "push" || cmd.t === "repeat")) {
      // While scrubbed, a gate goes in at the scrub point and the views follow it.
      const at = this.scrub;
      this.scrub = at + 1;
      this.send({ t: "view", req: this.viewReq() });
      cmd = { t: "insert", at, entry: cmd.t === "push" ? cmd.entry : null };
      // If the core refuses the gate (e.g. non-Clifford above 20 qubits), the insertion point stays put.
      fail = () => {
        this.scrub = at;
        this.send({ t: "view", req: this.viewReq() });
        this.requestNoisyView();
      };
    } else if (this.scrub !== null && cmd.t !== "view" && cmd.t !== "scope" && cmd.t !== "insert" && cmd.t !== "delete") {
      // Any other edit ends a scrub: views go back to the live state.
      this.scrub = null;
      this.send({ t: "view", req: this.viewReq() });
    }
    this.reporters.push(report ?? null);
    this.failures.push(fail);
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
    const fail = this.failures.shift();
    if (r.error) this.restoring = false;
    const changed = r.rev !== this.rev;
    this.rev = r.rev;
    this.n = r.n;
    this.tape = r.tape;
    this.redoDepth = r.redo;
    this.symbols = r.symbols;
    // Keep the local value of a symbol being dragged/played; take the rest.
    this.scope = { ...r.scope, ...this.localScope };
    // Until a saved session has loaded, replies come from the default 2-qubit register: keep the saved selection.
    if (!this.restoring) {
      if (this.sel >= r.n) this.sel = r.n - 1;
    }
    if (r.error) {
      this.error(r.error);
      fail?.();
    }
    else report?.(r);
    if (!r.error && r.notes?.length) this.notify(r.notes[r.notes.length - 1]);
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
    if (r.notes?.length) this.notify(r.notes[r.notes.length - 1]);
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
    this.requestNoisyView();
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
    this.chatOpen = false;
    this.helpOpen = false;
    this.param = { ...this.param, open: false };
    this.diagSel = null;
    if (m === "shots" && this.mode === "shots") this.shotSeed++;
    this.mode = m;
    this.send({ t: "view", req: this.viewReq() });
    this.requestNoisyView();
    if (m === "lab" && this.lab.level === "view") this.requestAnalysis();
    this.changed();
  }

  // ─── LAB ────────────────────────────────────────────────────────────

  /** Favourites and Recent first, then every category. */
  labGroups(): LabGroup[] {
    const pick = (ids: string[]) => ids.map((i) => ANALYSIS_BY_ID[i]).filter(Boolean);
    return [
      { id: "fav", label: "★ Favourites", items: pick(this.lab.favs) },
      { id: "recent", label: "Recent", items: pick(this.lab.recent) },
      ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, items: analysesIn(c.id) })),
    ];
  }

  /** The group being listed (the search results for "search"). */
  labGroup(): LabGroup {
    if (this.lab.group === "search") return { id: "search", label: `Search: ${this.lab.query}`, items: searchAnalyses(this.lab.query) };
    return this.labGroups().find((g) => g.id === this.lab.group) ?? this.labGroups()[2];
  }

  /** Type into LAB search: the matches become the list; an empty query goes back to the groups. */
  labSearch(query: string) {
    if (query.trim()) this.lab = { ...this.lab, query, level: "list", group: "search", index: 0 };
    else this.lab = { ...this.lab, query: "", level: "cats", index: this.firstGroup() };
    this.changed();
  }

  /** The first group with something in it (Favourites when there are any). */
  private firstGroup() {
    return Math.max(0, this.labGroups().findIndex((g) => g.items.length > 0));
  }

  isFavourite(id: string) {
    return this.lab.favs.includes(id);
  }

  toggleFavourite(id: string) {
    const favs = this.isFavourite(id) ? this.lab.favs.filter((x) => x !== id) : [...this.lab.favs, id];
    this.lab = { ...this.lab, favs };
    this.changed();
  }

  /** Open an analysis screen (from a tap or = in a list; `group` is where it was picked, else its home). */
  openAnalysis(id: string, group?: string) {
    const meta = ANALYSIS_BY_ID[id];
    if (!meta) return;
    const g = group ?? meta.category;
    const items = g === "search" ? searchAnalyses(this.lab.query) : (this.labGroups().find((x) => x.id === g)?.items ?? analysesIn(meta.category));
    const recent = [id, ...this.lab.recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    this.lab = { ...this.lab, level: "view", id, group: g, index: Math.max(0, items.findIndex((a) => a.id === id)), recent };
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
    const groups = this.labGroups(), at = groups.findIndex((g) => g.id === this.lab.group);
    // A group emptied meanwhile (the last favourite removed) is skipped on the way back.
    const emptied = this.lab.group !== "search" && !(groups[at]?.items.length);
    const home = emptied ? this.firstGroup() : Math.max(0, at);
    this.lab = lvl === "view" && !emptied ? { ...this.lab, level: "list" }
      : lvl === "view" ? { ...this.lab, level: "cats", index: home }
      : this.lab.group === "search" ? { ...this.lab, level: "cats", query: "", index: this.firstGroup() }
      : { ...this.lab, level: "cats", index: home };
    if (lvl === "view") {
      this.analysis = null;
      this.engine.cancelAnalysis();
      this.aInflight = null;
      this.aPending = false;
    }
    this.changed();
  }

  labPick(level: "cats" | "list", index: number) {
    if (level === "cats") {
      const g = this.labGroups()[index];
      if (g?.items.length) this.lab = { ...this.lab, level: "list", group: g.id, index: 0 };
    } else {
      const a = this.labGroup().items[index];
      if (a) return this.openAnalysis(a.id, this.lab.group);
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
    // Periodic runs: a Z-basis panel runs on the run's sample.
    const sample = this.experimentMode === "hardware" && fromRun(id) ? { shots: this.shots, seed: this.shotSeed, mitigate: this.mitigateReadout } : undefined;
    this.engine.analyze({ seq, id, opts, noise: this.noiseOn ? this.noise : undefined, sample });
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

  /** STATE/PROB/BLOCH estimated from the SHOTS sample: periodic runs are on (estimate.ts). */
  get estimating(): boolean {
    return this.experimentMode === "hardware" && ["ket", "prob", "bloch"].includes(this.mode);
  }

  /** The view comes from the noisy distribution: PROB/BLOCH/SHOTS under noise, and STATE when it's estimated from the (noisy) shots. */
  get noisyMode(): boolean {
    return this.noiseOn && (["ket", "prob", "bloch", "shots"].includes(this.mode) || this.estimating);
  }

  /** PROB/BLOCH/SHOTS under noise: computed off the key path, in the analysis worker. */
  private requestNoisyView() {
    if (!this.noisyMode) return;
    const seq = ++this.vSeq;
    // Scrubbed: the noisy view is of the circuit up to that step, like the ideal views.
    this.engine.analyze({ seq, id: "__view", opts: { mode: this.mode, shots: this.shots, seed: this.shotSeed, upTo: this.scrub, estimate: this.estimating, mitigate: this.mitigateReadout }, noise: this.noise });
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
    if (this.transforming && r.seq === this.transforming.seq) return this.onTransform(r);
    if (r.seq > 1_000_000_000) return; // a transform that was superseded
    if (r.id === "__view") {
      if (r.seq === this.vSeq) {
        this.noisyView = { view: r.result.view ?? null, error: r.result.error, rev: r.rev, seq: r.seq };
        this.replyWaiters.splice(0).forEach((f) => f());
      }
      this.changed();
      return;
    }
    if (this.aInflight?.seq === r.seq) this.aInflight = null;
    if (r.id === this.lab.id && !this.aPending && !this.aInflight) this.replyWaiters.splice(0).forEach((f) => f());
    // Ignore replies for another analysis or one superseded by a newer reply.
    if (r.id === this.lab.id && r.seq >= (this.lastShownSeq ?? 0)) {
      this.lastShownSeq = r.seq;
      this.analysis = { id: r.id, status: this.aPending ? "busy" : "done", result: r.result, rev: r.rev, ms: r.ms };
    }
    if (this.aPending) this.requestAnalysis();
    this.changed();
  }

  private lastShownSeq = 0;

  // ─── Editing API (palette, drag and drop, inspector) ─────────────────
  // Every method validates, reports a refusal as an error message (and returns
  // false), and edits through the core's commands, so each is one UNDO.

  /**
   * Classical bits declared (Quantiom's classical register): measurements
   * write them, IF reads them, and they needn't match the qubits. `bits`
   * is at least this, and every bit the circuit names.
   */
  nc = 2;

  /** The classical register's size: `nc`, or more if the circuit names more. */
  get bits(): number {
    return bitCount(this.n, this.tape, this.nc);
  }

  /** The fewest classical bits the circuit allows: every bit it writes or reads. */
  get usedBits(): number {
    return bitCount(this.n, this.tape, 0);
  }

  /** Set the number of classical bits (up to 1024). Below a bit the circuit uses, nothing happens (no error: the count just stays). */
  setClassicalCount(k: number): boolean {
    if (!Number.isInteger(k) || k > MAX_CBITS) return this.refuse(`0–${MAX_CBITS} classical bits`);
    if (k < this.usedBits) return false;
    this.nc = k;
    this.clearError();
    this.changed();
    return true;
  }

  /** The classical bit measurement i writes (c[k]; its own qubit's bit is the default). */
  setMeasureBit(i: number, k: number): boolean {
    const e = this.entryAt(i);
    if (!e || !e.some(writesBit)) return false;
    if (!Number.isInteger(k) || k < 0 || k >= Math.max(this.bits, 1)) return this.refuse(`c0–c${this.bits - 1} only`);
    return this.editEntry(i, e.map((s) => (writesBit(s) ? { ...s, clbits: k === s.targets[0] ? [] : [k] } : s)), `→ c[${k}]`);
  }

  /** Where a gate added without a position goes: the scrub point, else the end. */
  get insertPoint(): number {
    return this.scrub ?? this.tape.length;
  }

  private refuse(text: string): false {
    this.error(text);
    this.changed();
    return false;
  }

  private qubitsProblem(qs: number[]): string | null {
    if (qs.some((q) => !Number.isInteger(q) || q < 0 || q >= this.n)) return `only q0–q${this.n - 1}`;
    if (new Set(qs).size !== qs.length) return "a qubit appears twice in one gate";
    return null;
  }

  /** Push `entry` at `at` (default: the insertion point; while scrubbed the scrub point advances with it). */
  private pushEntry(entry: Entry, at?: number, done?: () => void) {
    const report = (r: Result) => { if (r.done) (done ? done() : this.info(formatEntry(r.done))); };
    if (at === undefined || (at >= this.tape.length && this.scrub === null)) {
      this.send({ t: "push", entry }, report);
    } else {
      const where = Math.max(0, Math.min(at, this.tape.length));
      if (this.scrub !== null && where <= this.scrub) {
        this.scrub++;
        this.send({ t: "view", req: this.viewReq() });
      }
      this.send({ t: "insert", at: where, entry }, report);
    }
  }

  /**
   * Entries dropped on the diagram's grid at column `col` (each in the first
   * free column there or right of it, the next one after it): one UNDO. A
   * single entry that needs no reordering goes in as a push or an insert.
   */
  private placeEntries(entries: Entry[], col: number, label: string, done?: () => void): number {
    if (this.scrub !== null) this.setScrub(null);
    let tape = this.tape, c = col, at = -1;
    for (const e of entries) {
      const r = placeEntry(this.n, tape, e, c);
      tape = r.tape;
      at = r.at;
      c = r.col + Math.max(...shape(this.n, e)) + 1;
    }
    const inserted = entries.length === 1 && tape.length === this.tape.length + 1 && tape.every((x, k) => k === at || x === this.tape[k < at ? k : k - 1]);
    if (inserted) this.pushEntry(tape[at], at >= this.tape.length ? undefined : at, done);
    else this.applyEdit(tape, label, null);
    return c;
  }

  /** `initialize` stores one parameter, the normalised amplitudes: α, β (real or complex expressions). */
  private amplitudeParam(alpha: string, beta: string): string {
    // A real expression (cos(0.3), 1/sqrt(2)) or a complex number (i, 1+2i, (1-i)/√2).
    const cx = (x: string): [number, number] | null => {
      const r = evalParam(x);
      return Number.isFinite(r) ? [r, 0] : parseComplex(x);
    };
    const a = cx(alpha), b = cx(beta);
    if (!a || !b) throw new Error("α and β must be numbers (complex like 1+2i)");
    const norm = Math.hypot(a[0], a[1], b[0], b[1]);
    if (norm < 1e-12) throw new Error("zero state");
    return `(${a[0] / norm}, ${a[1] / norm}, ${b[0] / norm}, ${b[1] / norm})`;
  }

  /** The step a placed gate becomes (params: the given ones, else the gate's defaults). */
  private buildStep(gate: string, o: GateOpts): Step {
    const custom = gate.startsWith(CUSTOM_PREFIX) ? this.customGates.find((d) => CUSTOM_PREFIX + d.name === gate) : undefined;
    if (!custom && !(gate in GATES_BY_ID) && !(gate in BASE_ARITY)) throw new Error(`unknown gate ${gate}`);
    const arity = custom ? custom.k : baseArity(gate);
    const label = gate.startsWith(CUSTOM_PREFIX) ? gate.slice(CUSTOM_PREFIX.length) : gate.toUpperCase();
    if (o.targets.length !== arity) throw new Error(`${label} acts on ${arity} qubit${arity > 1 ? "s" : ""}`);
    const controls = o.controls ?? [];
    const bad = this.qubitsProblem([...controls, ...o.targets]);
    if (bad) throw new Error(bad);
    if (controls.length && NONUNITARY.has(gate)) throw new Error("a measurement, reset or preparation can't be controlled");
    if (o.controlStates && o.controlStates.length !== controls.length) throw new Error("one state per control");
    let params: string[];
    if (custom) params = [];
    else if (gate === "initialize") params = [this.amplitudeParam(o.params?.[0] ?? "1", o.params?.[1] ?? "0")];
    else {
      params = paramDefs(gate).map((d, i) => readExpr((o.params?.[i] ?? d.default).trim() || d.default));
      for (const p of params) if (!exprOk(p)) throw new Error(`can't read "${p}"`);
    }
    if (o.condition) {
      const { clbit, value } = o.condition;
      if (!Number.isInteger(clbit) || clbit < 0 || clbit >= Math.max(this.bits, this.n) || (value !== 0 && value !== 1)) throw new Error(`condition: c[k] with k < ${Math.max(this.bits, this.n)}, value 0 or 1`);
    }
    return {
      id: newId(), gateId: gate, column: this.tape.length, targets: [...o.targets], controls: [...controls], clbits: [], params,
      ...(o.controlStates?.some((on) => !on) ? { controlStates: [...o.controlStates] } : {}),
      ...(o.condition ? { condition: { ...o.condition } } : {}),
    };
  }

  /**
   * Place a gate: base `gate` (x, rz, swap, custom:G1, …) on `targets`, with
   * optional controls (and ○ states), parameters (defaults if missing),
   * condition, at tape index `at` (default: the insertion point).
   */
  addGate(gate: string, o: GateOpts): boolean {
    let step: Step;
    try { step = this.buildStep(gate, o); } catch (e) { return this.refuse((e as Error).message); }
    if (o.col !== undefined) this.placeEntries([[step]], o.col, gate);
    else this.pushEntry([step], o.at);
    this.changed();
    return true;
  }

  /** A palette item waiting for its details (a block's size, a typed state's text), and where it goes. */
  placing: { item: PaletteItem; row: number; col: number } | null = null;

  /** The empty cell last tapped in the diagram: where a tapped palette tile goes. */
  cursor: { row: number; col: number } | null = null;

  /** A tap on an empty cell of the diagram (null: none). */
  tapCell(cell: { row: number; col: number } | null) {
    this.clearError();
    this.diagSel = null;
    this.diagSet = new Set();
    this.cursor = cell;
    if (cell && cell.row < this.n) this.sel = cell.row;
    this.changed();
  }

  /**
   * Put a palette item on wire `row` at diagram column `col`: dropped there,
   * or tapped (the tapped cell, else after the last gate on its wires). A
   * k-qubit gate takes k consecutive wires from `row`, controls first, pulled
   * up at the bottom. Blocks and typed gates open their sheet (`placing`).
   */
  placeItem(item: PaletteItem, row: number, col?: number): boolean {
    const tapped = col === undefined;
    const k = item.kind === "gate" ? item.controls + item.targets : item.kind === "custom" ? item.targets : 1;
    if (k > this.n) return this.refuse(`${item.label} needs ${k} qubits: the circuit has ${this.n}`);
    const qs = spanFrom(row, k, this.n);
    const at = col ?? (this.cursor && this.cursor.row === row ? this.cursor.col : endColumn(layoutTape(this.n, this.tape), qs[0], qs[qs.length - 1]));
    if (item.kind === "gate" || item.kind === "custom") {
      const controls = item.kind === "gate" ? item.controls : 0;
      let step: Step;
      try { step = this.buildStep(item.gate, { controls: qs.slice(0, controls), targets: qs.slice(controls) }); } catch (e) { return this.refuse((e as Error).message); }
      if (writesBit(step)) {
        // A measurement writes its own qubit's bit when the register has it, else the last bit (Quantiom: i mod the bits).
        if (this.nc === 0) this.nc = 1;
        const q = step.targets[0], k = q < this.bits ? q : this.bits - 1;
        if (k !== q) step = { ...step, clbits: [k] };
      }
      const next = this.placeEntries([[step]], at, item.label);
      // Tapping tiles fills the row left to right from the chosen cell.
      if (tapped && this.cursor) this.cursor = { row: this.cursor.row, col: next };
      this.changed();
      return true;
    }
    this.placing = { item, row, col: at };
    this.changed();
    return true;
  }

  closePlacing() {
    this.placing = null;
    this.changed();
  }


  addBroadcast(gate: string, params?: string[], at?: number, col?: number): boolean {
    if (gate.startsWith(CUSTOM_PREFIX) || baseArity(gate) !== 1) return this.refuse("only 1-qubit gates go on every qubit");
    let entry: Entry;
    try { entry = [...Array(this.n).keys()].map((q) => this.buildStep(gate, { targets: [q], params })); } catch (e) { return this.refuse((e as Error).message); }
    if (col !== undefined) this.placeEntries([entry], col, gate);
    else this.pushEntry(entry, at);
    this.changed();
    return true;
  }

  /**
   * A block from the library (blockLib.ts) on `qubits`, ascending (the first
   * is the least significant, as in Qiskit), with its settings (defaults for
   * any left out). Most blocks go in as one custom gate step.
   */
  addBlock(id: string, qubits: number[], settings: Settings = {}, col?: number): boolean {
    const qs = [...qubits].sort((a, b) => a - b);
    const bad = this.qubitsProblem(qs);
    if (bad) return this.refuse(bad);
    try { this.placeBlock(id, qs, settings, col); } catch (e) { return this.refuse((e as Error).message); }
    this.changed();
    return true;
  }

  /** The block's size from its settings when they fix it (Pauli Evolution, Phase Estimation, Pauli Measurement), else null. Throws with a message. */
  blockSize(id: string, settings: Settings): number | null {
    const spec = BLOCK_BY_ID[id];
    if (!spec?.size) return null;
    return spec.size({ ...defaultSettings(spec, this.n), ...settings }, (name) => this.customGates.find((d) => d.name === name));
  }

  /** Custom step i replaced by its steps (UNDO puts the gate back). */
  expandGate(i: number): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    const s = e[0];
    const def = e.length === 1 ? this.customGates.find((d) => CUSTOM_PREFIX + d.name === s.gateId) : undefined;
    if (!def) return this.refuse("only a block or custom gate expands");
    const steps = expandCustom(s, def).map((x) => [{ ...x, id: newId(), condition: s.condition }] as Entry);
    this.applyEdit(expandAt(this.n, this.tape, i, steps), `expand ${def.name}`, null);
    return true;
  }

  /**
   * A typed state or matrix (calc/typed.ts) as gate PSIj / Mj on k consecutive
   * qubits from `first` (k from the text). A state is "reset, then prepare".
   * Throws with a message for the text field to show.
   */
  addTyped(kind: "state" | "matrix", text: string, first: number, col?: number) {
    const parsed = kind === "state" ? parseState(text) : parseMatrix(text);
    const k = parsed.k;
    if (k > this.n) throw new Error(`needs ${k} qubits: the circuit has ${this.n}`);
    const qs = spanFrom(first, k, this.n);
    const prefix = kind === "state" ? "PSI" : "M";
    let j = 1;
    while (this.customGates.some((d) => d.name === `${prefix}${j}`)) j++;
    const def = kind === "state" ? stateGate(`PSI${j}`, parsed as ReturnType<typeof parseState>) : matrixGate(`M${j}`, parsed as ReturnType<typeof parseMatrix>);
    this.setGates([...this.customGates, def]);
    const entries: Entry[] = [];
    if (kind === "state") entries.push(qs.map((q) => ({ id: newId(), gateId: "reset", column: this.tape.length, targets: [q], controls: [], clbits: [], params: [] })));
    const drift = "drift" in parsed && parsed.drift > 1e-12 ? ` (made exactly unitary: it was off by ${parsed.drift.toPrecision(2)})` : "";
    entries.push([{ id: newId(), gateId: CUSTOM_PREFIX + def.name, column: this.tape.length, targets: qs, controls: [], clbits: [], params: [] }]);
    const done = () => this.info(`${def.name} on ${qs.map((q) => `q${q}`).join(", ")}${drift}`);
    if (col !== undefined) {
      this.placeEntries(entries, col, def.name, done);
      done();
    } else entries.forEach((e, k) => this.pushEntry(e, undefined, k === entries.length - 1 ? done : undefined));
    this.changed();
  }

  /** The last k steps (default: the whole circuit) become a custom gate G#. Returns its name, or null (with a message). */
  defineGate(k = this.tape.length): string | null {
    try {
      const name = this.defineLast(k);
      this.changed();
      return name;
    } catch (e) {
      this.refuse((e as Error).message);
      return null;
    }
  }

  private entryAt(i: number): Entry | null {
    return i >= 0 && i < this.tape.length ? this.tape[i] : null;
  }

  /**
   * Replace entry i by `next` (one UNDO): it keeps its column, or takes the
   * first free one right of it when its new wires are taken there; nothing
   * else moves. The edited gate stays selected if it was.
   */
  private editEntry(i: number, next: Entry, label: string): boolean {
    const r = repositionEntry(this.n, this.tape, i, next);
    this.applyEdit(r.tape, label, this.diagSel === i ? r.at : null);
    return true;
  }

  /** New parameter expressions for gate i (all its steps). `initialize` takes α, β. */
  setGateParams(i: number, params: string[]): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    const gate = e[0].gateId;
    let next: string[];
    try {
      if (gate === "initialize") next = [this.amplitudeParam(params[0] ?? "1", params[1] ?? "0")];
      else {
        const defs = e[0].params;
        if (params.length > defs.length) throw new Error(`${defs.length} parameter${defs.length === 1 ? "" : "s"}`);
        next = defs.map((p, j) => readExpr((params[j] ?? p).trim() || p));
        for (const p of next) if (!exprOk(p)) throw new Error(`can't read "${p}"`);
      }
    } catch (err) {
      return this.refuse((err as Error).message);
    }
    return this.editEntry(i, e.map((s) => ({ ...s, params: [...next] })), "angle");
  }

  /** New qubits for gate i (a single-step entry): its targets, controls and control states. */
  setGateQubits(i: number, targets: number[], controls: number[] = [], controlStates?: boolean[]): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    if (e.length !== 1) return this.refuse("a gate on every qubit: change it back to one qubit first");
    const s = e[0];
    if (targets.length !== s.targets.length) return this.refuse(`${s.gateId.toUpperCase()} acts on ${s.targets.length} qubit${s.targets.length > 1 ? "s" : ""}`);
    const bad = this.qubitsProblem([...controls, ...targets]);
    if (bad) return this.refuse(bad);
    if (controls.length && NONUNITARY.has(s.gateId)) return this.refuse("a measurement, reset or preparation can't be controlled");
    const states = controlStates && controlStates.some((on) => !on) ? controlStates : undefined;
    return this.editEntry(i, [{ ...s, targets: [...targets], controls: [...controls], controlStates: states, outcome: NONUNITARY.has(s.gateId) && s.targets[0] !== targets[0] ? undefined : s.outcome }], "qubits");
  }

  /** Move one of gate i's dots to wire q: its target `index`, or its control `index`. Refused if q is already on the gate. */
  reassignQubit(i: number, role: "target" | "control", index: number, q: number): boolean {
    const e = this.entryAt(i);
    if (!e || e.length !== 1) return false;
    const s = e[0];
    const own = role === "target" ? s.targets[index] : s.controls[index];
    if (own === undefined) return false;
    if (own === q) return true;
    if ([...s.targets, ...s.controls].includes(q)) return this.refuse(`q${q} is already on this gate`);
    const targets = role === "target" ? s.targets.map((t, k) => (k === index ? q : t)) : s.targets;
    const controls = role === "control" ? s.controls.map((c, k) => (k === index ? q : c)) : s.controls;
    return this.setGateQubits(i, targets, controls, s.controlStates);
  }

  /** Add wire q as a control of gate i (● or ○ with anti). */
  addControl(i: number, q: number, anti = false): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    if (e.some((s) => s.targets.includes(q) || s.controls.includes(q))) return this.refuse(`q${q} is already on this gate`);
    if (e.some((s) => NONUNITARY.has(s.gateId))) return this.refuse("a measurement, reset or preparation can't be controlled");
    if (q < 0 || q >= this.n) return this.refuse(`only q0–q${this.n - 1}`);
    return this.editEntry(i, e.map((s) => {
      const states = [...(s.controlStates ?? s.controls.map(() => true)), !anti];
      return { ...s, controls: [...s.controls, q], controlStates: states.some((on) => !on) ? states : undefined };
    }), "control");
  }

  /** Remove control q from gate i. */
  removeControl(i: number, q: number): boolean {
    const e = this.entryAt(i);
    if (!e || !e.some((s) => s.controls.includes(q))) return false;
    return this.editEntry(i, e.map((s): Step => {
      const k = s.controls.indexOf(q);
      if (k < 0) return s;
      const cs = (s.controlStates ?? s.controls.map(() => true)).filter((_, j) => j !== k);
      return { ...s, controls: s.controls.filter((_, j) => j !== k), controlStates: cs.some((on) => !on) ? cs : undefined };
    }), "control");
  }

  /** Add a control on the first free wire (below the gate if it can, else above); drag its dot where it belongs. */
  addControlAnywhere(i: number): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    const used = new Set(e.flatMap((s) => [...s.controls, ...s.targets]));
    const hi = Math.max(...used);
    const order = [...Array(this.n).keys()].sort((a, b) => (a > hi ? a - hi : this.n + hi - a) - (b > hi ? b - hi : this.n + hi - b));
    const q = order.find((x) => !used.has(x));
    if (q === undefined) return this.refuse("every qubit is on this gate already");
    return this.addControl(i, q);
  }

  /** Flip control q of gate i between ● (on |1⟩) and ○ (on |0⟩). */
  toggleControlState(i: number, q: number): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    return this.editEntry(i, e.map((s) => {
      const k = s.controls.indexOf(q);
      if (k < 0) return s;
      const states = (s.controlStates ?? s.controls.map(() => true)).map((on, j) => (j === k ? !on : on));
      return { ...s, controlStates: states.some((on) => !on) ? states : undefined };
    }), "control state");
  }

  /** Run gate i only if c[clbit] == value (null: always). */
  setGateCondition(i: number, cond: { clbit: number; value: 0 | 1 } | null): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    if (cond && (!Number.isInteger(cond.clbit) || cond.clbit < 0 || cond.clbit >= this.bits)) return this.refuse(this.bits ? `c0–c${this.bits - 1} only` : "no classical bits: add one at the top");
    return this.editEntry(i, e.map((s) => {
      const { condition: _, ...rest } = s;
      return cond ? { ...rest, condition: { ...cond } } : rest;
    }), cond ? "condition" : "no condition");
  }

  /** Gate i on every qubit (a 1-qubit gate without controls), or back to the one on qubit `keep`. */
  setBroadcast(i: number, on: boolean, keep = this.sel): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    const s = e[0];
    if (on) {
      if (s.targets.length !== 1 || s.controls.length) return this.refuse("only 1-qubit gates without controls go on every qubit");
      // A measurement on every qubit: each writes its own qubit's bit (one bit for all would keep only the last).
      return this.editEntry(i, [...Array(this.n).keys()].map((q) => ({
        ...s, id: q === s.targets[0] ? s.id : newId(), targets: [q], outcome: undefined, ...(writesBit(s) ? { clbits: [] } : {}),
      })), "on every qubit");
    }
    const one = e.find((x) => x.targets[0] === keep) ?? s;
    return this.editEntry(i, [one], "on one qubit");
  }

  /** A copy of gate i in the next free column after it (a measurement's outcome is sampled afresh). */
  duplicateGate(i: number): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    const own = Math.min(...layoutTape(this.n, this.tape).items.filter((it) => it.entry === i).map((it) => it.col));
    this.placeEntries([e.map(({ outcome: _, pin: __, ...s }) => ({ ...s, id: newId() }))], own + 1, "duplicate");
    this.changed();
    return true;
  }

  /** Gate i replaced by its inverse (U†). */
  invertGate(i: number): boolean {
    const e = this.entryAt(i);
    if (!e) return false;
    if (e.some((s) => NONUNITARY.has(s.gateId))) return this.refuse("a measurement, reset or preparation has no inverse");
    if (e.length === 1 && e[0].gateId.startsWith(CUSTOM_PREFIX)) {
      const def = this.customGates.find((d) => CUSTOM_PREFIX + d.name === e[0].gateId);
      if (!def) return this.refuse(`${e[0].gateId.slice(CUSTOM_PREFIX.length)} isn't defined`);
      let made: CustomGate[];
      try { made = inverseGates(def, this.customGates); } catch (err) { return this.refuse((err as Error).message); }
      const fresh = made.filter((d) => !this.customGates.some((x) => x.name === d.name));
      if (fresh.length) this.setGates([...this.customGates, ...fresh]);
      return this.editEntry(i, [{ ...e[0], gateId: CUSTOM_PREFIX + made[0].name }], "invert");
    }
    const next: Entry = [];
    for (const s of e) {
      const inv = invert(s.gateId, s.params);
      if (!inv) return this.refuse(`${s.gateId.toUpperCase()} has no closed-form inverse here`);
      inv.forEach((g, k) => next.push({ ...s, id: k === 0 ? s.id : newId(), gateId: g.gate, params: g.params }));
    }
    return this.editEntry(i, next, "invert");
  }

  /** Delete gate i (everything else keeps its column). */
  removeGate(i: number): boolean {
    if (!this.entryAt(i)) return false;
    this.applyEdit(removeEntries(this.n, this.tape, new Set([i])), `delete step ${i + 1}`, null);
    return true;
  }

  /** Set the number of qubits (1–1024; above 20, Clifford circuits in stabilizer mode). */
  setQubitCount(n: number): boolean {
    if (!Number.isInteger(n) || n < 1 || n > STAB_MAX) return this.refuse(`1–${STAB_MAX} qubits`);
    if (n === this.n) return true;
    this.diagSel = null;
    this.resize(n);
    this.changed();
    return true;
  }

  undo() {
    this.diagSel = null;
    this.send({ t: "undo" }, (r) => this.info(r.op ? `undo ${opLabel(r.op)}` : "nothing to undo"));
    this.changed();
  }

  redo() {
    this.diagSel = null;
    this.send({ t: "redo" }, (r) => this.info(r.op ? `redo ${opLabel(r.op)}` : "nothing to redo"));
    this.changed();
  }

  /** Clear the circuit back to |0…0⟩ (UNDO restores it). */
  clearCircuit() {
    this.diagSel = null;
    this.send({ t: "clear" }, (r) => this.notify(`cleared to |${"0".repeat(r.n)}⟩ (UNDO restores)`));
    this.changed();
  }

  /** Save the circuit in memory slot k (1–9). */
  store(k: number): boolean {
    if (!Number.isInteger(k) || k < 1 || k > 9) return this.refuse("memory M1–M9");
    this.memory = { ...this.memory, [k]: { n: this.n, tape: [...this.tape], scope: { ...this.scope } } };
    this.notify(`M${k} ← ${this.tape.length} steps, n = ${this.n}`);
    return true;
  }

  /** Load memory slot k (an undoable replace). */
  recall(k: number): boolean {
    const m = this.memory[k];
    if (!m) return this.refuse(`M${k} is empty`);
    this.diagSel = null;
    this.send({ t: "replace", n: m.n, tape: m.tape, scope: m.scope, label: `load M${k}` }, () => this.notify(`loaded M${k}`));
    this.changed();
    return true;
  }

  /** The number of shots the SHOTS view samples (1–1 000 000). */
  setShots(n: number): boolean {
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return this.refuse("shots 1–1000000");
    this.shots = n;
    this.clearError();
    this.shotSeed++;
    this.refreshExperiment();
    return true;
  }

  /**
   * Periodic shot runs, whichever tab is open: every 1/shotRate seconds a new
   * sample (shotSeed), which the SHOTS view and, under noise, PROB/BLOCH/SHOTS
   * show. The next run is timed once the last one's view is back, so a slow
   * sample never builds a backlog.
   */
  experimentMode: "simulation" | "hardware" = "simulation";
  autoShots = false;
  /** Runs per second (SHOT_RATE). */
  shotRate = 1;
  /** Periodic runs since they were switched on. */
  shotRun = 0;
  private shotTimer: ReturnType<typeof setTimeout> | null = null;
  private shotLoop = 0;

  setExperimentMode(mode: "simulation" | "hardware") {
    this.experimentMode = mode;
    if (mode === "simulation") { this.autoShots = false; this.stopShotLoop(); }
    this.refreshExperiment();
  }

  private refreshExperiment() {
    this.send({ t: "view", req: this.viewReq() });
    this.noisyView = null;
    this.requestNoisyView();
    if (this.mode === "lab") this.requestAnalysis();
    this.changed();
  }

  setAutoShots(on: boolean) {
    if (on) this.experimentMode = "hardware";
    this.autoShots = on;
    this.shotRun = 0;
    if (on) this.startShotLoop();
    else this.stopShotLoop();
    // Stopping automatic refresh keeps the hardware experiment mode.
    this.refreshExperiment();
  }

  /** Undo the readout confusion in the estimates (with noise on); the open tab follows. */
  mitigateReadout = false;

  setMitigateReadout(on: boolean) {
    this.mitigateReadout = on;
    this.noisyView = null;
    this.requestNoisyView();
    if (this.mode === "lab") this.requestAnalysis();
    this.changed();
  }

  setShotRate(r: number): boolean {
    if (!Number.isFinite(r) || r < SHOT_RATE[0] || r > SHOT_RATE[1]) return this.refuse(`rate ${SHOT_RATE[0]}–${SHOT_RATE[1]} runs per second`);
    this.shotRate = r;
    this.clearError();
    if (this.autoShots) this.startShotLoop(); // the new period from now
    this.changed();
    return true;
  }

  private startShotLoop() {
    this.stopShotLoop();
    const loop = ++this.shotLoop;
    const tick = () => {
      this.shotTimer = setTimeout(async () => {
        if (loop !== this.shotLoop) return;
        await this.periodicShots();
        if (loop === this.shotLoop) tick();
      }, 1000 / this.shotRate);
    };
    tick();
  }

  private stopShotLoop() {
    this.shotLoop++;
    if (this.shotTimer) clearTimeout(this.shotTimer);
    this.shotTimer = null;
  }

  /** Resolved when the reply the open tab waits for arrives (the noisy view, the LAB panel). */
  private replyWaiters: (() => void)[] = [];

  /**
   * One periodic run: new samples (`shots` per experiment), and one update of
   * the open tab from them (SHOTS, STATE/PROB/BLOCH, a LAB panel that reads
   * the state). Resolves once that update is back, so the next run is timed
   * from there and slow work (noise, tomography) never queues up; in other
   * tabs the run is counted.
   */
  periodicShots(): Promise<void> {
    this.shotRun++;
    this.shotSeed++;
    const waits: Promise<void>[] = [];
    // A reply that never comes (a restarted worker) mustn't stop the runs: at most 5 s.
    const reply = () => new Promise<void>((resolve) => { this.replyWaiters.push(resolve); setTimeout(resolve, 5000); });
    if (this.noisyMode) { waits.push(reply()); this.requestNoisyView(); }
    if (this.mode === "lab" && this.lab.id && fromRun(this.lab.id)) { waits.push(reply()); this.requestAnalysis(); }
    if (["shots", "ket", "prob", "bloch"].includes(this.mode)) {
      waits.push(this.nextView());
      this.send({ t: "view", req: this.viewReq() });
    }
    this.changed();
    return Promise.all(waits).then(() => undefined);
  }

  /** Sample the shots again. */
  rerollShots() {
    this.shotSeed++;
    this.shotRun++;
    this.refreshExperiment();
  }

  // ─── Editing on the diagram's grid (pure edits in grid.ts) ───

  /** The gate (tape entry) selected in the diagram: its dots can be dragged, arrows and Delete act on it. */
  diagSel: number | null = null;
  /** Gates selected with a rectangle: copy, cut, delete, duplicate. */
  diagSet: Set<number> = new Set();
  /** Copied gates (this session). */
  clip: Clip | null = null;

  /** Select a gate in the diagram. Its wire becomes the selected qubit too: one selection, not two. */
  selectStep(i: number | null) {
    this.clearError();
    this.diagSel = i !== null && i >= 0 && i < this.tape.length ? i : null;
    this.diagSet = new Set();
    this.cursor = null;
    const e = this.diagSel !== null ? this.tape[this.diagSel] : undefined;
    if (e?.[0]?.targets.length) this.sel = e[0].targets[0];
    this.changed();
  }

  /** Select the gates drawn in columns c0..c1 on rows r0..r1 (a rectangle dragged on the diagram). */
  selectBox(c0: number, c1: number, r0: number, r1: number) {
    const set = entriesIn(layoutTape(this.n, this.tape), Math.min(c0, c1), Math.max(c0, c1), Math.min(r0, r1), Math.max(r0, r1));
    this.clearError();
    this.diagSel = null;
    this.cursor = null;
    this.diagSet = set;
    this.changed();
  }

  selectAll() {
    this.diagSel = null;
    this.diagSet = new Set(this.tape.keys());
    this.changed();
  }

  /** The selected gates: the rectangle's, else the selected gate. */
  private selection(): Set<number> {
    return this.diagSet.size ? this.diagSet : this.diagSel !== null ? new Set([this.diagSel]) : new Set();
  }

  copySelection(): boolean {
    const set = this.selection();
    if (!set.size) return false;
    this.clip = copyEntries(this.n, this.tape, set);
    this.notify(`copied ${set.size} gate${set.size > 1 ? "s" : ""}`);
    this.changed();
    return true;
  }

  cutSelection(): boolean {
    if (!this.copySelection()) return false;
    return this.deleteSelection();
  }

  deleteSelection(): boolean {
    const set = this.selection();
    if (!set.size) return false;
    this.diagSet = new Set();
    this.applyEdit(removeEntries(this.n, this.tape, set), `delete ${set.size} gate${set.size > 1 ? "s" : ""}`, null);
    return true;
  }

  /** The copied gates after the circuit's last column. */
  paste(): boolean {
    if (!this.clip) return this.refuse("nothing copied");
    const r = pasteClip(this.n, this.tape, this.clip, newId);
    if (!r.added) return this.refuse("the copied gates need more qubits");
    this.applyEdit(r.tape, `paste ${r.added}`, null);
    this.diagSet = new Set([...r.tape.keys()].filter((k) => k >= this.tape.length));
    return true;
  }

  /** The selection repeated after itself, `times` times. */
  repeatSelection(times = 1): boolean {
    const set = this.selection();
    if (!set.size) return false;
    const clip = copyEntries(this.n, this.tape, set);
    let tape = this.tape;
    for (let k = 0; k < times; k++) tape = pasteClip(this.n, tape, clip, newId).tape;
    this.diagSet = new Set();
    this.applyEdit(tape, `repeat ${set.size}`, null);
    return true;
  }

  /** Column ranges drawn folded into one box (the diagram only; this session). */
  folds: { from: number; to: number }[] = [];

  /** Fold the selection's columns into a box (tap the box to unfold). */
  foldSelection(): boolean {
    const set = this.selection();
    if (!set.size) return false;
    const cols = layoutTape(this.n, this.tape).items.filter((it) => set.has(it.entry)).map((it) => it.col);
    const from = Math.min(...cols), to = Math.max(...cols);
    this.folds = [...this.folds.filter((f) => f.to < from || f.from > to), { from, to }].sort((a, b) => a.from - b.from);
    this.diagSet = new Set();
    this.diagSel = null;
    this.changed();
    return true;
  }

  unfold(from: number) {
    this.folds = this.folds.filter((f) => f.from !== from);
    this.changed();
  }

  /** Quantiom's Paste Circuit: OpenQASM text (the clipboard's) loaded as an undoable replace. */
  pasteCircuit(text: string): boolean {
    if (!text.trim()) return this.refuse("the clipboard is empty");
    try {
      this.loadQasm(text, "pasted circuit");
    } catch (e) {
      return this.refuse(`paste: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.folds = [];
    return true;
  }

  /** A transform running in the analysis worker (Edit/Transform menu), and its label. */
  transforming: { seq: number; id: string; label: string } | null = null;
  private tSeq = 1_000_000_000;

  /**
   * Quantiom's Transform menu, on QC-1's circuit tools (LAB → Circuit tools,
   * validated against Qiskit): run tool `id` with `opts` in the analysis
   * worker; its result replaces the circuit (one UNDO) only if the tool
   * verified it (same operator, or the target reached). Replies come back
   * through onAnalysis.
   */
  transform(id: string, opts: Opts, label: string): boolean {
    if (this.stabilizerMode) return this.refuse("the circuit tools run up to 20 qubits");
    if (!this.tape.length && id !== "randclifford") return this.refuse("the circuit is empty");
    const seq = ++this.tSeq;
    this.transforming = { seq, id, label };
    this.notify(`${label}…`);
    this.engine.analyze({ seq, id, opts });
    this.changed();
    return true;
  }

  private onTransform(r: AnalysisReply) {
    const t = this.transforming!;
    this.transforming = null;
    const p = r.result.proposal;
    if (r.result.error) this.error(`${t.label}: ${r.result.error}`);
    else if (!p) this.notify(`${t.label}: ${r.result.notes?.[0] ?? "no change"}`); // e.g. nothing to simplify
    else if (!p.verified) this.error(`${t.label}: ${p.check}`);
    else {
      const before = this.tape.reduce((k, e) => k + e.length, 0), after = p.tape.reduce((k, e) => k + e.length, 0);
      this.send({ t: "replace", n: p.n, tape: p.tape, scope: { ...this.scope }, label: t.label });
      this.diagSel = null;
      this.diagSet = new Set();
      this.folds = [];
      // What the tool couldn't rewrite (a transpile's gates without an exact form) is said, not hidden.
      const left = r.result.notes?.find((x) => x.startsWith("Left as is"));
      this.notify(`${t.label}: ${before} → ${after} gates · ${p.check}${left ? ` · ${left}` : ""}`);
    }
    this.changed();
  }

  /** Every gate as far left as it can go (the pins dropped). */
  compactColumns() {
    this.applyEdit(compact(this.tape), "compact", null);
  }

  /** Entry i dragged to column `col`, dq wires down (the first free column there or right of it). */
  moveGate(i: number, col: number, dq: number): boolean {
    if (!this.entryAt(i)) return false;
    const r = moveEntry(this.n, this.tape, i, col, dq);
    if (!r) return this.refuse("no qubit there");
    this.applyEdit(r.tape, "move", r.at);
    return true;
  }

  /** Arrow keys: the selected gate one column left/right (to the nearest free one) or one wire up/down. */
  nudgeSelected(dcol: number, dq: number): boolean {
    const i = this.diagSel;
    if (i === null) return false;
    const lay = layoutTape(this.n, this.tape);
    const own = Math.min(...lay.items.filter((it) => it.entry === i).map((it) => it.col));
    if (dcol < 0) {
      const e = this.tape[i], rel = shape(this.n, e);
      for (let c = own - 1; c >= 0; c--) if (freeColumn(lay.items, e, rel, c, i, this.n) === c) return this.moveGate(i, c, 0);
      return this.refuse("no free column to the left");
    }
    return this.moveGate(i, own + dcol, dq);
  }

  /** Replace the tape (one undoable step) and keep `sel` selected. */
  private applyEdit(tape: Entry[], label: string, sel: number | null) {
    if (this.scrub !== null) this.setScrub(null);
    this.send({ t: "replace", n: this.n, tape, scope: { ...this.scope }, label });
    this.diagSel = sel;
    // The selected qubit follows the gate (moved up or down, dragged to another wire).
    const e = sel !== null ? tape[sel] : undefined;
    if (e?.[0]?.targets.length) this.sel = e[0].targets[0];
    this.changed();
  }

  select(q: number) {
    if (q >= 0 && q < this.n) this.sel = q;
    this.changed();
  }

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
    if (r.gates.length) this.setGates([...this.customGates, ...r.gates]);
    this.sel = Math.min(this.sel, r.n - 1);
    this.nc = Math.max(r.nc, bitCount(r.n, r.tape, 0));
    // No confirmation message: the loaded tape speaks for itself (and the entry line stays clear).
    this.send({ t: "replace", n: r.n, tape: r.tape, scope: { ...scope }, label });
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

  /** Show a status line from outside the key flow (copy / share results). */
  notify(text: string, kind: Message["kind"] = "note") {
    this.message = { text, kind };
    this.changed();
  }

  /** An error stays until the next thing the user does succeeds (an edit, a selection, a setting). */
  private clearError() {
    if (this.message?.kind === "error") this.message = null;
  }

  private error(text: string) {
    this.message = { text, kind: "error" };
  }

  private info(text: string) {
    this.message = { text, kind: "info" };
  }

  /** Custom gates defined: here, in the core worker and for the palette. */
  private setGates(defs: CustomGate[]) {
    this.customGates = defs;
    setCustomGates(defs);
    this.send({ t: "gates", defs });
  }

  /**
   * `def` among the custom gates: the same definition already there is reused,
   * a different one under its name becomes NAME_2, NAME_3…. Returns the name.
   */
  private adoptGate(def: CustomGate): string {
    const bare = (d: CustomGate) => JSON.stringify(d.tape.map((e) => e.map(({ id: _, pin: __, ...s }) => s)));
    const want = bare(def);
    for (let j = 1; ; j++) {
      const name = j === 1 ? def.name : `${def.name}_${j}`;
      const have = this.customGates.find((d) => d.name === name);
      if (have && have.k === def.k && bare(have) === want) return name;
      if (!have) {
        this.setGates([...this.customGates, { ...def, name }]);
        return name;
      }
    }
  }

  /** A library block on the qubits `qs` (ascending). Throws with a message. */
  private placeBlock(id: string, qs: number[], settings: Settings, col?: number) {
    const spec = BLOCK_BY_ID[id];
    if (!spec) throw new Error(`no block "${id}"`);
    const k = qs.length;
    if (k < spec.minQubits || (spec.maxQubits && k > spec.maxQubits)) throw new Error(`${spec.name}: ${spec.maxQubits === spec.minQubits ? spec.minQubits : `${spec.minQubits}–${spec.maxQubits ?? this.n}`} qubits`);
    const set = { ...defaultSettings(spec, k), ...settings };
    for (const d of spec.settings) if (d.kind === "expr") set[d.key] = readExpr(set[d.key]);
    const lookup = (name: string) => this.customGates.find((d) => d.name === name);
    const built = spec.build(k, set, lookup);
    const at = (entries: Entry[], label: string, done?: () => void) => {
      const placed = entries.map((e) => e.map((s) => ({ ...s, id: newId(), column: this.tape.length, targets: s.targets.map((q) => qs[q]), controls: s.controls.map((q) => qs[q]) })));
      if (col !== undefined) this.placeEntries(placed, col, label, done);
      else placed.forEach((e, j) => this.pushEntry(e, undefined, j === placed.length - 1 ? done : undefined));
    };
    if ("entries" in built) {
      at(built.entries, spec.name, () => this.info(`${spec.name} on ${qs.map((q) => `q${q}`).join(", ")}`));
      return;
    }
    const name = this.adoptGate({ ...built.gate, about: describeBlock(spec, k, set) });
    const entry: Entry = [{ id: newId(), gateId: CUSTOM_PREFIX + name, column: this.tape.length, targets: qs, controls: [], clbits: [], params: [] }];
    if (col !== undefined) this.placeEntries([entry], col, name);
    else this.pushEntry(entry);
  }

  /** The selected gates become one gate G# (under Your gates) in their place; UNDO takes it back. */
  saveSelectionAsGate(): string | null {
    const set = this.selection();
    if (!set.size) { this.refuse("select gates first (long-press and drag)"); return null; }
    const idx = [...set].sort((a, b) => a - b);
    const entries = idx.map((i) => this.tape[i]);
    if (entries.some((e) => e.some((s) => NONUNITARY.has(s.gateId)))) { this.refuse("a gate can't measure, reset or prepare"); return null; }
    if (entries.some((e) => e.some((s) => s.condition))) { this.refuse("a gate can't depend on a classical bit"); return null; }
    let j = 1;
    while (this.customGates.some((d) => d.name === `G${j}`)) j++;
    const def = { ...defineGate(`G${j}`, entries), about: `${entries.length} gate${entries.length > 1 ? "s" : ""} saved from the circuit` };
    const used = [...new Set(entries.flat().flatMap((s) => [...s.controls, ...s.targets]))].sort((a, b) => a - b);
    const step: Step = { id: newId(), gateId: CUSTOM_PREFIX + def.name, column: 0, targets: used, controls: [], clbits: [], params: [] };
    const next = groupEntries(this.n, this.tape, set, [step]);
    if (!next) { this.refuse("other gates sit between the selected ones: select them too, or move them"); return null; }
    this.setGates([...this.customGates, def]);
    this.diagSet = new Set();
    this.diagSel = null;
    this.applyEdit(next, `save ${def.name}`, null);
    this.info(`${def.name} = ${entries.length} gate${entries.length > 1 ? "s" : ""} on ${used.map((q) => `q${q}`).join(", ")} (Your gates)`);
    return def.name;
  }

  /** The last k tape entries become a custom gate G# (listed under Your gates). Throws with a message. Returns its name. */
  private defineLast(k: number): string {
    if (k < 1 || k > this.tape.length) throw new Error(this.tape.length ? `k = 1–${this.tape.length}` : "the circuit is empty");
    const entries = this.tape.slice(-k);
    if (entries.some((e) => e.some((s) => NONUNITARY.has(s.gateId)))) throw new Error("a gate can't measure, reset or prepare");
    let i = 1;
    while (this.customGates.some((d) => d.name === `G${i}`)) i++;
    const def = defineGate(`G${i}`, entries);
    this.setGates([...this.customGates, def]);
    this.info(`G${i} = ${k} step${k > 1 ? "s" : ""} on ${def.k} qubit${def.k > 1 ? "s" : ""}`);
    return `G${i}`;
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
    this.notify(`pinned to the report (${this.pins.length}): CIRC ≡ → Report`);
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
    if (this.chatOpen) this.helpOpen = false;
    this.changed();
  }

  toggleHelp() {
    this.helpOpen = !this.helpOpen;
    if (this.helpOpen) this.chatOpen = false;
    this.changed();
  }

  /**
   * The top row is one choice, like tabs: a view, AI (the chat) or ? (help).
   * AI and ? open over the current view and close each other; a view closes them.
   */
  openChat() {
    this.chatOpen = true;
    this.helpOpen = false;
    this.param = { ...this.param, open: false };
    this.changed();
  }

  openHelp() {
    this.helpOpen = true;
    this.chatOpen = false;
    this.param = { ...this.param, open: false };
    this.changed();
  }

  /** Above 20 qubits the register is a stabilizer tableau. */
  get stabilizerMode(): boolean {
    return this.n > MAX_QUBITS;
  }

}

/** Short label of an undone/redone operation. */
function opLabel(op: NonNullable<Result["op"]>): string {
  return op.k === "entry" ? formatEntry(op.entry) : op.label;
}

export { symbolGlyph };

// Dev server: the app keeps one Calculator for its lifetime, so a hot update of
// this class would leave the running instance without the new methods. Reload.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
