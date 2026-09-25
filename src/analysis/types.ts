/**
 * Analysis framework types. An analysis turns the register (state + tape) into
 * a small, serializable result: scalars, charts and notes. The metadata
 * (catalog.ts) is imported by the UI; the compute functions (run.ts) only by
 * the analysis worker, so the numerics stay out of the main bundle.
 */
import type { Entry } from "../calc/steps";
import type { NoiseModel } from "../noise/model";
import type { ViewData } from "../calc/core";

export type Category =
  | "state" | "measurement" | "phase" | "entanglement" | "correlations" | "entspectrum"
  | "metrology" | "geometry" | "variational" | "dynamics" | "chaos" | "operator" | "thermal"
  | "structure" | "tools" | "noise" | "bench" | "estimation" | "qec" | "plotting" | "verify";

/** Inputs an analysis screen shows. `key` names the field in the options object. */
export type InputSpec =
  | { kind: "cut"; key: string; label: string; min?: number; max?: number }
  /** One qubit; `fallback` picks the default from n (e.g. the last qubit). */
  | { kind: "qubit"; key: string; label: string; fallback: "first" | "second" | "last" }
  /** An integer in [min, max] (max ≤ 0 means n + max). */
  | { kind: "int"; key: string; label: string; min: number; max: number; fallback: number }
  | { kind: "choice"; key: string; label: string; options: { label: string; value: number }[]; fallback: number }
  /** Pauli string or Pauli sum, typed on the phone keyboard (presets for the current n). */
  | { kind: "pauli"; key: string; label: string }
  /** A target state typed on the phone keyboard (|011⟩ or amplitudes), with presets. */
  | { kind: "state"; key: string; label: string }
  /** Program text (several lines), with example presets. */
  | { kind: "code"; key: string; label: string }
  /** Free text on the phone keyboard (empty = the analysis's own default). */
  | { kind: "text"; key: string; label: string; placeholder: string }
  /** One of the tape's symbols; `optional` adds "none". */
  | { kind: "symbol"; key: string; label: string; optional?: boolean; fallback: "first" | "second" | "t" };

export type Opts = Record<string, unknown>;

export type AnalysisMeta = {
  id: string;
  title: string;
  /** Home group (the breadcrumb, the help page). */
  category: Category;
  /** Other groups that list it too (one implementation, several places). */
  also?: Category[];
  summary: string;
  inputs: InputSpec[];
  /** Hard cap; above it the analysis is listed but disabled. */
  maxQubits: number;
  minQubits?: number;
  /** live: recomputed on every register change. run: on demand (RUN button). */
  mode: "live" | "run";
};

export type Scalar = { label: string; value: number | string; unit?: string; /** ± (a measured estimate's bootstrap spread). */ err?: number };

export type HeatScale = "seq" | "div" | "complex";

export type Chart =
  | {
      kind: "heatmap"; title?: string; rows: string[]; cols: string[];
      /** Magnitudes (seq/div), or real parts when scale = complex. */
      values: number[][];
      /** Imaginary parts (complex scale only). */
      imag?: number[][];
      scale: HeatScale; min?: number; max?: number; unit?: string;
      /** Categorical codes, not quantities: no numbers in cells, no colour scale. */
      codes?: Record<number, string>;
    }
  | {
      kind: "bars"; title?: string; labels: string[]; values: number[]; unit?: string;
      /** Optional per-bar phase (radians): bars are hue-coded by phase. */
      phases?: number[];
      /** Signed values: negative bars in the second series colour. */
      signed?: boolean;
      max?: number;
    }
  | {
      kind: "scatter"; title?: string; x: number[]; y: number[]; xLabel: string; yLabel: string;
      logY?: boolean;
      /** Fitted line y = a + b·x (in the plotted, possibly log, space). */
      fit?: { a: number; b: number; label: string };
    }
  | {
      kind: "hist"; title?: string; centers: number[]; values: number[]; xLabel: string; yLabel: string;
      curve?: { name: string; y: number[] };
    }
  | { kind: "stars"; title?: string; stars: { theta: number; phi: number }[] }
  /** A plot program's sanitised drawing (analysis/plotProgram.ts). */
  | { kind: "scene"; title?: string; scene: import("./plotProgram").PlotScene }
  /**
   * An error-correcting code's lattice: data qubits at grid points, checks as
   * plaquettes over their qubits (lit = the syndrome), errors and the
   * decoder's correction on the qubits.
   */
  | {
      kind: "lattice"; title?: string; rows: number; cols: number;
      qubits: { r: number; c: number; label: string; error?: "X" | "Y" | "Z"; fix?: "X" | "Y" | "Z" }[];
      checks: { type: "X" | "Z"; qubits: number[]; lit: boolean }[];
    }
  /** Energy-level diagram: one line per level (degeneracy shown), optional marker. */
  | { kind: "levels"; title?: string; energies: number[]; marker?: { label: string; value: number } }
  /** Points on the unit circle (Floquet eigenphases). */
  | { kind: "phases"; title?: string; phases: number[] }
  /** ZX diagram on the qubit × step grid. */
  | {
      kind: "zx"; title?: string; numQubits: number; numCols: number;
      nodes: { kind: "Z" | "X" | "H" | "box"; qubit: number; col: number; phase: string; label?: string }[];
      edges: { q1: number; q2: number; col: number; hadamard: boolean }[];
    }
  /** Paths on the Bloch sphere (Bloch trajectory over t). */
  | { kind: "paths"; title?: string; paths: { label: string; points: { x: number; y: number; z: number }[] }[] }
  | {
      kind: "lines"; title?: string; x: number[]; xLabel: string; yLabel: string;
      series: { name: string; y: number[]; dashed?: boolean }[];
      yMin?: number; yMax?: number; xTicks?: string[];
      /** Logarithmic axes (values must be > 0). */
      logX?: boolean; logY?: boolean;
    }
  | { kind: "table"; title?: string; headers: string[]; rows: (string | number)[][] }
  /** Measurement branch tree: nodes in DFS order (children follow their parent). */
  | {
      kind: "tree"; title?: string;
      nodes: { id: number; parent: number | null; depth: number; outcome: 0 | 1 | null; p: number; label: string | null }[];
    }
  | { kind: "disks"; title?: string; disks: { label: string; re: number; im: number }[] }
  | {
      kind: "qsphere"; title?: string;
      points: { label: string; x: number; y: number; z: number; mag: number; phase: number }[];
    };

export type AnalysisResult = {
  scalars?: Scalar[]; charts?: Chart[]; notes?: string[]; error?: string;
  /** Offer to set these symbol values (e.g. the optimizer's result). */
  apply?: { label: string; scope: Record<string, number> };
  /** A circuit tool's output: offered as an undoable whole-tape replace. */
  proposal?: Proposal;
  /** A noisy PROB/BLOCH/SHOTS view (request "__view"), and how it was computed. */
  view?: ViewData & { method: string };
};

/**
 * A tool's rewritten tape. `verified` says the in-app check passed (same
 * operator, or the stated target reached); APPLY is only offered then.
 */
export type Proposal = {
  label: string;
  n: number;
  tape: Entry[];
  verified: boolean;
  /** What was checked and how, e.g. "same operator up to a global phase (every column, err 2e-15)". */
  check: string;
};

/** What an analysis sees: a private copy of the register, and the noise model (if on). */
export type AnalysisContext = { n: number; state: Float64Array; tape: Entry[]; scope: Record<string, number>; noise?: NoiseModel };

export type AnalysisRequest = {
  seq: number; id: string; opts: Opts; noise?: NoiseModel;
  /** SHOTS → repeat: run a FROM_SHOTS panel on this run's sample (shots, the run's seed). */
  sample?: { shots: number; seed: number; /** Undo the readout confusion on every count first. */ mitigate?: boolean };
};
export type AnalysisReply = { seq: number; rev: number; id: string; result: AnalysisResult; ms: number };
