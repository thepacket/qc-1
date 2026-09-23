import type { AnalysisMeta, Category, InputSpec, Opts } from "./types";

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

// Phase 2: remaining state-only analyses (validated: test/fixtures/state2.json).
ANALYSES.push(
  // Measurement
  { id: "anticoncentration", title: "Anticoncentration", category: "measurement", mode: "live", maxQubits: 16, minQubits: 2, inputs: [],
    summary: "Histogram of D·p against the Porter–Thomas law e^(−y); R = D·Σp² is 1 flat, 2 Porter–Thomas, ≫2 peaked." },
  // Phase space & magic
  { id: "wigner", title: "Discrete Wigner", category: "phase", mode: "live", maxQubits: 4, inputs: [],
    summary: "Wootters phase-space quasi-probability; negative cells signal non-classicality." },
  { id: "husimi", title: "Husimi Q", category: "phase", mode: "live", maxQubits: 7, inputs: [],
    summary: "Overlap with spin-coherent states |θ,φ⟩⊗ⁿ over the sphere; never negative." },
  { id: "magic", title: "Magic (M₂)", category: "phase", mode: "live", maxQubits: 6, inputs: [],
    summary: "Stabilizer 2-Rényi entropy: 0 exactly for stabilizer states; T gates raise it." },
  { id: "magicspectrum", title: "Magic spectrum", category: "phase", mode: "live", maxQubits: 6, inputs: [],
    summary: "Stabilizer Rényi entropies M_α across α: the shape of the non-stabilizerness." },
  { id: "charfunction", title: "Characteristic function", category: "phase", mode: "live", maxQubits: 4, inputs: [],
    summary: "|χ(u,v)| = |⟨P⟩| on the (X-support, Z-support) lattice; the Fourier dual of Wigner." },
  { id: "majorana", title: "Majorana stars", category: "phase", mode: "live", maxQubits: 6, inputs: [],
    summary: "The symmetric part of the state as n stars on the sphere." },
  // Entanglement & correlations
  { id: "tripartite", title: "Tripartite information", category: "entanglement", mode: "live", maxQubits: 14, minQubits: 4,
    inputs: [
      { kind: "qubit", key: "a", label: "A", fallback: "first" },
      { kind: "qubit", key: "b", label: "B", fallback: "second" },
      { kind: "qubit", key: "c", label: "C", fallback: "last" },
    ],
    summary: "I₃ = I(A:B) + I(A:C) − I(A:BC); negative means information about A is scrambled into BC." },
  { id: "totalcorr", title: "Total correlation", category: "entanglement", mode: "live", maxQubits: 14, minQubits: 2, inputs: [],
    summary: "Multi-information Σ S(qᵢ) − S(all): every qubit's entanglement with the rest, added up." },
  { id: "chsh", title: "CHSH nonlocality", category: "entanglement", mode: "live", maxQubits: 12, minQubits: 2, inputs: [],
    summary: "Maximal CHSH value per pair (Horodecki); above 2 the pair violates a Bell inequality." },
  { id: "discord", title: "Quantum discord", category: "entanglement", mode: "live", maxQubits: 8, minQubits: 2, inputs: [],
    summary: "D(A|B): correlation beyond what a measurement on B can reveal; can be non-zero without entanglement." },
  { id: "zz", title: "ZZ correlations", category: "entanglement", mode: "live", maxQubits: 16, minQubits: 2, inputs: [],
    summary: "Connected ⟨ZᵢZⱼ⟩ − ⟨Zᵢ⟩⟨Zⱼ⟩: aligned (+) or anti-aligned (−) spins." },
  { id: "corrlength", title: "Correlation length", category: "entanglement", mode: "live", maxQubits: 16, minQubits: 3, inputs: [],
    summary: "ξ from an exponential fit to the average |ZZ| correlation versus distance." },
  { id: "structure", title: "Structure factor", category: "entanglement", mode: "live", maxQubits: 16, minQubits: 2, inputs: [],
    summary: "S(k): Fourier transform of the ZZ correlations; k = 0 ferromagnetic, k = π Néel order." },
  { id: "symmetry", title: "Symmetry sectors", category: "entanglement", mode: "live", maxQubits: 20, inputs: [],
    summary: "Weight in each excitation-number sector and the Z₂ parity ⟨ΠZ⟩." },
  { id: "counting", title: "Counting statistics", category: "entanglement", mode: "live", maxQubits: 20, inputs: [{ ...cut, max: 20 }],
    summary: "Distribution of the number of 1s in region A; its variance is the charge fluctuation." },
  { id: "contour", title: "Entanglement contour", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 2,
    inputs: [{ kind: "int", key: "size", label: "region size", min: 1, max: -1, fallback: 0 }],
    summary: "Where a region's entropy comes from: S([0..j]) − S([0..j−1]) per site." },
  { id: "schmidtgap", title: "Schmidt gap", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 2, inputs: [],
    summary: "λ₁ − λ₂ across every cut; it closes at a critical point." },
  { id: "entham", title: "Entanglement Hamiltonian", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 2,
    inputs: [{ ...cut, max: 6 }],
    summary: "Entanglement energies ξᵢ = −ln λᵢ (Li–Haldane spectrum) across the cut." },
  { id: "entstats", title: "Entanglement-spectrum statistics", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 3,
    inputs: [{ ...cut, max: 8 }],
    summary: "Gap ratios of the entanglement spectrum: ⟨r⟩ ≈ 0.386 Poisson (localized), 0.536 GOE (ergodic)." },
  { id: "mps", title: "MPS bond dimension", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 2,
    inputs: [{ kind: "choice", key: "target", label: "error", fallback: 0.01, options: [
      { label: "10⁻¹", value: 0.1 }, { label: "10⁻²", value: 0.01 }, { label: "10⁻³", value: 0.001 }, { label: "10⁻⁶", value: 1e-6 },
    ] }],
    summary: "Bond dimension χ a matrix-product state needs at each cut for the chosen truncation error." },
  { id: "negspectrum", title: "Negativity spectrum", category: "entanglement", mode: "live", maxQubits: 6, minQubits: 2, inputs: [cut],
    summary: "Eigenvalues of the partial transpose across the cut; the negative ones are the entanglement." },
  { id: "ptmoments", title: "PT moments", category: "entanglement", mode: "live", maxQubits: 6, minQubits: 2, inputs: [cut],
    summary: "Moments Tr[(ρ^T_A)ⁿ]; p₃ < p₂² certifies entanglement from low moments alone." },
  { id: "threetangle", title: "Three-tangle", category: "entanglement", mode: "live", maxQubits: 3, minQubits: 3,
    inputs: [{ kind: "qubit", key: "a", label: "focal", fallback: "first" }],
    summary: "Genuine tripartite entanglement τ₃ (CKW): 1 for GHZ, 0 for W." },
  { id: "multifractal", title: "Multifractal dimensions", category: "entanglement", mode: "live", maxQubits: 16, inputs: [],
    summary: "Generalized fractal dimensions D_q of the basis distribution: 1 delocalized, 0 localized." },
  { id: "coherence", title: "Coherence", category: "entanglement", mode: "live", maxQubits: 20, inputs: [],
    summary: "l₁-norm and relative-entropy coherence in the computational basis." },
);

export const ANALYSIS_BY_ID: Record<string, AnalysisMeta> = Object.fromEntries(ANALYSES.map((a) => [a.id, a]));

/** Default bipartition: the first half of the register. */
export const defaultCut = (n: number) => [...Array(Math.max(1, Math.floor(n / 2))).keys()];

/** Default value of a cut input, shared by the UI and the compute side. */
export function cutDefault(meta: AnalysisMeta, key: string, n: number): number[] {
  return meta.id === "density" && key === "kept" ? [0] : defaultCut(n);
}

/** Resolved value of a qubit / int / choice input (options or default). */
export function inputValue(spec: InputSpec, opts: Opts, n: number): number {
  const v = opts[spec.key];
  if (spec.kind === "qubit") {
    if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n) return v as number;
    return spec.fallback === "first" ? 0 : spec.fallback === "second" ? Math.min(1, n - 1) : n - 1;
  }
  if (spec.kind === "int") {
    const hi = spec.max <= 0 ? n + spec.max : spec.max;
    if (Number.isInteger(v) && (v as number) >= spec.min && (v as number) <= hi) return v as number;
    return spec.fallback > 0 ? Math.min(spec.fallback, hi) : Math.max(spec.min, hi);
  }
  if (spec.kind === "choice") {
    return typeof v === "number" && spec.options.some((o) => o.value === v) ? v : spec.fallback;
  }
  return 0;
}

export function analysesIn(cat: Category): AnalysisMeta[] {
  return ANALYSES.filter((a) => a.category === cat);
}
