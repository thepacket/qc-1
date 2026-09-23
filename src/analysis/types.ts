/**
 * Analysis framework types. An analysis turns the register (state + tape) into
 * a small, serializable result: scalars, charts and notes. The metadata
 * (catalog.ts) is imported by the UI; the compute functions (run.ts) only by
 * the analysis worker, so the numerics stay out of the main bundle.
 */
import type { Entry } from "../calc/steps";

export type Category =
  | "state" | "measurement" | "phase" | "metrology" | "entanglement" | "dynamics"
  | "operator" | "structure" | "noise" | "bench" | "verify" | "tools";

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
  /** One of the tape's symbols; `optional` adds "none". */
  | { kind: "symbol"; key: string; label: string; optional?: boolean; fallback: "first" | "second" | "t" };

export type Opts = Record<string, unknown>;

export type AnalysisMeta = {
  id: string;
  title: string;
  category: Category;
  summary: string;
  inputs: InputSpec[];
  /** Hard cap; above it the analysis is listed but disabled. */
  maxQubits: number;
  minQubits?: number;
  /** live: recomputed on every register change. run: on demand (RUN button). */
  mode: "live" | "run";
};

export type Scalar = { label: string; value: number | string; unit?: string };

export type HeatScale = "seq" | "div" | "complex";

export type Chart =
  | {
      kind: "heatmap"; title?: string; rows: string[]; cols: string[];
      /** Magnitudes (seq/div), or real parts when scale = complex. */
      values: number[][];
      /** Imaginary parts (complex scale only). */
      imag?: number[][];
      scale: HeatScale; min?: number; max?: number; unit?: string;
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
  /** Paths on the Bloch sphere (Bloch trajectory over t). */
  | { kind: "paths"; title?: string; paths: { label: string; points: { x: number; y: number; z: number }[] }[] }
  | {
      kind: "lines"; title?: string; x: number[]; xLabel: string; yLabel: string;
      series: { name: string; y: number[]; dashed?: boolean }[];
      yMin?: number; yMax?: number; xTicks?: string[];
    }
  | { kind: "table"; title?: string; headers: string[]; rows: (string | number)[][] }
  | { kind: "disks"; title?: string; disks: { label: string; re: number; im: number }[] }
  | {
      kind: "qsphere"; title?: string;
      points: { label: string; x: number; y: number; z: number; mag: number; phase: number }[];
    };

export type AnalysisResult = {
  scalars?: Scalar[]; charts?: Chart[]; notes?: string[]; error?: string;
  /** Offer to set these symbol values (e.g. the optimizer's result). */
  apply?: { label: string; scope: Record<string, number> };
};

/** What an analysis sees: a private copy of the register. */
export type AnalysisContext = { n: number; state: Float64Array; tape: Entry[]; scope: Record<string, number> };

export type AnalysisRequest = { seq: number; id: string; opts: Opts };
export type AnalysisReply = { seq: number; rev: number; id: string; result: AnalysisResult; ms: number };
