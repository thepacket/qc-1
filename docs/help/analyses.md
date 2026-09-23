# LAB analyses

Generated from `src/analysis/catalog.ts` (`npm run docs:help`). Each analysis is
checked against Qiskit, Qiskit Aer, numpy or scipy references (`validation/`).

## State

- **Statevector** (live, n ≤ 20) — Amplitudes as numbers: real, imaginary, magnitude, phase, probability.
- **Amplitude · phase** (live, n ≤ 20) — One bar per basis state: length |amplitude|, colour = phase. Shows interference at a glance.
- **Phase disks** (live, n ≤ 20) — Each qubit's coherence ρ₁₀ in the complex plane: angle = relative phase, length ≤ ½.
- **Q-sphere** (live, n ≤ 8) — Basis states on a sphere by Hamming weight; size = |amplitude|, colour = phase.
- **Bloch trajectory** (RUN, n ≤ 12; inputs: qubit) — Each qubit's Bloch vector as t sweeps [0, 2π]: the path it traces on its sphere.

## Measurement

- **Anticoncentration** (live, n ≤ 16, n ≥ 2) — Histogram of D·p against the Porter–Thomas law e^(−y); R = D·Σp² is 1 flat, 2 Porter–Thomas, ≫2 peaked.
- **Measurement branches** (live, n ≤ 12) — Every measurement history with its probability: the tree a program's mid-circuit measurements and IF gates produce.

## Phase space & magic

- **Discrete Wigner** (live, n ≤ 4) — Wootters phase-space quasi-probability; negative cells signal non-classicality.
- **Husimi Q** (live, n ≤ 7) — Overlap with spin-coherent states |θ,φ⟩⊗ⁿ over the sphere; never negative.
- **Magic (M₂)** (live, n ≤ 6) — Stabilizer 2-Rényi entropy: 0 exactly for stabilizer states; T gates raise it.
- **Magic spectrum** (live, n ≤ 6) — Stabilizer Rényi entropies M_α across α: the shape of the non-stabilizerness.
- **Characteristic function** (live, n ≤ 4) — |χ(u,v)| = |⟨P⟩| on the (X-support, Z-support) lattice; the Fourier dual of Wigner.
- **Majorana stars** (live, n ≤ 6) — The symmetric part of the state as n stars on the sphere.

## Expectation & metrology

- **Expectation value** (live, n ≤ 20; inputs: observable, shots) — ⟨H⟩ for a Pauli string or Pauli sum, with its variance and the shot-noise error σ/√N.
- **Optimise ⟨H⟩ (VQE)** (RUN, n ≤ 12; inputs: observable, goal, method, steps) — Gradient descent on ⟨H⟩ over the circuit's symbols (finite differences); apply the result to the sliders.
- **Landscape** (RUN, n ≤ 12; inputs: observable, x, y) — ⟨H⟩ as one or two symbols sweep [−π, π]: a curve or a heatmap.
- **Barren-plateau check** (RUN, n ≤ 12; inputs: observable, samples) — Variance of ∂⟨H⟩/∂θ over random parameter points; exponentially small means a barren plateau.
- **Quantum Fisher information** (live, n ≤ 20; inputs: axis) — F_Q = 4 Var(J) for collective rotations: > N witnesses entanglement, N² is the Heisenberg limit.
- **QFI matrix** (live, n ≤ 14) — 3×3 QFI matrix over Jx, Jy, Jz; its top eigenvalue is the best single-axis QFI.
- **Spin squeezing** (live, n ≤ 14, n ≥ 2) — Wineland ξ² = N·min ΔJ⊥² / |⟨J⟩|²; below 1 is squeezed (and entangled).
- **Quantum geometric tensor** (live, n ≤ 12) — Fubini–Study metric and Berry curvature over the circuit's symbols (finite differences).

## Entanglement & correlations

- **Reduced density matrix** (live, n ≤ 20; inputs: keep) — ρ of the kept qubits (others traced out), with purity Tr ρ² and entropy.
- **Mutual information** (live, n ≤ 12, n ≥ 2) — I(i:j) = S(i) + S(j) − S(ij) for every pair, in bits: total (classical + quantum) correlation.
- **Negativity** (live, n ≤ 12, n ≥ 2) — Pairwise log-negativity E_N: > 0 exactly when a pair is entangled (PPT test).
- **Concurrence** (live, n ≤ 10, n ≥ 2) — Pairwise Wootters concurrence: 0 separable … 1 Bell pair.
- **Schmidt spectrum** (live, n ≤ 20, n ≥ 2; inputs: A) — Squared Schmidt coefficients across the cut A | rest, with entanglement entropy and rank.
- **Entropy profile** (live, n ≤ 20, n ≥ 2) — Entanglement entropy across every contiguous cut: area law vs volume law.
- **Page curve** (live, n ≤ 20, n ≥ 2) — Entropy profile against the Haar-random (Page) average: how scrambled is the state?
- **Rényi spectrum** (live, n ≤ 20, n ≥ 2; inputs: A) — Rényi entropies S_α across the cut, from the log rank (α→0) to the min-entropy (α→∞).
- **Tripartite information** (live, n ≤ 14, n ≥ 4; inputs: A, B, C) — I₃ = I(A:B) + I(A:C) − I(A:BC); negative means information about A is scrambled into BC.
- **Total correlation** (live, n ≤ 14, n ≥ 2) — Multi-information Σ S(qᵢ) − S(all): every qubit's entanglement with the rest, added up.
- **CHSH nonlocality** (live, n ≤ 12, n ≥ 2) — Maximal CHSH value per pair (Horodecki); above 2 the pair violates a Bell inequality.
- **Quantum discord** (live, n ≤ 8, n ≥ 2) — D(A|B): correlation beyond what a measurement on B can reveal; can be non-zero without entanglement.
- **ZZ correlations** (live, n ≤ 16, n ≥ 2) — Connected ⟨ZᵢZⱼ⟩ − ⟨Zᵢ⟩⟨Zⱼ⟩: aligned (+) or anti-aligned (−) spins.
- **Correlation length** (live, n ≤ 16, n ≥ 3) — ξ from an exponential fit to the average |ZZ| correlation versus distance.
- **Structure factor** (live, n ≤ 16, n ≥ 2) — S(k): Fourier transform of the ZZ correlations; k = 0 ferromagnetic, k = π Néel order.
- **Symmetry sectors** (live, n ≤ 20) — Weight in each excitation-number sector and the Z₂ parity ⟨ΠZ⟩.
- **Counting statistics** (live, n ≤ 20; inputs: A) — Distribution of the number of 1s in region A; its variance is the charge fluctuation.
- **Entanglement contour** (live, n ≤ 20, n ≥ 2; inputs: region size) — Where a region's entropy comes from: S([0..j]) − S([0..j−1]) per site.
- **Schmidt gap** (live, n ≤ 20, n ≥ 2) — λ₁ − λ₂ across every cut; it closes at a critical point.
- **Entanglement Hamiltonian** (live, n ≤ 20, n ≥ 2; inputs: A) — Entanglement energies ξᵢ = −ln λᵢ (Li–Haldane spectrum) across the cut.
- **Entanglement-spectrum statistics** (live, n ≤ 20, n ≥ 3; inputs: A) — Gap ratios of the entanglement spectrum: ⟨r⟩ ≈ 0.386 Poisson (localized), 0.536 GOE (ergodic).
- **MPS bond dimension** (live, n ≤ 20, n ≥ 2; inputs: error) — Bond dimension χ a matrix-product state needs at each cut for the chosen truncation error.
- **Negativity spectrum** (live, n ≤ 6, n ≥ 2; inputs: A) — Eigenvalues of the partial transpose across the cut; the negative ones are the entanglement.
- **PT moments** (live, n ≤ 6, n ≥ 2; inputs: A) — Moments Tr[(ρ^T_A)ⁿ]; p₃ < p₂² certifies entanglement from low moments alone.
- **Three-tangle** (live, n ≤ 3, n ≥ 3; inputs: focal) — Genuine tripartite entanglement τ₃ (CKW): 1 for GHZ, 0 for W.
- **Multifractal dimensions** (live, n ≤ 16) — Generalized fractal dimensions D_q of the basis distribution: 1 delocalized, 0 localized.
- **Coherence** (live, n ≤ 20) — l₁-norm and relative-entropy coherence in the computational basis.
- **Participation** (live, n ≤ 16) — Inverse participation ratio, participation ratio and entropies of the basis distribution; plus its growth along the circuit.

## Dynamics

- **⟨Z⟩ over t** (live, n ≤ 14) — Every qubit's ⟨Z⟩ as t sweeps one period [0, 2π]: Rabi, Larmor, Trotterised dynamics as curves.
- **⟨Z⟩ spectrum** (live, n ≤ 14; inputs: qubit) — Fourier spectrum of ⟨Z⟩(t) over one period: a peak at bin m is m oscillations per period.
- **Loschmidt echo** (live, n ≤ 14) — Return probability |⟨ψ(0)|ψ(t)⟩|² and its rate function; cusps mark dynamical phase transitions.
- **Imbalance** (live, n ≤ 14) — Staggered magnetisation (1/n)Σ(−1)ⁱ⟨Zᵢ⟩ over t: it decays when thermalising, stays in localised phases.
- **Entanglement velocity** (live, n ≤ 12, n ≥ 2) — Half-cut entropy S(t) and its steepest slope, the entanglement velocity.
- **Negativity over t** (live, n ≤ 12, n ≥ 2; inputs: A) — Log-negativity across the cut as t sweeps: growth, oscillation, sudden death and revival.
- **OTOC** (RUN, n ≤ 6, n ≥ 2; inputs: W on, V on) — C(t) = 1 − Re⟨W(t)VW(t)V⟩ on |0…0⟩ with Z operators: it rises when the operator front reaches V.
- **OTOC light cone** (RUN, n ≤ 5, n ≥ 2; inputs: W on) — OTOC over every qubit and t: the operator light cone.
- **Butterfly velocity** (RUN, n ≤ 5, n ≥ 2; inputs: W on) — Arrival time of the OTOC front at each distance, and the fitted speed v_B.
- **Lyapunov exponent** (RUN, n ≤ 6, n ≥ 2; inputs: W on, V on) — Early-time exponential growth rate of the OTOC, λ_L.
- **Operator weight** (RUN, n ≤ 4; inputs: Z on) — How Z on one qubit spreads under W(t) = U†WU: weight by Pauli support size, over t.
- **Autocorrelation** (RUN, n ≤ 6; inputs: qubit) — Infinite-temperature ⟨Z(t)Z(0)⟩ and its spectrum: how long a qubit remembers its polarisation.
- **Space-time ⟨Z⟩** (live, n ≤ 14) — ⟨Z⟩ of every qubit after every circuit step.
- **Space-time entropy** (live, n ≤ 12) — Each qubit's entanglement entropy after every circuit step: the entanglement front.
- **Entanglement asymmetry** (live, n ≤ 12, n ≥ 2) — How much the first half breaks the excitation-number symmetry, after every step (quantum Mpemba).

## Operator & spectrum

- **Unitary matrix** (live, n ≤ 6) — The circuit's whole operator U in the computational basis: colour = phase, opacity = |Uᵢⱼ|.
- **Pauli transfer matrix** (live, n ≤ 3) — Rᵢⱼ = Tr(Pᵢ U Pⱼ U†)/2ⁿ: what the circuit does to each Pauli; a Clifford is a signed permutation.
- **Operator entanglement** (live, n ≤ 6, n ≥ 2) — Operator-Schmidt spectrum of U across the middle cut: 0 for a product, 1 ebit for a CNOT.
- **Floquet spectrum** (RUN, n ≤ 6) — Eigenphases of U on the unit circle, with circular level-spacing statistics.
- **Hamiltonian spectrum** (live, n ≤ 6; inputs: H) — Exact energy levels of a Pauli-sum H, the ground energy and gap, with ⟨H⟩ of the current state.
- **Density of states** (live, n ≤ 6; inputs: H) — Histogram of H's energy levels.
- **Level statistics** (live, n ≤ 6, n ≥ 2; inputs: H) — Gap ratio ⟨r⟩ of H's spectrum: 0.386 Poisson (integrable), 0.531 GOE (chaotic).
- **Spectral form factor** (live, n ≤ 6; inputs: H) — |Σ e^(−iEt)|²/D² on log-log axes: dip, ramp, plateau.
- **Krylov complexity** (live, n ≤ 6; inputs: H) — Lanczos coefficients bₙ of H from the current state, and the spread complexity C(t).
- **Diagonal ensemble** (live, n ≤ 6; inputs: H) — The state's weight on each energy level of H, ⟨H⟩, ΔE and the effective dimension.
- **Effective temperature** (live, n ≤ 6; inputs: H) — Boltzmann fit ln p = c − βE to the energy populations (non-degenerate H).
- **ETH matrix elements** (RUN, n ≤ 5; inputs: H, O) — |⟨Eₘ|O|Eₙ⟩|² against ω = Eₘ − Eₙ, and the diagonal ⟨Eₙ|O|Eₙ⟩ (non-degenerate H).
- **Eigenstate entanglement** (RUN, n ≤ 6, n ≥ 2; inputs: H) — Half-chain entropy of every eigenstate of H against its energy: volume-law arch vs area law.
- **Work distribution** (RUN, n ≤ 5; inputs: H) — Two-point-measurement work W = Eₘ − Eₙ for the circuit as a quench from |0…0⟩ (energy-level projectors).
- **Berry phase** (RUN, n ≤ 12; inputs: x, y, loop) — Geometric phase around a square loop in two symbols, centred on their current values (discrete Wilson loop).
- **Chern number** (RUN, n ≤ 12; inputs: x, y, grid) — Berry flux over the torus of two symbols in [0, 2π): an integer for a topological band.

## Circuit structure

- **ZX diagram** (live, any n (also above 20 qubits)) — The circuit as a ZX-calculus diagram: green Z and red X spiders, Hadamard boxes.
- **Light cone** (live, any n (also above 20 qubits); inputs: qubit, cone) — The circuit steps that can influence a qubit's final state (backward) or that its input can reach (forward).
- **Resources** (live, any n (also above 20 qubits); inputs: check map) — Gate counts, depth, T count and T-depth, CX and Clifford counts, as Qiskit counts the exported circuit.
- **Interaction graph** (live, any n (also above 20 qubits), n ≥ 2) — How many gates act on each pair of qubits: the connectivity a device needs.
- **Tanner graph** (live, any n (also above 20 qubits)) — Measurements (checks) against the qubits in each one's backward light cone.
- **Stabilizer tableau** (live, any n (also above 20 qubits)) — For Clifford circuits: the n Pauli operators that fix the state (Bell → +XX, +ZZ).

## Circuit tools

- **Simplify** (RUN, n ≤ 20; inputs: passes) — Cancel and merge neighbouring gates (H·H, S·S†, RZ·RZ, CX·CX, H·CX·H → CZ…); checks the result is the same operator before offering it.
- **Transpile** (RUN, n ≤ 20; inputs: to) — Rewrite into a device gate set: Clifford+T, IBM (RZ, SX, CX) or Rigetti (RZ, RX±π/2, CZ); arbitrary 2-qubit gates go through a KAK decomposition.
- **Route** (RUN, n ≤ 20, n ≥ 2; inputs: map) — Insert SWAPs so every 2-qubit gate acts on neighbours of a coupling map (greedy, shortest paths). Qubits end up relabelled.
- **Compile** (RUN, n ≤ 20; inputs: to, map) — Transpile, optimise, route, optimise: one pass to a device, with the gate count after each stage.
- **Inverse U†** (RUN, n ≤ 20; inputs: mode) — Reverse the circuit and invert every gate. Appending gives a mirror circuit that returns to |0…0⟩.
- **Trotter circuit** (RUN, n ≤ 20; inputs: H, steps, order, mode) — Build e^{−iH·steps·t} as a product formula in the symbol t, and show its error against the exact evolution at the current t.
- **State preparation** (RUN, n ≤ 20; inputs: target) — A circuit that prepares a target state (or the current one) from |0…0⟩ with RY, RZ and CX.
- **Unitary synthesis** (RUN, n ≤ 4) — Re-synthesise the circuit's unitary from two-level controlled 2×2 gates (exact, not gate-optimal).
- **Random Clifford circuit** (RUN, n ≤ 20; inputs: depth) — A random Clifford circuit (single-qubit Cliffords and CX layers) to replace the circuit with.

## Noise & error

- **Noise model** (live, any n (also above 20 qubits)) — Turn noise on and set its rates: depolarizing, T1/T2 damping, readout, crosstalk; device presets and calibration files.
- **Noise impact** (live, n ≤ 10) — Fidelity and trace distance of the noisy state to the ideal one, its purity and entropy.
- **Decoherence by depth** (RUN, n ≤ 6) — Fidelity to the ideal state and purity after every step: how noise accumulates along the circuit.
- **Mixed-state spectrum** (live, n ≤ 8) — Eigenvalues of the noisy ρ, its purity, effective rank and entropy.
- **Coherent information** (live, n ≤ 8, n ≥ 2; inputs: A) — I(A⟩B) = S(B) − S(AB) of the noisy state: positive means quantum correlations survive.
- **Noisy coherence** (live, n ≤ 8) — Computational-basis coherence (l1 and relative entropy) of the noisy state against the ideal one.
- **Pauli error budget** (live, any n (also above 20 qubits)) — Each qubit's X, Y, Z error probability per gate (Pauli-twirled channels) and its readout error.
- **Readout mitigation** (live, n ≤ 12) — Measured probabilities with readout error, and recovered by inverting the confusion matrix.
- **Mitigated expectation** (RUN, n ≤ 12; inputs: observable, method, PEC samples) — ⟨H⟩ ideal, noisy, and mitigated by zero-noise extrapolation or probabilistic error cancellation.

## Characterization & benchmarking

- **Randomized benchmarking** (RUN, any n (also above 20 qubits); inputs: interleave, sequences) — Error per Clifford from the survival decay of random Clifford sequences; interleaved RB isolates one gate's error.
- **Unitarity** (RUN, any n (also above 20 qubits)) — How coherent the noise is: the decay of the Bloch length under random Cliffords.
- **Quantum volume** (RUN, any n (also above 20 qubits); inputs: up to, circuits) — Heavy-output probability of random square circuits of SU(4) blocks; QV = 2^width of the largest passing size.
- **Cross-entropy benchmarking** (RUN, any n (also above 20 qubits); inputs: qubits) — Linear XEB fidelity of random circuits against their depth, and the fidelity per cycle.
- **Mirror circuits** (RUN, any n (also above 20 qubits)) — Success probability of random Clifford circuits followed by their inverse, by width and depth.
- **T1 / T2 experiments** (RUN, any n (also above 20 qubits)) — Relaxation, Ramsey and echo decays over idle gates, with fitted T1, T2*, T2.
- **Repetition code** (RUN, any n (also above 20 qubits); inputs: shots) — Logical error rate of the bit-flip code for d = 3, 5, 7 against the physical flip rate: exact and decoded.
- **Classical shadows** (RUN, n ≤ 12; inputs: observable, snapshots) — Estimate ⟨H⟩ from random-Pauli measurement snapshots of the current state, against the exact value.
- **Process tomography** (RUN, n ≤ 2; inputs: channel) — The circuit's Pauli transfer matrix reconstructed from prepared inputs and Pauli readouts; process and gate fidelity.

## Error correction

- **QEC playground** (live, any n (also above 20 qubits); inputs: code, distance d, errors, random error rate %, random seed) — Put errors on a surface or repetition code (or draw them at random): the lit checks, the union-find decoder's correction, and whether a logical error slips through.
- **QEC threshold** (RUN, any n (also above 20 qubits); inputs: code, errors, shots per point) — Logical error rate against the physical error rate for d = 3, 5, 7 (code capacity, union-find decoding): the curves cross at the threshold.

## Verification & export

- **Compare with memory** (live, n ≤ 20; inputs: M) — The circuit against a stored circuit (STO): same operator?, process and average gate fidelity, state fidelity, resources.
- **Custom plot** (RUN, n ≤ 14; inputs: plot, over, observable) — Any of these quantities along the circuit (after each step), over one period of t, or over another symbol.
- **Plot program (JavaScript)** (RUN, n ≤ 14; inputs: program) — Draw anything from the state with a few lines of JavaScript: the program gets data (amplitudes, probabilities, per-qubit ρ, symbols) and returns shapes. It runs sandboxed: its own worker, no network or storage, a time limit.
- **Self-test** (RUN, any n (also above 20 qubits)) — Replay the committed Qiskit/Aer references on this device: gates, random circuits, symbols, classical control, noise, stabilizer mode.
