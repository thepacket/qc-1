import type { AnalysisMeta, Category, InputSpec, Opts } from "./types";
import { defaultObservable } from "./pauliPresets";
import { internalPauliSum } from "../calc/order";

/**
 * LAB groups, in display order. A panel has one home group and may be listed
 * in others too (`also`), so a subject-focused group never duplicates code.
 */
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "state", label: "State" },
  { id: "measurement", label: "Measurement" },
  { id: "phase", label: "Phase space & magic" },
  { id: "entanglement", label: "Entanglement: bipartite" },
  { id: "correlations", label: "Multipartite & correlations" },
  { id: "entspectrum", label: "Entanglement spectrum" },
  { id: "metrology", label: "Expectation & metrology" },
  { id: "geometry", label: "Geometry & topology" },
  { id: "variational", label: "Variational optimisation" },
  { id: "dynamics", label: "Dynamics" },
  { id: "chaos", label: "Chaos & scrambling" },
  { id: "operator", label: "Operator & spectrum" },
  { id: "thermal", label: "Thermalisation & thermodynamics" },
  { id: "structure", label: "Circuit structure" },
  { id: "tools", label: "Circuit tools" },
  { id: "noise", label: "Noise & error" },
  { id: "bench", label: "Characterization & benchmarking" },
  { id: "estimation", label: "Tomography & estimation" },
  { id: "qec", label: "Error correction" },
  { id: "plotting", label: "Visualisation & plotting" },
  { id: "verify", label: "Verification & export" },
];

const cut = { kind: "cut" as const, key: "cut", label: "A" };

/**
 * Every analysis the LAB offers. Compute functions live in run.ts (analysis
 * worker). maxQubits 1024: the analysis doesn't read the statevector (the
 * structural ones, the benchmarks), so it also runs in stabilizer mode.
 */
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
    inputs: [{ kind: "cut", key: "kept", label: "keep", min: 1, max: 6 }],
    summary: "ρ of the kept qubits (others traced out), with purity Tr ρ² and entropy." },
  { id: "mutualinfo", title: "Mutual information", category: "entanglement", mode: "live", maxQubits: 12, minQubits: 2, inputs: [],
    summary: "I(i:j) = S(i) + S(j) − S(ij) for every pair, in bits: total (classical + quantum) correlation." },
  { id: "negativity", title: "Negativity", category: "entanglement", mode: "live", maxQubits: 12, minQubits: 2, inputs: [],
    summary: "Pairwise log-negativity E_N: > 0 exactly when a pair is entangled (PPT test)." },
  { id: "concurrence", title: "Concurrence", category: "entanglement", mode: "live", maxQubits: 10, minQubits: 2, inputs: [],
    summary: "Pairwise Wootters concurrence: 0 separable … 1 Bell pair." },
  { id: "schmidt", title: "Schmidt spectrum", category: "entanglement", also: ["entspectrum"], mode: "live", maxQubits: 20, minQubits: 2,
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
  { id: "tripartite", title: "Tripartite information", category: "correlations", mode: "live", maxQubits: 14, minQubits: 4,
    inputs: [
      { kind: "qubit", key: "a", label: "A", fallback: "first" },
      { kind: "qubit", key: "b", label: "B", fallback: "second" },
      { kind: "qubit", key: "c", label: "C", fallback: "last" },
    ],
    summary: "I₃ = I(A:B) + I(A:C) − I(A:BC); negative means information about A is scrambled into BC." },
  { id: "totalcorr", title: "Total correlation", category: "correlations", mode: "live", maxQubits: 14, minQubits: 2, inputs: [],
    summary: "Multi-information Σ S(qᵢ) − S(all): total classical and quantum correlations, including mixed states." },
  { id: "chsh", title: "CHSH nonlocality", category: "correlations", mode: "live", maxQubits: 12, minQubits: 2, inputs: [],
    summary: "Maximal CHSH value per pair (Horodecki); above 2 the pair violates a Bell inequality." },
  { id: "discord", title: "Quantum discord", category: "correlations", mode: "live", maxQubits: 8, minQubits: 2, inputs: [],
    summary: "D(A|B): correlation beyond what a measurement on B can reveal; can be non-zero without entanglement." },
  { id: "zz", title: "ZZ correlations", category: "correlations", mode: "live", maxQubits: 16, minQubits: 2, inputs: [],
    summary: "Connected ⟨ZᵢZⱼ⟩ − ⟨Zᵢ⟩⟨Zⱼ⟩: aligned (+) or anti-aligned (−) spins." },
  { id: "corrlength", title: "Correlation length", category: "correlations", mode: "live", maxQubits: 16, minQubits: 3, inputs: [],
    summary: "ξ from an exponential fit to the average |ZZ| correlation versus distance." },
  { id: "structure", title: "Structure factor", category: "correlations", mode: "live", maxQubits: 16, minQubits: 2, inputs: [],
    summary: "S(k): Fourier transform of the ZZ correlations; k = 0 ferromagnetic, k = π Néel order." },
  { id: "symmetry", title: "Symmetry sectors", category: "correlations", mode: "live", maxQubits: 20, inputs: [],
    summary: "Weight in each excitation-number sector and the Z₂ parity ⟨ΠZ⟩." },
  { id: "counting", title: "Counting statistics", category: "correlations", mode: "live", maxQubits: 20, inputs: [{ ...cut, max: 20 }],
    summary: "Distribution of the number of 1s in region A; its variance is the charge fluctuation." },
  { id: "contour", title: "Prefix conditional entropy", category: "entanglement", mode: "live", maxQubits: 20, minQubits: 2,
    inputs: [{ kind: "int", key: "size", label: "region size", min: 1, max: -1, fallback: 0 }],
    summary: "S(qⱼ | q₀…qⱼ₋₁) = S(q₀…qⱼ) − S(q₀…qⱼ₋₁) for each site of the region q₀…: it sums to S(region) but depends on the order and can be negative, so it is not an entanglement contour." },
  { id: "schmidtgap", title: "Schmidt gap", category: "entspectrum", mode: "live", maxQubits: 20, minQubits: 2, inputs: [],
    summary: "λ₁ − λ₂ across every cut; it closes at a critical point." },
  { id: "entham", title: "Entanglement Hamiltonian", category: "entspectrum", mode: "live", maxQubits: 20, minQubits: 2,
    inputs: [{ ...cut, max: 6 }],
    summary: "Entanglement energies ξᵢ = −ln λᵢ (Li–Haldane spectrum) across the cut." },
  { id: "entstats", title: "Entanglement-spectrum statistics", category: "entspectrum", mode: "live", maxQubits: 20, minQubits: 3,
    inputs: [{ ...cut, max: 8 }],
    summary: "Gap ratios of the entanglement spectrum: ⟨r⟩ ≈ 0.386 Poisson (localized), 0.536 GOE (ergodic)." },
  { id: "mps", title: "MPS bond dimension", category: "entspectrum", mode: "live", maxQubits: 20, minQubits: 2,
    inputs: [{ kind: "choice", key: "target", label: "error", fallback: 0.01, options: [
      { label: "10⁻¹", value: 0.1 }, { label: "10⁻²", value: 0.01 }, { label: "10⁻³", value: 0.001 }, { label: "10⁻⁶", value: 1e-6 },
    ] }],
    summary: "Bond dimension χ a matrix-product state needs at each cut for the chosen truncation error." },
  { id: "negspectrum", title: "Negativity spectrum", category: "entanglement", also: ["entspectrum"], mode: "live", maxQubits: 6, minQubits: 2, inputs: [cut],
    summary: "Eigenvalues of the partial transpose across the cut; the negative ones are the entanglement." },
  { id: "ptmoments", title: "PT moments", category: "entanglement", mode: "live", maxQubits: 6, minQubits: 2, inputs: [cut],
    summary: "Moments Tr[(ρ^T_A)ⁿ]; p₃ < p₂² certifies entanglement from low moments alone." },
  { id: "threetangle", title: "Three-tangle", category: "correlations", mode: "live", maxQubits: 3, minQubits: 3,
    inputs: [{ kind: "qubit", key: "a", label: "focal", fallback: "first" }],
    summary: "Genuine tripartite entanglement τ₃ (CKW): 1 for GHZ, 0 for W." },
  { id: "multifractal", title: "Multifractal dimensions", category: "state", mode: "live", maxQubits: 16, inputs: [],
    summary: "Generalized fractal dimensions D_q of the basis distribution: 1 delocalized, 0 localized." },
  { id: "coherence", title: "Coherence", category: "state", mode: "live", maxQubits: 20, inputs: [],
    summary: "l₁-norm and relative-entropy coherence in the computational basis." },
);

// Phase 4: expectation & metrology (validated: fixtures metrology, metrology-symbolic).
const obs = { kind: "pauli" as const, key: "obs", label: "observable" };
ANALYSES.push(
  { id: "expectation", title: "Expectation value", category: "metrology", mode: "live", maxQubits: 20, inputs: [
      obs,
      { kind: "choice", key: "shots", label: "shots", fallback: 1000, options: [
        { label: "100", value: 100 }, { label: "1k", value: 1000 }, { label: "10k", value: 10000 }, { label: "100k", value: 100000 },
      ] },
    ],
    summary: "⟨H⟩ for a Pauli string or Pauli sum, with its variance and the shot-noise error σ/√N." },
  { id: "optimise", title: "Optimise ⟨H⟩ (VQE)", category: "variational", also: ["metrology"], mode: "run", maxQubits: 12, inputs: [
      obs,
      { kind: "choice", key: "goal", label: "goal", fallback: 0, options: [{ label: "min", value: 0 }, { label: "max", value: 1 }] },
      { kind: "choice", key: "method", label: "method", fallback: 0, options: [{ label: "Adam", value: 0 }, { label: "SGD", value: 1 }, { label: "QNG", value: 2 }] },
      { kind: "choice", key: "steps", label: "steps", fallback: 60, options: [{ label: "20", value: 20 }, { label: "60", value: 60 }, { label: "200", value: 200 }] },
    ],
    summary: "Gradient descent on ⟨H⟩ over the circuit's symbols (finite differences); apply the result to the sliders." },
  { id: "landscape", title: "Landscape", category: "variational", also: ["metrology"], mode: "run", maxQubits: 12, inputs: [
      obs,
      { kind: "symbol", key: "s1", label: "x", fallback: "first" },
      { kind: "symbol", key: "s2", label: "y", fallback: "second", optional: true },
    ],
    summary: "⟨H⟩ as one or two symbols sweep [−π, π]: a curve or a heatmap." },
  { id: "plateau", title: "Barren-plateau check", category: "variational", also: ["metrology"], mode: "run", maxQubits: 12, inputs: [
      obs,
      { kind: "choice", key: "samples", label: "samples", fallback: 50, options: [{ label: "20", value: 20 }, { label: "50", value: 50 }, { label: "200", value: 200 }] },
    ],
    summary: "Variance of ∂⟨H⟩/∂θ over random parameter points; exponentially small means a barren plateau." },
  { id: "qfi", title: "Quantum Fisher information", category: "metrology", mode: "live", maxQubits: 20, inputs: [
      { kind: "choice", key: "axis", label: "axis", fallback: 0, options: [{ label: "Jx", value: 0 }, { label: "Jy", value: 1 }, { label: "Jz", value: 2 }] },
    ],
    summary: "F_Q = 4 Var(J) for collective rotations: > N witnesses entanglement, N² is the Heisenberg limit." },
  { id: "multiqfi", title: "QFI matrix", category: "metrology", mode: "live", maxQubits: 14, inputs: [],
    summary: "3×3 QFI matrix over Jx, Jy, Jz; its top eigenvalue is the best single-axis QFI." },
  { id: "squeezing", title: "Spin squeezing", category: "metrology", mode: "live", maxQubits: 14, minQubits: 2, inputs: [],
    summary: "Wineland ξ² = N·min ΔJ⊥² / |⟨J⟩|²; below 1 is squeezed (and entangled)." },
  { id: "qgt", title: "Quantum geometric tensor", category: "geometry", also: ["metrology"], mode: "live", maxQubits: 12, inputs: [],
    summary: "Fubini–Study metric and Berry curvature over the circuit's symbols (finite differences)." },
  { id: "blochpath", title: "Bloch trajectory", category: "state", mode: "run", maxQubits: 12,
    inputs: [{ kind: "qubit", key: "q", label: "qubit", fallback: "first" }],
    summary: "Each qubit's Bloch vector as t sweeps [0, 2π]: the path it traces on its sphere." },
  { id: "participation", title: "Participation", category: "state", mode: "live", maxQubits: 16, inputs: [],
    summary: "Inverse participation ratio, participation ratio and entropies of the basis distribution; plus its growth along the circuit." },
);

// Phase 5a: operator & spectrum (validated: spectrum-circuits, -hamiltonians, -geometry).
const H = { kind: "pauli" as const, key: "obs", label: "H" };
const twoSym = [
  { kind: "symbol" as const, key: "s1", label: "x", fallback: "first" as const },
  { kind: "symbol" as const, key: "s2", label: "y", fallback: "second" as const },
];
ANALYSES.push(
  { id: "unitary", title: "Unitary matrix", category: "operator", mode: "live", maxQubits: 6, inputs: [],
    summary: "The circuit's whole operator U in the computational basis: colour = phase, opacity = |Uᵢⱼ|." },
  { id: "ptm", title: "Pauli transfer matrix", category: "operator", mode: "live", maxQubits: 3, inputs: [],
    summary: "Rᵢⱼ = Tr(Pᵢ U Pⱼ U†)/2ⁿ: what the circuit does to each Pauli; a Clifford is a signed permutation." },
  { id: "opent", title: "Operator entanglement", category: "operator", mode: "live", maxQubits: 6, minQubits: 2, inputs: [],
    summary: "Operator-Schmidt spectrum of U across the middle cut: 0 for a product, 1 ebit for a CNOT." },
  { id: "floquet", title: "Floquet spectrum", category: "operator", mode: "run", maxQubits: 6, inputs: [],
    summary: "Eigenphases of U on the unit circle, with circular level-spacing statistics." },
  { id: "hamspectrum", title: "Hamiltonian spectrum", category: "operator", mode: "live", maxQubits: 6, inputs: [H],
    summary: "Exact energy levels of a Pauli-sum H, the ground energy and gap, with ⟨H⟩ of the current state." },
  { id: "dos", title: "Density of states", category: "operator", mode: "live", maxQubits: 6, inputs: [H],
    summary: "Histogram of H's energy levels." },
  { id: "levelstats", title: "Level statistics", category: "chaos", also: ["operator"], mode: "live", maxQubits: 6, minQubits: 2, inputs: [H],
    summary: "Gap ratio ⟨r⟩ of H's spectrum: 0.386 Poisson (integrable), 0.531 GOE (chaotic)." },
  { id: "sff", title: "Spectral form factor", category: "chaos", also: ["operator"], mode: "live", maxQubits: 6, inputs: [H],
    summary: "|Σ e^(−iEt)|²/D² on log-log axes: dip, ramp, plateau." },
  { id: "krylov", title: "Krylov complexity", category: "chaos", also: ["operator"], mode: "live", maxQubits: 6, inputs: [H],
    summary: "Lanczos coefficients bₙ of H from the current state, and the spread complexity C(t)." },
  { id: "diagens", title: "Diagonal ensemble", category: "thermal", mode: "live", maxQubits: 6, inputs: [H],
    summary: "The state's weight on each energy level of H, ⟨H⟩, ΔE and the effective dimension." },
  { id: "efftemp", title: "Effective temperature", category: "thermal", mode: "live", maxQubits: 6, inputs: [H],
    summary: "Boltzmann fit ln p = c − βE to the energy populations, and the β of the Gibbs state with the same ⟨H⟩ (non-degenerate H)." },
  { id: "eth", title: "ETH matrix elements", category: "thermal", mode: "run", maxQubits: 5, inputs: [
      H, { kind: "pauli", key: "o", label: "O" },
    ],
    summary: "|⟨Eₘ|O|Eₙ⟩|² against ω = Eₘ − Eₙ, and the diagonal ⟨Eₙ|O|Eₙ⟩ (non-degenerate H)." },
  { id: "eigent", title: "Eigenstate entanglement", category: "thermal", mode: "run", maxQubits: 6, minQubits: 2, inputs: [H],
    summary: "Half-chain entropy of every eigenstate of H against its energy: volume-law arch vs area law." },
  { id: "workdist", title: "Work distribution", category: "thermal", mode: "run", maxQubits: 5, inputs: [H],
    summary: "Two-point-measurement work W = Eₘ − Eₙ for the circuit as a quench from |0…0⟩ (energy-level projectors)." },
  { id: "berry", title: "Berry phase", category: "geometry", mode: "run", maxQubits: 12, inputs: [
      ...twoSym,
      { kind: "choice", key: "radius", label: "loop", fallback: 0.5, options: [
        { label: "±0.25", value: 0.25 }, { label: "±0.5", value: 0.5 }, { label: "±π/2", value: Math.PI / 2 },
      ] },
    ],
    summary: "Geometric phase around a square loop in two symbols, centred on their current values (discrete Wilson loop)." },
  { id: "chern", title: "Chern number", category: "geometry", mode: "run", maxQubits: 12, inputs: [
      ...twoSym,
      { kind: "choice", key: "grid", label: "grid", fallback: 12, options: [{ label: "8", value: 8 }, { label: "12", value: 12 }, { label: "24", value: 24 }] },
    ],
    summary: "Berry flux over the torus of two symbols in [0, 2π): an integer for a topological band." },
  { id: "zx", title: "ZX diagram", category: "structure", mode: "live", maxQubits: 1024, inputs: [],
    summary: "The circuit as a ZX-calculus diagram: green Z and red X spiders, Hadamard boxes." },
);

// Phase 5b: dynamics (validated: fixture dynamics). The t-sweeps need the symbol t in the tape.
const qW = { kind: "qubit" as const, key: "w", label: "W on", fallback: "first" as const };
const qV = { kind: "qubit" as const, key: "v", label: "V on", fallback: "last" as const };
ANALYSES.push(
  { id: "tsweep", title: "⟨Z⟩ over t", category: "dynamics", mode: "live", maxQubits: 14, inputs: [],
    summary: "Every qubit's ⟨Z⟩ as t sweeps one period [0, 2π]: Rabi, Larmor, Trotterised dynamics as curves." },
  { id: "tsweepfft", title: "⟨Z⟩ spectrum", category: "dynamics", mode: "live", maxQubits: 14,
    inputs: [{ kind: "qubit", key: "q", label: "qubit", fallback: "first" }],
    summary: "Fourier spectrum of ⟨Z⟩(t) over one period: a peak at bin m is m oscillations per period." },
  { id: "loschmidt", title: "Loschmidt echo", category: "dynamics", mode: "live", maxQubits: 14, inputs: [],
    summary: "Return probability |⟨ψ(0)|ψ(t)⟩|² and its rate function; cusps mark dynamical phase transitions." },
  { id: "imbalance", title: "Imbalance", category: "dynamics", mode: "live", maxQubits: 14, inputs: [],
    summary: "Staggered magnetisation (1/n)Σ(−1)ⁱ⟨Zᵢ⟩ over t: it decays when thermalising, stays in localised phases." },
  { id: "entvelocity", title: "Entanglement growth rate", category: "dynamics", mode: "live", maxQubits: 12, minQubits: 2, inputs: [],
    summary: "Half-cut entropy S(t) and its steepest slope max dS/dt, in bits per unit of the parameter t." },
  { id: "negdyn", title: "Negativity over t", category: "dynamics", mode: "live", maxQubits: 12, minQubits: 2, inputs: [{ ...cut, max: 6 }],
    summary: "Log-negativity across the cut as t sweeps: growth, oscillation, sudden death and revival." },
  { id: "otoc", title: "OTOC", category: "chaos", also: ["dynamics"], mode: "run", maxQubits: 6, minQubits: 2, inputs: [qW, qV],
    summary: "C(t) = 1 − Re⟨W(t)VW(t)V⟩ on |0…0⟩ with Z operators: it rises when the operator front reaches V." },
  { id: "otoccone", title: "OTOC light cone", category: "chaos", also: ["dynamics"], mode: "run", maxQubits: 5, minQubits: 2, inputs: [qW],
    summary: "OTOC over every qubit and t: the operator light cone." },
  { id: "butterfly", title: "Butterfly velocity", category: "chaos", also: ["dynamics"], mode: "run", maxQubits: 5, minQubits: 2, inputs: [qW],
    summary: "Arrival time of the OTOC front at each distance, and the fitted speed v_B." },
  { id: "lyapunov", title: "OTOC growth rate", category: "chaos", also: ["dynamics"], mode: "run", maxQubits: 6, minQubits: 2, inputs: [qW, qV],
    summary: "Slope of ln C(t) over the OTOC's first rising window, with the fit's R²: an empirical rate, a Lyapunov exponent only for chaotic dynamics." },
  { id: "opweight", title: "Operator weight", category: "chaos", also: ["dynamics"], mode: "run", maxQubits: 4, inputs: [
      { kind: "qubit", key: "w", label: "Z on", fallback: "first" },
    ],
    summary: "How Z on one qubit spreads under W(t) = U†WU: weight by Pauli support size, over t." },
  { id: "autocorr", title: "Autocorrelation", category: "dynamics", mode: "run", maxQubits: 6,
    inputs: [{ kind: "qubit", key: "q", label: "qubit", fallback: "first" }],
    summary: "Infinite-temperature ⟨Z(t)Z(0)⟩ and its spectrum: how long a qubit remembers its polarisation." },
  { id: "spacetime", title: "Space-time ⟨Z⟩", category: "dynamics", mode: "live", maxQubits: 14, inputs: [],
    summary: "⟨Z⟩ of every qubit after every circuit step." },
  { id: "spacetimeS", title: "Space-time entropy", category: "dynamics", mode: "live", maxQubits: 12, inputs: [],
    summary: "Each qubit's entanglement entropy after every circuit step: the entanglement front." },
  { id: "asymmetry", title: "Entanglement asymmetry", category: "dynamics", mode: "live", maxQubits: 12, minQubits: 2, inputs: [],
    summary: "How much the first half breaks the excitation-number symmetry, after every step (quantum Mpemba)." },
  { id: "lightcone", title: "Light cone", category: "structure", mode: "live", maxQubits: 1024, inputs: [
      { kind: "qubit", key: "q", label: "qubit", fallback: "first" },
      { kind: "choice", key: "dir", label: "cone", fallback: 0, options: [{ label: "backward", value: 0 }, { label: "forward", value: 1 }] },
    ],
    summary: "The circuit steps that can influence a qubit's final state (backward) or that its input can reach (forward)." },
);

// Phase 6: circuit tools (validated: fixtures tools, synth) and structure.
const coupling = { kind: "choice" as const, key: "coupling", label: "map", fallback: 0, options: [{ label: "line", value: 0 }, { label: "ring", value: 1 }, { label: "2-row grid", value: 2 }] };
const target = { kind: "choice" as const, key: "target", label: "to", fallback: 1, options: [{ label: "Clifford+T", value: 0 }, { label: "IBM", value: 1 }, { label: "Rigetti", value: 2 }] };
ANALYSES.push(
  { id: "simplify", title: "Simplify", category: "tools", mode: "run", maxQubits: 20, inputs: [
      { kind: "choice", key: "deep", label: "passes", fallback: 0, options: [{ label: "peephole", value: 0 }, { label: "deep", value: 1 }] },
    ],
    summary: "Cancel and merge neighbouring gates (H·H, S·S†, RZ·RZ, CX·CX, H·CX·H → CZ…); checks the result is the same operator before offering it." },
  { id: "transpile", title: "Transpile", category: "tools", mode: "run", maxQubits: 20, inputs: [target],
    summary: "Rewrite into a device gate set: Clifford+T, IBM (RZ, SX, CX) or Rigetti (RZ, RX±π/2, CZ); arbitrary 2-qubit gates go through a KAK decomposition." },
  { id: "route", title: "Route", category: "tools", mode: "run", maxQubits: 20, minQubits: 2, inputs: [coupling],
    summary: "Insert SWAPs so every 2-qubit gate acts on neighbours of a coupling map (greedy, shortest paths). Qubits end up relabelled." },
  { id: "compile", title: "Compile", category: "tools", mode: "run", maxQubits: 20, inputs: [
      target,
      { kind: "choice", key: "coupling", label: "map", fallback: 0, options: [{ label: "none", value: 0 }, { label: "line", value: 1 }, { label: "ring", value: 2 }, { label: "grid", value: 3 }] },
    ],
    summary: "Transpile, optimise, route, optimise: one pass to a device, with the gate count after each stage." },
  { id: "inverse", title: "Inverse U†", category: "tools", mode: "run", maxQubits: 20, inputs: [
      { kind: "choice", key: "mode", label: "", fallback: 0, options: [{ label: "append U†", value: 0 }, { label: "replace by U†", value: 1 }] },
    ],
    summary: "Reverse the circuit and invert every gate. Appending gives a mirror circuit that returns to |0…0⟩." },
  { id: "trotter", title: "Trotter circuit", category: "tools", mode: "run", maxQubits: 20, inputs: [
      { kind: "pauli", key: "ham", label: "H" },
      { kind: "int", key: "steps", label: "steps", min: 1, max: 8, fallback: 2 },
      { kind: "choice", key: "order", label: "order", fallback: 0, options: [{ label: "1", value: 0 }, { label: "2", value: 1 }, { label: "4", value: 2 }] },
      { kind: "choice", key: "mode", label: "", fallback: 0, options: [{ label: "product", value: 0 }, { label: "QDrift", value: 1 }] },
    ],
    summary: "Build e^{−iH·steps·t} as a product formula in the symbol t, and show its error against the exact evolution at the current t." },
  { id: "stateprep", title: "State preparation", category: "tools", mode: "run", maxQubits: 20, inputs: [{ kind: "state", key: "target", label: "target" }],
    summary: "A circuit that prepares a target state (or the current one) from |0…0⟩ with RY, RZ and CX." },
  { id: "synth", title: "Unitary synthesis", category: "tools", mode: "run", maxQubits: 4, inputs: [],
    summary: "Re-synthesise the circuit's unitary from two-level controlled 2×2 gates (exact, not gate-optimal)." },
  { id: "resources", title: "Resources", category: "structure", mode: "live", maxQubits: 1024, inputs: [
      { kind: "choice", key: "coupling", label: "check map", fallback: 0, options: [{ label: "none", value: 0 }, { label: "line", value: 1 }, { label: "ring", value: 2 }, { label: "grid", value: 3 }] },
    ],
    summary: "Gate counts, depth, T count and T-depth, CX and Clifford counts, as Qiskit counts the exported circuit." },
  { id: "interaction", title: "Interaction graph", category: "structure", mode: "live", maxQubits: 1024, minQubits: 2, inputs: [],
    summary: "How many gates act on each pair of qubits: the connectivity a device needs." },
  { id: "tanner", title: "Tanner graph", category: "structure", mode: "live", maxQubits: 1024, inputs: [],
    summary: "Measurements (checks) against the qubits in each one's backward light cone." },
  { id: "branches", title: "Measurement branches", category: "measurement", mode: "live", maxQubits: 12, inputs: [],
    summary: "Every measurement history with its probability: the tree a program's mid-circuit measurements and IF gates produce." },
  { id: "tableau", title: "Stabilizer tableau", category: "structure", mode: "live", maxQubits: 1024, inputs: [],
    summary: "For Clifford circuits: the n Pauli operators that fix the state (Bell → +XX, +ZZ)." },
);

// Phase 8: noise (validated: fixtures noise, noise-analyses). All need the noise model on.
ANALYSES.push(
  { id: "noisemodel", title: "Noise model", category: "noise", mode: "live", maxQubits: 1024, inputs: [],
    summary: "Turn noise on and set its rates: depolarizing, T1/T2 damping, readout, crosstalk; device presets and calibration files." },
  { id: "impact", title: "Noise impact", category: "noise", mode: "live", maxQubits: 10, inputs: [],
    summary: "Fidelity and trace distance of the noisy state to the ideal one, its purity and entropy." },
  { id: "decoherence", title: "Decoherence by depth", category: "noise", mode: "run", maxQubits: 6, inputs: [],
    summary: "Fidelity to the ideal state and purity after every step: how noise accumulates along the circuit." },
  { id: "mixedspectrum", title: "Mixed-state spectrum", category: "noise", mode: "live", maxQubits: 8, inputs: [],
    summary: "Eigenvalues of the noisy ρ, its purity, effective rank and entropy." },
  { id: "coherentinfo", title: "Coherent information", category: "noise", mode: "live", maxQubits: 8, minQubits: 2, inputs: [cut],
    summary: "I(A⟩B) = S(B) − S(AB) of the noisy state: positive means quantum correlations survive." },
  { id: "noisycoherence", title: "Noisy coherence", category: "noise", mode: "live", maxQubits: 8, inputs: [],
    summary: "Computational-basis coherence (l1 and relative entropy) of the noisy state against the ideal one." },
  { id: "paulibudget", title: "Pauli error budget", category: "noise", mode: "live", maxQubits: 1024, inputs: [],
    summary: "Each qubit's X, Y, Z error probability per gate (Pauli-twirled channels) and its readout error." },
  { id: "readout", title: "Readout mitigation", category: "noise", mode: "live", maxQubits: 12, inputs: [],
    summary: "Measured probabilities with readout error, and recovered by inverting the confusion matrix." },
  { id: "mitigated", title: "Mitigated expectation", category: "noise", mode: "run", maxQubits: 12, inputs: [
      obs,
      { kind: "choice", key: "method", label: "", fallback: 1, options: [
        { label: "ZNE linear", value: 0 }, { label: "ZNE Richardson", value: 1 }, { label: "ZNE exp", value: 2 }, { label: "PEC", value: 3 },
      ] },
      { kind: "choice", key: "samples", label: "PEC samples", fallback: 4000, options: [{ label: "1k", value: 1000 }, { label: "4k", value: 4000 }, { label: "16k", value: 16000 }] },
    ],
    summary: "⟨H⟩ ideal, noisy, and mitigated by zero-noise extrapolation or probabilistic error cancellation." },
);

// Phase 9: characterization & benchmarking (validated: fixture bench). Protocols run on the noise model.
ANALYSES.push(
  { id: "qecplay", title: "QEC playground", category: "qec", mode: "live", maxQubits: 1024, inputs: [
    { kind: "choice", key: "code", label: "code", options: [{ label: "surface", value: 0 }, { label: "repetition", value: 1 }], fallback: 0 },
    { kind: "choice", key: "d", label: "distance d", options: [3, 5, 7, 9, 11].map((d) => ({ label: String(d), value: d })), fallback: 3 },
    { kind: "text", key: "errors", label: "errors", placeholder: "X4 Z7 Y12 (empty: random)" },
    { kind: "int", key: "p", label: "random error rate %", min: 0, max: 40, fallback: 8 },
    { kind: "int", key: "seed", label: "random seed", min: 0, max: 9999, fallback: 1 },
  ], summary: "Put errors on a surface or repetition code (or draw them at random): the lit checks, the union-find decoder's correction, and whether a logical error slips through." },
  { id: "qecthreshold", title: "QEC threshold", category: "qec", mode: "run", maxQubits: 1024, inputs: [
    { kind: "choice", key: "code", label: "code", options: [{ label: "surface", value: 0 }, { label: "repetition", value: 1 }], fallback: 0 },
    { kind: "choice", key: "noise", label: "errors", options: [{ label: "bit flips", value: 0 }, { label: "depolarizing", value: 1 }], fallback: 0 },
    { kind: "int", key: "shots", label: "shots per point", min: 200, max: 20000, fallback: 2000 },
  ], summary: "Logical error rate against the physical error rate for d = 3, 5, 7 (code capacity, union-find decoding): the curves cross at the threshold." },
  { id: "rb", title: "Randomized benchmarking", category: "bench", mode: "run", maxQubits: 1024, inputs: [
      { kind: "choice", key: "interleave", label: "interleave", fallback: 0, options: [{ label: "none", value: 0 }, { label: "X", value: 1 }, { label: "H", value: 2 }, { label: "S", value: 3 }, { label: "√X", value: 4 }] },
      { kind: "choice", key: "sequences", label: "sequences", fallback: 12, options: [{ label: "6", value: 6 }, { label: "12", value: 12 }, { label: "30", value: 30 }] },
    ],
    summary: "Error per Clifford from the survival decay of random Clifford sequences; interleaved RB isolates one gate's error." },
  { id: "unitarity", title: "Unitarity", category: "bench", mode: "run", maxQubits: 1024, inputs: [],
    summary: "How coherent the noise is: the decay of the Bloch length under random Cliffords." },
  { id: "qv", title: "Quantum volume", category: "bench", mode: "run", maxQubits: 1024, inputs: [
      { kind: "choice", key: "width", label: "up to", fallback: 4, options: [{ label: "3", value: 3 }, { label: "4", value: 4 }, { label: "5", value: 5 }] },
      { kind: "choice", key: "circuits", label: "circuits", fallback: 20, options: [{ label: "10", value: 10 }, { label: "20", value: 20 }, { label: "50", value: 50 }] },
    ],
    summary: "Heavy-output probability of random square circuits of SU(4) blocks; QV = 2^width of the largest passing size." },
  { id: "xeb", title: "Cross-entropy benchmarking", category: "bench", mode: "run", maxQubits: 1024, inputs: [
      { kind: "choice", key: "qubits", label: "qubits", fallback: 3, options: [{ label: "2", value: 2 }, { label: "3", value: 3 }, { label: "4", value: 4 }] },
    ],
    summary: "Linear XEB fidelity of random circuits against their depth, and the fidelity per cycle." },
  { id: "mirror", title: "Mirror circuits", category: "bench", mode: "run", maxQubits: 1024, inputs: [],
    summary: "Success probability of random Clifford circuits followed by their inverse, by width and depth." },
  { id: "t1t2", title: "T1 / T2 experiments", category: "bench", mode: "run", maxQubits: 1024, inputs: [],
    summary: "Relaxation, Ramsey and echo decays over idle gates, with fitted T1, T2*, T2." },
  { id: "qec", title: "Repetition code", category: "bench", mode: "run", maxQubits: 1024, inputs: [
      { kind: "choice", key: "shots", label: "shots", fallback: 2000, options: [{ label: "500", value: 500 }, { label: "2k", value: 2000 }, { label: "10k", value: 10000 }] },
    ],
    summary: "Logical error rate of the bit-flip code for d = 3, 5, 7 against the physical flip rate: exact and decoded." },
  { id: "shadows", title: "Classical shadows", category: "estimation", also: ["bench"], mode: "run", maxQubits: 12, inputs: [
      obs,
      { kind: "choice", key: "snapshots", label: "snapshots", fallback: 2000, options: [{ label: "500", value: 500 }, { label: "2k", value: 2000 }, { label: "10k", value: 10000 }] },
    ],
    summary: "Estimate ⟨H⟩ from random-Pauli measurement snapshots of the current state, against the exact value." },
  { id: "tomography", title: "Process tomography", category: "estimation", also: ["bench"], mode: "run", maxQubits: 2, inputs: [
      { kind: "choice", key: "channel", label: "", fallback: 0, options: [{ label: "ideal", value: 0 }, { label: "noisy", value: 1 }] },
    ],
    summary: "The circuit's Pauli transfer matrix reconstructed from prepared inputs and Pauli readouts; process and gate fidelity." },
  { id: "randclifford", title: "Random Clifford circuit", category: "tools", mode: "run", maxQubits: 20, inputs: [
      { kind: "int", key: "depth", label: "depth", min: 1, max: 8, fallback: 3 },
    ],
    summary: "A random Clifford circuit (single-qubit Cliffords and CX layers) to replace the circuit with." },
);

// Phase 11: verification & export.
ANALYSES.push(
  { id: "compare", title: "Compare with memory", category: "verify", mode: "live", maxQubits: 20, inputs: [
      { kind: "int", key: "slot", label: "M", min: 1, max: 9, fallback: 1 },
    ],
    summary: "The circuit against a stored circuit (STO): same operator?, process and average gate fidelity, state fidelity, resources." },
  { id: "plot", title: "Custom plot", category: "plotting", also: ["verify"], mode: "run", maxQubits: 14, inputs: [
      { kind: "choice", key: "quantity", label: "plot", fallback: 0, options: [
        { label: "⟨Z⟩", value: 0 }, { label: "⟨X⟩", value: 1 }, { label: "⟨Y⟩", value: 2 }, { label: "purity", value: 3 }, { label: "S(q)", value: 4 },
        { label: "mid S", value: 5 }, { label: "Q", value: 6 }, { label: "M₂", value: 7 }, { label: "⟨H⟩", value: 8 },
      ] },
      { kind: "choice", key: "sweep", label: "over", fallback: 0, options: [{ label: "steps", value: 0 }, { label: "t", value: 1 }, { label: "symbol", value: 2 }] },
      obs,
    ],
    summary: "Any of these quantities along the circuit (after each step), over one period of t, or over another symbol." },
  { id: "plotprogram", title: "Plot program (JavaScript)", category: "plotting", also: ["verify"], mode: "run", maxQubits: 14, inputs: [
    { kind: "code", key: "code", label: "program" },
  ], summary: "Draw anything from the state with a few lines of JavaScript: the program gets data (amplitudes, probabilities, per-qubit ρ, symbols) and returns shapes. It runs sandboxed: its own worker, no network or storage, a time limit." },
  { id: "selftest", title: "Self-test", category: "verify", mode: "run", maxQubits: 1024, inputs: [],
    summary: "Replay the committed Qiskit/Aer references on this device: gates, random circuits, symbols, classical control, noise, stabilizer mode." },
);

export const ANALYSIS_BY_ID: Record<string, AnalysisMeta> = Object.fromEntries(ANALYSES.map((a) => [a.id, a]));

/**
 * Panels that read only the Z-basis probabilities |ψᵢ|² of the state: with
 * Hardware experiment on, they run on each run's sample (Σ √fᵢ |i⟩ gives them
 * exactly the sample's frequencies), as they would on hardware. The others
 * need phases, ρ or the circuit itself and stay exact.
 */
export const FROM_SHOTS = new Set(["anticoncentration", "zz", "corrlength", "structure", "symmetry", "counting", "multifractal", "participation"]);

/**
 * Panels that read the state beyond its Z-basis probabilities (phases,
 * reduced ρ, non-Z observables): with Hardware experiment on they run on the
 * state reconstructed by the run's state tomography (up to TOMO_MAX qubits;
 * above that, not measurable), as they would on hardware. Everything not in
 * FROM_SHOTS or here doesn't read the state (circuit, structure, noise model,
 * benchmarks): an experiment of its own, computed from the circuit.
 */
export const FROM_TOMOGRAPHY = new Set([
  "statevector", "ampphase", "qsphere", "coherence", "schmidt", "profile",
  "page", "renyi", "wigner", "husimi", "magic", "magicspectrum", "charfunction", "majorana", "totalcorr", "chsh",
  "contour", "schmidtgap", "entham", "entstats", "mps", "negspectrum", "ptmoments", "threetangle", "expectation", "qfi",
  "multiqfi", "squeezing", "hamspectrum", "krylov", "diagens", "efftemp", "shadows", "stateprep", "plotprogram",
].filter((id) => id in ANALYSIS_BY_ID));

/**
 * Panels that only need the reduced density matrices of a few qubits
 * (reducedDensityMatrix): with Hardware experiment on they see measured, mixed ρ_S,
 * at any size (local tomography above TOMO_MAX qubits).
 */
export const FROM_LOCAL = new Set(["phasedisk", "density", "mutualinfo", "negativity", "concurrence", "discord", "tripartite"]);

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

/** Text of a Pauli input (options or the default observable), as the user writes it: Qiskit's order, q0 rightmost. */
export function pauliValue(opts: Opts, key: string, n: number): string {
  const v = opts[key];
  return typeof v === "string" && v.trim() ? v : defaultObservable(n);
}

/** A Pauli input for the simulator: its strings in the simulator's order (character q = qubit q). */
export function pauliInput(opts: Opts, key: string, n: number): string {
  return internalPauliSum(pauliValue(opts, key, n));
}

/** A symbol input: the chosen symbol if the tape still uses it, else the default ("" = none). */
export function symbolValue(spec: Extract<InputSpec, { kind: "symbol" }>, opts: Opts, symbols: string[]): string {
  const v = opts[spec.key];
  if (typeof v === "string" && (v === "" ? spec.optional : symbols.includes(v))) return v;
  if (spec.fallback === "t") return symbols.includes("t") ? "t" : symbols[0] ?? "";
  if (spec.fallback === "second") return spec.optional ? symbols[1] ?? "" : symbols[1] ?? symbols[0] ?? "";
  return symbols[0] ?? "";
}

/** The panels a group lists: those at home there, then those listed there too. */
export function analysesIn(cat: Category): AnalysisMeta[] {
  return [...ANALYSES.filter((a) => a.category === cat), ...ANALYSES.filter((a) => a.also?.includes(cat))];
}

const GROUP_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<Category, string>;
/** The labels of every group a panel appears in, home first. */
export const groupsOf = (a: AnalysisMeta) => [a.category, ...(a.also ?? [])].map((g) => GROUP_LABEL[g]);

const fold = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/**
 * Panels matching a search: every word of the query must appear in the id,
 * title, summary or group names. Title matches first, then summary-only ones.
 */
export function searchAnalyses(query: string): AnalysisMeta[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = ANALYSES.filter((a) => {
    const hay = fold(`${a.id} ${a.title} ${a.summary} ${groupsOf(a).join(" ")}`);
    return words.every((w) => hay.includes(w));
  });
  const inTitle = (a: AnalysisMeta) => words.every((w) => fold(`${a.title} ${a.id}`).includes(w));
  return [...hits.filter(inTitle), ...hits.filter((a) => !inTitle(a))];
}
