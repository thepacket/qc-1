# QC-1 — Quantum Calculator One

A pocket-calculator PWA for quantum states, for phones. In portrait it has an LCD
display on top and a 5×8 key grid below; on a phone turned sideways (landscape,
height ≤ 540px) the display takes the screen and KEYS slides the keypad in as a
right-hand panel, the display reflowing beside it. Vite + React + TypeScript.

## Rules
- **No ties to Quantiom's brand.** Code is ported from ~/Projects/quantiom (MIT, same
  author), but the Quantiom name and logo must not appear, and neither the UI nor the
  manifest should link to it.
- **Immediate key model.** A gate key applies to the register right away. Modifiers
  (2ND, CTRL marks, ALL) are one-shot. The numeric entry is the argument to the next
  key that takes one (rotations, Q, N, U's `θ,φ,λ`, and the SHOTS tab).
- Up to 20 qubits (statevector). Big-endian: q0 is the leftmost bit of a ket.
- **Display:** a dark color graphing screen inside a calculator bezel, no longer a
  green LCD. It is expandable (⤢ button, drag handle, or the `e` key): the keypad
  slides away and a mini key strip remains. Chart colors are the validated dark steps of
  the data-viz reference palette (`--series-1..3` in styles.css, on the `#1a1a19`
  surface); run the dataviz validator before adding series colors.

- **No compute on the server.** fly.io (the live server and its builder) only serves and builds static files. All simulation and analysis runs in the browser. Python is dev-only (local and GitHub CI), never in the Docker context.
- **Validate before porting.** Every ported Quantiom feature is checked against Qiskit or numpy first. See `validation/README.md`: seeded cases → `npm run validate` → committed `test/fixtures/*.json` → `test/validated/*.test.ts`. A mismatch is fixed, never recorded as a reference. Upstream bugs go in `docs/quantiom-bugs.md`; fixes in ported files go in `// QC-1 fix` blocks. The port's phase plan is in memory (qc1-port-plan).

## Layout
- `src/sim/` is **ported from Quantiom**: `client/src/sim` plus `editor/{types,gates}.ts`.
  `src/qasm/emit.ts` is Quantiom's QASM 3 emitter, with one QC-1 block marked for
  base gates that carry controls. Keep ported files diffable against upstream and put
  QC-1 logic elsewhere.
- `src/calc/` is the calculator engine.
  - `steps.ts`: a Step is a Quantiom PlacedGate plus the recorded measurement outcome.
    Also holds `applyStep` and the fast single-target kernel.
  - `register.ts`: statevector, tape, and undo/redo via snapshots plus replay.
  - `core.ts` + `worker.ts`: **the Register lives in a Web Worker.** Core answers
    commands and computes small view summaries (see `analysis.ts`); the worker
    coalesces views after a burst of commands.
  - `engine.ts`: WorkerEngine, or InlineEngine for tests and as a fallback.
  - `calculator.ts`: the key-press state machine on the UI thread. It mirrors n, tape
    and redo depth from replies, which arrive in send order through a FIFO of reporters.
  - `entry.ts`: the entry line (π, √, implicit ×).
  - `catalog.ts`: the CATALOG list (2ND+ALL) of gates without their own key, built
    from the ported `sim/gates.ts` metadata. Multi-qubit gates take their other qubits
    from the most recent CTRL marks. State preps are "reset, then prepare". RCCX and
    RC3X are gate-sequence macros (`MACROS` in steps.ts), because Quantiom's matrices
    for them are plain Toffolis.
- `src/analysis/` is the LAB (6th tab) framework:
  - `catalog.ts`: metadata the UI imports (title, category, inputs, caps, live/run).
  - `run.ts`: id → compute function. Only the analysis worker loads it (and InlineEngine in tests).
  - `worker.ts`: the **second worker**. The core worker hands it a register snapshot over a MessageChannel, so analyses never block keys.
  - The Calculator keeps the latest request and drops superseded replies. Work that's still running after 150 ms is abandoned by restarting the worker. A live analysis slower than 400 ms stops auto-refreshing ("stale · RUN").
  - `Result.rev` marks when the register changed.
  - Charts are in `src/ui/charts/` (heatmap seq/div/complex, bars, lines, table, disks, Q-sphere; colours in `colors.ts`); the screens are in `src/ui/lab/LabView.tsx`.
  - AC in LAB goes back a level and never clears the register.
- `src/sim/` also holds validated Quantiom analysis modules:
  - Phase 1: density, entanglement, eig, pauliMatrix, pauliSpectrum, expectation, concurrence, negativity, pageCurve, renyiSpectrum, qsphere. `qsphere.ts` inlines its Amplitude type.
  - Phase 2: every state-only analysis (fixture `state2`).
  - Their fixes are `// QC-1 fix` blocks: pageCurve, anticoncentration, chsh, quantumDiscord (bugs #6–#9).
  - LAB inputs are cut / qubit / int / choice (`inputValue` in catalog.ts). Chart kinds add scatter+fit, hist+curve, and Majorana stars.
- **Symbols and memory (Phase 3).**
  - Angles can use symbols: 2ND+`.` gives `t`; 2ND+`,` gives θ, and repeating it cycles φ λ α β γ δ τ ω; 2ND+7/8/9 give sin( cos( exp(.
  - `Register.scope` holds symbol values by ASCII name (θ → theta). `setScope` replays from the first symbolic entry, starting from a cached prefix state. Replays force each measurement's recorded outcome and re-sample it if it has become impossible (`notes`).
  - The core coalesces `{t:"scope"}` bursts and applies them before the next read. After a deferred replay it sends a `sync` message that consumes no reporter.
  - The PARAM screen (tap the symbol badge) has sliders, = to set a value from the entry, and t playback, which is pull-based and keeps running after PARAM closes.
  - History is a list of `Op`s: an entry, or a whole-tape `replace` (AC, RCL, and later the tools and imports), so undo covers both.
  - STO/RCL are 2ND+`=` and 2ND+`⌫`, with the slot digit 1–9 typed first. `Saved` gains `scope` and `memory`.
  - QASM export declares every symbol as `input float`. `t` is exported as `t_` because `t` is the T gate in stdgates.inc. Qiskit's importer can't evaluate functions *of* symbols (sin(θ)).
- **Expectation & metrology (Phase 4).**
  - `src/sim/simulate.ts` is a **QC-1 adapter, not a port**. It has upstream's `simulate()` signature but runs QC-1's validated `applyStep` over `lowerTape(n, tape)` (`src/calc/lower.ts`). Measurements are post-selected on their recorded outcomes.
  - `src/calc/ids.ts` replaces the upstream React-coupled `newGateId`.
  - `optimize.ts` is the ideal-state subset: its noisy paths and ZNE come with noise mode (Phase 8), and WebGPU is deferred.
  - Analyses may be async (the optimiser); the worker awaits, and InlineEngine replies at once when the analysis is synchronous.
  - LAB inputs add a `pauli` text field (phone keyboard, `pauliPresets.ts`) and a `symbol` picker. Results can offer `apply` (set symbol values). A `paths` chart shows Bloch trajectories.
  - Fixtures: `metrology` and `metrology-symbolic`. Bugs #10–#12 are the Pauli-sum exponents, the QFI-matrix eigenvalues, and the optimiser stopping at a stationary start.
- **Operator & spectrum (Phase 5a).**
  - Coverage: unitary, PTM, operator entanglement, Floquet, the Hamiltonian-spectrum family (DOS, level statistics, SFF, Krylov, diagonal ensemble, effective temperature, ETH, eigenstate entanglement, work distribution), Berry phase, Chern number, ZX.
  - `namedCircuit` (`src/calc/lower.ts`) maps base+controls to named ids (cx…) for structural modules; `fromTape` shares its `NAMED` table.
  - Unitary-based analyses refuse tapes with measurements, resets or preps.
  - Per-eigenstate analyses (ETH, effective temperature, eigenstate entanglement) refuse degenerate H.
  - Fixtures: `spectrum-circuits`, `-hamiltonians` (degenerate H included), `-geometry`. Tests also cover the QWZ Chern phase diagram and ZX structure.
  - Bugs #13–#15: `hermitianEig` duplicated eigenvectors in degenerate levels; the work distribution needs level projectors; Floquet statistics must be circular.
- **Dynamics (Phase 5b).**
  - Coverage: the t-sweeps (⟨Z⟩(t) and its spectrum, Loschmidt echo, imbalance, entanglement velocity, negativity dynamics), the OTOC family (OTOC, light cone, butterfly velocity, Lyapunov, operator weight), autocorrelation, space-time ⟨Z⟩ and entropy, entanglement asymmetry, and the gate light cone (in "structure").
  - A t-sweep runs over one period t ∈ [0, 2π] and refuses a tape without `t`.
  - Fixture `dynamics`. Bug #16: the autocorrelation DFT must run over the P−1 periodic samples.
  - TAPE step-scrubber: `ViewReq.upTo` makes the core view `Register.stateAt(k)` (a read-only replay with recorded outcomes). `Calculator.scrub` drives it, and ViewData carries `at`. The header shows `@k/N`, and any tape edit ends the scrub. LAB analyses still use the live state.
  - Heatmaps keep the grid's aspect (clamped to 1:2…4:1). `codes` marks categorical cells: a key replaces the numbers and the colour bar.
- **Circuit tools & structure (Phase 6).**
  - `src/calc/toolCircuit.ts` bridges the tape and upstream's named-gate vocabulary:
    - `toolCircuit` expands macros, custom gates and anti-controls into plain named gates (cx, ccx, mcp…) and refuses non-unitary tapes;
    - `raiseCircuit` maps a tool's output back to tape entries.
  - `src/calc/equiv.ts` is the in-app check. It compares every unitary column for n ≤ 8, or 3 random states above that, always against one global phase. It takes an optional routing permutation.
  - LAB "Circuit tools" (`src/analysis/tools.ts`): simplify, transpile, route, compile, inverse, Trotter, state prep, unitary synthesis.
    - Each result carries a `proposal`, which offers APPLY (an undoable `replace`) only when `verified`.
    - When the tape has symbols, the check runs at two symbol settings.
  - Structure analyses: resources, interaction graph, Tanner graph, stabilizer tableau.
    - `src/calc/resources.ts` counts what the QASM export emits, with Qiskit's definitions: size, depth, T-depth as the filtered depth, Clifford gates by their matrix.
  - Custom gates (`src/calc/custom.ts`):
    - DEFINE in CATALOG makes G# from the last k entries (entry k), or from the whole tape.
    - Definitions use local qubits 0..k−1; symbols stay symbols.
    - A per-worker registry is set by the core command `gates`, analysis snapshots, and the UI thread; `applyStep` expands them.
    - Export: `gate G1(p0,…) a0, a1 { … }`, then `ctrl @ G1(theta) …`.
  - `u_arb` exports as an exact ZYZ gate definition with `gphase`.
  - Fixtures: `tools` (45 cases × 10 tool outputs), `structure`, `synth` (prep, unitary, Trotter orders 1/2/4), plus custom-gate cases in `gates` and `symbolic`.
  - Bugs:
    - #17: router SWAPs.
    - #18: integer division in exported angles; the export now makes numerators floats.
    - #19: Suzuki order-4 coefficient.
  - Validation plumbing: drift ignores tape step ids and compares QASM with long floats rounded to 12 significant digits (libm last-bit differences between macOS and Linux).
- **Classical control, import, examples, share (Phase 7).**
  - Classical bits and IF:
    - Measuring q writes c[q] (`Register.cbits`; `classicalBits` rebuilds them for any prefix).
    - IF (2ND+Z, entry `k` or `k,v`) sets `Step.condition` on the next gate.
    - `applyStep(…, cbits)` skips a step whose condition is false.
  - Export writes `bit[n] c`, `c[q] = measure q[q]` and `if (c[k] == true/false)`: Qiskit's importer rejects `bit == int`. Every measurement, reset and prep records its outcome in a `// note: QC-1 measured k` comment.
  - `src/calc/branches.ts`: every measurement history, with conditions evaluated per branch; it backs the LAB "Measurement branches" analysis (a `tree` chart).
  - `src/qasm/import.ts` is QC-1's own importer, not upstream's parser:
    - It handles OpenQASM 2/3 registers, `gate` definitions, ctrl/negctrl/inv/pow modifiers, `if`/`else`, `input float`, and implicit symbols.
    - A definition becomes a custom gate, or a native gate when numerically equal.
    - `gphase` becomes e^{iα}·I as `u_arb`; outcome notes are read back.
    - Symbols keep any name (`t_` → `t`).
    - Integer ratios are read as real divisions.
  - Security: `sim/expr.ts` `isSafeExpr` gates `new Function` (bug #20). `share.ts` builds `#q=` base64url QASM plus `&v=` symbol values; App opens such links as an undoable replace.
  - `examples/` holds the 93 upstream programs without the brand, plus QC-1's own: 8 animations (`anim_*`) and 19 more (intro, decompositions, error correction with IF, HHL, counting, noise, and three above 20 qubits in stabilizer mode). Their physics claims are checked in `test/examples-anim.test.ts` and `test/examples-claims.test.ts`; the examples fixture checks programs above 20 qubits as stabilizer generators against Qiskit's StabilizerState; `index.json` gives the 10 categories. `src/examples.ts` loads them lazily through `import.meta.glob`.
  - TAPE ≡ menu: Examples, Import QASM (paste or file), Copy QASM, Share QASM file, Share link.
  - Fixtures:
    - `classical`: independent interpreter, branch enumerator, and Aer counts at 5σ.
    - `examples`: Qiskit reads each original, with normalisations documented in `g_examples.py`.
    - Export → import round trips cover every fixture group (`test/import.test.ts`).
- **Noise (Phase 8).**
  - `src/noise/model.ts` uses Qiskit Aer's conventions: depolarizing λ as in `depolarizing_error`, amplitude/phase damping, readout flips, crosstalk on coupling neighbours. It supports per-qubit and per-gate overrides and upstream's presets (converted).
    - Noise follows the exported program: every unitary QASM instruction gets depolarizing by size, then AD and PD on each qubit, then crosstalk (`channels.ts`).
  - `src/noise/sim.ts`:
    - The exact density matrix covers unitary tapes up to n ≤ 10.
    - Trajectories sample every channel and each measurement afresh, apply readout flips, and evaluate IF on the noisy bits.
  - `src/noise/mitigation.ts`:
    - ZNE: linear, Richardson, or exponential through the scales 1/2/3.
    - PEC: noisy trajectories plus reverse-order quasi-probabilistic inverses; amplitude damping uses reset channels.
    - `pecDensity` must return the ideal ρ.
  - `src/noise/ibm.ts` imports device calibration: damping equals Aer's `thermal_relaxation_error`, and depolarizing makes up the rest of `gate_error`.
  - UI:
    - LAB "Noise & error" → Noise model: on/off, presets, rates, device file.
    - A NOISE flag appears in the header.
    - PROB/BLOCH/SHOTS come from the analysis worker (request id `__view`, `Calculator.noisyView`); KET, TAPE and the other analyses stay ideal.
    - `AnalysisRequest.noise` carries the model to the worker.
  - Analyses: noise impact, decoherence by depth, mixed-state spectrum, coherent information, noisy coherence, Pauli budget, readout mitigation, mitigated expectation (ZNE/PEC).
  - Fixtures:
    - `noise`: exact ρ against Kraus maps built from Aer errors; trajectories within 5σ; measured programs against AerSimulator.
    - `noise-analyses`: Qiskit quantum_info and numpy; the calibration import against Aer's thermal relaxation.
  - Bugs #21 (PEC), #22 (ZNE exponential), #23 (IBM import).
- **Benchmarking (Phase 9).**
  - `src/noise/bench.ts` implements these protocols on the noise model, with circuits built as tapes so they export:
    - RB: 24 Cliffords from H and S, a free-B fit A·pᵐ+B, and interleaved RB;
    - unitarity;
    - QV: Haar SU(4) as native gates via KAK, heavy output with a 2σ pass;
    - XEB (linear), mirror circuits, T1/T2/echo on idle gates;
    - the repetition code (exact and decoded);
    - classical shadows (median of means);
    - process tomography (ideal preparations, n ≤ 2).
  - `src/analysis/benchRuns.ts` is the LAB "Characterization & benchmarking" category, plus a random Clifford tool.
  - Fixture `bench`: circuits re-run from their exports through Aer errors; scipy `curve_fit`; closed forms for T1/T2; binomial tail.
  - Bug #24: upper-case U1/U2/U3 in the export.
- **Stabilizer mode (Phase 10).**
  - Above 20 qubits (up to 1024) the register is `src/stab/register.ts`, a StabilizerRegister (Aaronson–Gottesman tableau) with the same contract as `Register`: tape, ops, recorded outcomes, cbits, IF.
    - Clifford tapes only; symbols are refused.
  - `src/stab/clifford.ts` enumerates the 1q (24) and 2q (11 520) Clifford groups over H/S/CX (≈0.15 s, lazily). Any step on ≤ 2 qubits whose matrix is Clifford maps to a shortest H/S/CX sequence.
  - `Core` picks the register kind with `registerFor(contents)`. Undo, redo, replace and resize that cross 20 qubits rebuild the other kind from the target contents and carry the history.
  - Stabilizer views: KET shows generators, PROB shows P(qᵢ=1), BLOCH shows exact vectors (first 32), SHOTS shows bitstrings sampled under a work budget. The qubit bar shows a window above 64.
  - LAB analyses with maxQubits 1024 (structural, noise model, benchmarks) run in stabilizer mode; the stabilizer tableau analysis uses the StabilizerRegister.
  - Fixture `stabilizer`:
    - Qiskit StabilizerState of each export up to n = 200, with the Clifford built per instruction because `Clifford(circuit)` maps ecr/dcx/iswap by name;
    - post-selected statevectors for measured tapes.
- **Qiskit export, verification, help (Phase 11).**
  - `src/qasm/toQiskit.ts`: `qiskitPython(n, tape)` translates QC-1's own QASM 3 export into a Python script, statement by statement.
    - Each `gate` definition becomes `_gate_NAME`, a sub-circuit named `qc1_NAME`. The prefix stops `.control()` dispatching on standard names.
    - Modifiers become `.control(k, ctrl_state)` / `.inverse()`; conditions become `if_test`; symbols become Parameters (renamed with `pyName` when they clash with Python keywords).
    - Upstream emitQiskit is not ported.
  - Fixture `qiskit`: `validation/ref/g_qiskit.py` executes each generated script and compares its statevector with QC-1's exactly.
  - `src/analysis/verifyRuns.ts`:
    - compare: current tape vs memory slot `opts.other`, attached by `Calculator.requestAnalysis`;
    - plot: a declarative custom sweep;
    - selftest: dynamically imports fixtures and replays them on the device.
  - Fixture `verify` covers the compare results.
  - `src/ui/HelpView.tsx` opens from the "?" button (`Calculator.toggleHelp`). `npm run docs:help` regenerates `docs/help/analyses.md` from the catalog.
  - Workers build as ES modules (`worker.format: "es"` in vite.config.ts); the IIFE build failed with code-split workers.
- **After the port: diagram, editing, QR, step-through.**
  - TAPE → CIRC (`src/ui/CircuitView.tsx`) draws the tape with the ASAP layout of `src/calc/diagram.ts`. A step spans its lowest to highest wire; an IF step waits for the measurement that wrote its bit. Above 32 qubits only the wires the tape touches are drawn. Tapping a gate scrubs to it.
  - Mid-tape editing: while scrubbed, push/repeat become the core command `insert` (at the scrub point; the scrub follows), and `Calculator.deleteStep` sends `delete`. Both are undoable `replace` ops. `StabilizerRegister.load` builds aside first, so a refused non-Clifford edit leaves the register untouched.
  - Share links are `#z=`: the export deflate-raw compressed with CompressionStream, inflation capped at 1 MB. `#q=` links (plain) still open. Every example fits a QR code (largest version 19).
  - `src/qasm/qr.ts` wraps qrcode-generator (level M, else L). `test/qr.test.ts` decodes the codes with jsQR (dev dependency). TAPE ≡ → QR code shows it full screen, dark on white.
  - Step-through: `importQasm` returns `lines` (the source line of each entry); `src/qasm/captions.ts` turns comments into one caption per entry. `Calculator.guide` holds them and applies while the tape's step ids match (`activeGuide`), so an edit hides it and UNDO restores it. App's GuideBar replaces the tape strip.
  - `prettyExpr` shows imported ASCII symbol names as glyphs (theta → θ).
- **Algorithm blocks** (`src/calc/blocks.ts`, CATALOG → BLOCKS): QFT, QFT†, Grover diffuser (exactly 2|s⟩⟨s| − I), QAOA MaxCut ring layer. A block acts on the CTRL-marked qubits plus the selected one, ascending (the first is the most significant), else on every qubit. QFT/QFT†/DIFF are custom gates QFTk/IQFTk/DIFFk defined on first use (one tape step, exported as a `gate`); QAOA is two plain entries taking γ,β from the entry. Fixture `blocks`: exact operators vs Qiskit QFTGate/QAOAAnsatz and the diffuser matrix.
- **Typed states and matrices** (`src/calc/typed.ts`, CATALOG → TYPE IT → STATE…/MATRIX…, a textarea in the CATALOG view): kets with complex coefficients or amplitude lists (≤ 8 qubits) become PSIj ("reset, then PSIj"); unitaries up to 16×16 (unitary to 1e−3, then Gram–Schmidt-exact) become Mj. Built from the validated state prep / two-level synthesis plus an e^{iα}·I u_arb step so the gate is exact including global phase (matters when controlled). Placed on CTRL-marked + selected qubits, else q0…. Fixture `typed`: vs independently written numpy targets and Qiskit's import of the export.
- **Session report** (`src/ui/ReportView.tsx`, TAPE ≡ → Report): a light, printable page in a portal under `<body>` (print CSS hides the rest). It holds the session header, the circuit (`CircuitDiagram`, the pure half of CircuitView), the live KET view (`Calculator.toggleReport` requests one; `reportKet`), the LAB results pinned with PIN (`Calculator.pins`, this session only, at most 12), the tape and the QASM. Charts and the circuit stay dark "display" figures: their colours are validated on the dark surface only.
- **Error correction** (`src/noise/qec.ts`, LAB category "qec", `src/analysis/qecRuns.ts`): rotated surface code and repetition code at any odd d, union-find decoder (exhaustively tested to correct every error of weight ≤ (d−1)/2), code-capacity Monte Carlo (repetition code checked against the binomial tail), and the two-round syndrome-extraction circuit as a tape (the playground's APPLY; verified by simulating it on the stabilizer tableau). The `lattice` chart draws codes; the `text` input kind is a free phone-keyboard field; int inputs with ranges over 16 render as a − value + stepper.
- **Parallel trajectories** (`src/noise/parallel.ts`, `trajWorker.ts`): `noisyStats` always runs trajectories as TRAJ_CHUNKS = 8 seeded chunks merged in order, so `noisyStatsParallel` (the noisy PROB/BLOCH/SHOTS views) can farm them out to up to hardwareConcurrency − 1 nested workers and give bit-identical results; it runs in place for small jobs, the density path, or without workers (Node tests, browsers without nested workers). The NOISE flag says "· k cores" when it ran in parallel. Measured 3.7× on 8 cores with 4 workers (n = 14, 128 trajectories).
- **SVG export** (`src/ui/svgExport.ts`): every chart frame and the circuit diagram has an SVG button. `elementToSvg` walks the rendered DOM: nested `<svg>` are copied with computed styles inlined (no classes), HTML text becomes `<text>` split per rendered line, HTML boxes with a background/border become `<rect>`; the file is cropped to what was drawn, and the circuit's scrolled SVG is taken at full width. Saved through the share sheet (phones) or a download. DOM-dependent, so checked in the browser, not in Vitest.
- **Video** (`src/ui/recorder.ts`, PARAM → ● REC): one period of t in 120 frames. Each frame sets t, awaits `Calculator.nextView()` and a paint, rasterizes the display (`.lcd`) through the SVG exporter onto a canvas, and hands it to MediaRecorder (`captureStream(0)` + `requestFrame`) on a fixed 24 fps clock. WebM (VP9/VP8), or MP4 where only that records (Safari). The REC pill sits outside the display; t is restored; saved via `saveFile` (share sheet or download).
- **Plot programs** (`src/analysis/plotProgram.ts`, `plotSandbox.ts`; LAB → Verification & export → Plot program): user JavaScript gets `data` (amplitudes, probabilities, per-qubit ρ, symbols) and returns a declarative scene. It runs in its own bundled worker (not blob:, which the CSP forbids) with network/storage/nested-worker globals removed and a 2.5 s timeout; the scene is sanitised (whitelisted element types, clamped numbers, literal/theme colours, path tokens only) and drawn as the `scene` chart. Code lives in LAB options only, never in share links. The LAB smoke test skips it (Node has no Worker); the sanitiser has its own tests.
- `src/qasm/fromTape.ts` turns the tape into OpenQASM 3. It uses stdgates names where
  they exist and `ctrl @`/`negctrl @` otherwise, adds exact `gate` definitions for
  non-stdgates (sy, sxdg, iswap, rxx, ryy, rzz), and folds `sqrt(...)` params to numbers.
  Verified against Qiskit statevectors for every gate (exact, including global phase).
  Custom-gate parameters are named p0, p1, … because Qiskit's importer binds them
  alphabetically. DCX and ECR follow Quantiom's matrices, whose qubit roles are
  reversed relative to Qiskit's gates of the same name.
- `src/ui/` has the App shell, keypad layout (`keys.ts`), display views and formatting.
- The session (tape + settings) is persisted in localStorage `qc1:session:v1` and
  replayed on launch; measurements replay with their recorded outcomes.

## Commands
- `npm run dev` / `npm test` / `npm run build` / `npm run icons` (needs rsvg-convert)
- `npm run validate`: regenerate Qiskit/numpy reference fixtures (needs `validation/.venv`; see validation/README.md)
- CI: `ci.yml` (`test`: typecheck, Vitest with the committed fixtures, build) on every push. `validate.yml` regenerates the fixtures and fails on drift, but only when fixture-relevant paths change (src/{sim,calc,qasm,noise,stab,analysis}, examples, validation, fixtures, lockfile), weekly, or by hand; its Python venv is cached. Add a path there if new computing code lives elsewhere.
