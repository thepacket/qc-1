import type { AnalysisMeta, Category } from "./types";

/** LAB categories, in display order (Quantiom's grouping, phone-sized labels). */
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "state", label: "State" },
  { id: "measurement", label: "Measurement" },
  { id: "phase", label: "Phase space & magic" },
  { id: "metrology", label: "Expectation & metrology" },
  { id: "entanglement", label: "Entanglement & correlations" },
  { id: "dynamics", label: "Dynamics" },
  { id: "operator", label: "Operator & spectrum" },
  { id: "structure", label: "Circuit structure" },
  { id: "tools", label: "Circuit tools" },
  { id: "noise", label: "Noise & error" },
  { id: "bench", label: "Characterization & benchmarking" },
  { id: "verify", label: "Verification & export" },
];

const cut = { kind: "cut" as const, key: "cut", label: "A" };

/** Every analysis the LAB offers. Compute functions live in run.ts (analysis worker). */
export const ANALYSES: AnalysisMeta[] = [
  { id: "statevector", title: "Statevector", category: "state", mode: "live", maxQubits: 20, inputs: [],
    summary: "Amplitudes as numbers: real, imaginary, magnitude, phase, probability." },
  { id: "ampphase", title: "Amplitude · phase", category: "state", mode: "live", maxQubits: 20, inputs: [],
    summary: "One bar per basis state: length |amplitude|, colour = phase. Shows interference at a glance." },
  { id: "phasedisk", title: "Phase disks", category: "state", mode: "live", maxQubits: 20, inputs: [],
    summary: "Each qubit's coherence ρ₁₀ in the complex plane: angle = relative phase, length ≤ ½." },
  { id: "qsphere", title: "Q-sphere", category: "state", mode: "live", maxQubits: 8, inputs: [],
    summary: "Basis states on a sphere by Hamming weight; size = |amplitude|, colour = phase." },
  { id: "density", title: "Reduced density matrix", category: "entanglement", mode: "live", maxQubits: 20,
    inputs: [{ kind: "cut", key: "kept", label: "keep", min: 1, max: 4 }],
    summary: "ρ of the kept qubits (others traced out), with purity Tr ρ² and entropy." },
  { id: "mutualinfo", title: "Mutual information", category: "entanglement", mode: "live", maxQubits: 12, minQubits: 2, inputs: [],
    summary: "I(i:j) = S(i) + S(j) − S(ij) for every pair, in bits: total (classical + quantum) correlation." },
  { id: "negativity", title: "Negativity", category: "entanglement", mode: "live", maxQubits: 12, minQubits: 2, inputs: [],
    summary: "Pairwise log-negativity E_N: > 0 exactly when a pair is entangled (PPT test)." },
  { id: "concurrence", title: "Concurrence", category: "entanglement", mode: "live", maxQubits: 10, minQubits: 2, inputs: [],
    summary: "Pairwise Wootters concurrence: 0 separable … 1 Bell pair." },
  { id: "schmidt", title: "Schmidt spectrum", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 2,
    inputs: [{ ...cut, max: 6 }],
    summary: "Squared Schmidt coefficients across the cut A | rest, with entanglement entropy and rank." },
  { id: "profile", title: "Entropy profile", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 2, inputs: [],
    summary: "Entanglement entropy across every contiguous cut: area law vs volume law." },
  { id: "page", title: "Page curve", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 2, inputs: [],
    summary: "Entropy profile against the Haar-random (Page) average: how scrambled is the state?" },
  { id: "renyi", title: "Rényi spectrum", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 2,
    inputs: [{ ...cut, max: 6 }],
    summary: "Rényi entropies S_α across the cut, from the log rank (α→0) to the min-entropy (α→∞)." },
];

export const ANALYSIS_BY_ID: Record<string, AnalysisMeta> = Object.fromEntries(ANALYSES.map((a) => [a.id, a]));

/** Default bipartition: the first half of the register. */
export const defaultCut = (n: number) => [...Array(Math.max(1, Math.floor(n / 2))).keys()];

/** Default value of a cut input, shared by the UI and the compute side. */
export function cutDefault(meta: AnalysisMeta, key: string, n: number): number[] {
  return meta.id === "density" && key === "kept" ? [0] : defaultCut(n);
}

export function analysesIn(cat: Category): AnalysisMeta[] {
  return ANALYSES.filter((a) => a.category === cat);
}
