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
  | { kind: "qubit"; key: string; label: string };

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
      max?: number;
    }
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

export type AnalysisResult = { scalars?: Scalar[]; charts?: Chart[]; notes?: string[]; error?: string };

/** What an analysis sees: a private copy of the register. */
export type AnalysisContext = { n: number; state: Float64Array; tape: Entry[] };

export type AnalysisRequest = { seq: number; id: string; opts: Opts };
export type AnalysisReply = { seq: number; rev: number; id: string; result: AnalysisResult; ms: number };
