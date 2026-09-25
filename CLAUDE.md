# QC-1 — Quantum Calculator One

A pocket-calculator PWA for quantum states, for phones. In portrait it has an LCD
display on top and a 5×8 key grid below; on a phone turned sideways (landscape,
height ≤ 540px) the display takes the screen and KEYS slides the keypad in as a
right-hand panel, the display reflowing beside it. Vite + React + TypeScript.

## Rules
- **No ties to Quantiom's brand.** Code is ported from ~/Projects/quantiom (MIT, same
  author), but the Quantiom name and logo must not appear, and neither the UI nor the
  manifest should link to it.
- **No keypad.** Circuits are built from the gate palette by drag and drop on the diagram;
  all text and numbers are typed with the OS keyboard (angle fields, qubit count, shots,
  PARAM values). There are no edit buttons: gate actions live in the long-press menu.
- Up to 20 qubits (statevector). **Qiskit's bit order, everywhere:** qubit q is bit q of a basis index, so q0 is the rightmost character of kets, bitstrings (shots, classical bits c[k−1]…c[0]) and Pauli strings ("IIZ" = Z on q0). See "Qiskit bit order" below.
- **Display:** a dark color graphing screen inside a calculator bezel, no longer a
  green LCD. It is expandable (⤢ button, drag handle, or the `e` key): the keypad
  slides away and a mini key strip remains. Chart colors are the validated dark steps of
  the data-viz reference palette (`--series-1..3` in styles.css, on the `#1a1a19`
  surface); run the dataviz validator before adding series colors.

- **No compute on the server.** fly.io (the live server and its builder) only serves and builds static files. All simulation and analysis runs in the browser. Python is dev-only (local and GitHub CI), never in the Docker context.
- **Validate before porting.** Every ported Quantiom feature is checked against Qiskit or numpy first. See `validation/README.md`: seeded cases → `npm run validate` → committed `test/fixtures/*.json` → `test/validated/*.test.ts`. A mismatch is fixed, never recorded as a reference. Upstream bugs go in `docs/quantiom-bugs.md`; fixes in ported files go in `// QC-1 fix` blocks. The port's phase plan is in memory (qc1-port-plan).

- **Circuit editing on the diagram** (Quantiom's editor, ported onto the tape; no edit buttons, everything on the diagram with fingers or a mouse):
  - The diagram is a grid. `Step.pin` is the column the editor put a step in, a lower bound in `layoutTape` (`src/calc/diagram.ts`; unpinned steps go ASAP; a measurement also waits for the steps reading its bit). Drawing only: exports, imports and the simulation ignore it.
  - `src/calc/grid.ts` (pure, `test/grid.test.ts`): `placeEntry` drops an entry at a column, relocating to the first free column right of it (Quantiom's `relocateIfCollision`); `insertPinned` puts it in the tape after everything left of it on its wires and before everything right of it (a topological reorder when no index works); `repositionEntry`/`moveEntry` re-pin every step first, so nothing slides; `removeEntries`, `copyEntries`/`pasteClip` (after the last column), `compact` (drop the pins), `entriesIn` (rectangle).
  - `Calculator`: `placeItem(item, row, col?)`, `tapCell` (a tapped empty cell takes tapped tiles, left to right), `moveGate`, `nudgeSelected` (arrows), `reassignQubit`, `addControl`/`addControlAnywhere`/`removeControl`/`toggleControlState`, `setGateParams`, `setGateCondition`, `setBroadcast`, `duplicateGate` (next free column), `invertGate`, `removeGate`, `selectBox`/`selectAll`/`copySelection`/`cutSelection`/`paste`/`repeatSelection`/`deleteSelection`, `compactColumns`. Grid edits end the scrub; a single placement that needs no reorder goes in as a push or insert, everything else as one `replace` (one UNDO).
  - UI: `src/ui/dnd.ts` (pointer-event drag, 6 px threshold, long-press 450 ms, trash over the dock), `CircuitView.tsx` (cells, drop preview at the relocated column, tap = select, drag a gate = move with its grab offset, control dots always draggable, a selected multi-qubit gate's targets too; a dot dragged along its own wire moves the whole gate; "● +" handle; long-press or right-click on empty space opens paste / select all / compact, and a long-press then drag, or a mouse drag, selects a rectangle), `DiagramMenu.tsx` (the long-press / right-click menu: on a gate, angle fields with the OS keyboard, duplicate, invert, add / remove / anti control, only-if c[k], every qubit, delete; on empty space or a selection, Quantiom's Edit and Transform menus as two tabs).
  - Edit: undo/redo, copy circuit (QASM 3) / paste circuit (`pasteCircuit`, an undoable `loadQasm`), copy / cut / paste / repeat ×N / fold selection (`folds`: column ranges drawn as one box, UI only), Insert block (opens the palette's Blocks: `openBlocks` in Palette.tsx; Quantiom's snippets are gone, each has a block), clear. Transform: `Calculator.transform(id, opts, label)` runs a LAB circuit tool (simplify, inverse, randclifford, transpile, compile, route) in the analysis worker (seq above 1e9) and replaces the circuit only when the tool's proposal is verified; the message says what the tool left as is. Quantiom opens results in a new tab; QC-1 has no tabs, so they are an undoable replace. `test/editmenu.test.ts`.
- **Classical register** (Quantiom's, ported): the classical bits are their own register, not one per qubit. `Step.clbits[0]` is the bit a measurement writes (`measuredBit`; empty = c[q], QC-1's first convention, so older tapes and fixtures keep their meaning); `bitCount(n, tape, declared)` sizes every classical array (Register/StabilizerRegister grow with `fitBits`, noise trajectories, branches, equiv, resources). `Calculator.nc` (Saved `nc`, default n) is the declared count, `bits` = max(nc, what the tape names); `setClassicalCount` quietly keeps the count below a bit in use (`usedBits`; the − button is disabled there, no error), `setMeasureBit`; a placed measurement writes its qubit's bit if the register has it, else the last. Layout: IF waits for the last writer of its bit, a measurement for the readers and the previous writer (`bitColumn`/`noteBits`); a measurement or IF step keeps its column free down to the lanes (`Placed.bottom`, `reachesBus`); grid ordering treats bit k as row −1−k. The diagram draws one lane per bit under the wires (`LANE` px apart, labelled c0…); a measurement's link (a single line, like the lanes) ends on its bit's lane, an IF step's dotted line starts on its bit's; editing, that dot drags to another lane (dnd payload `bit`, drop rows ≥ n are lanes) → `setMeasureBit` / `setGateCondition`. Export `bit[bits] c`, `c[j] = measure q[i]`; import maps bit registers flattened in order (`ImportResult.nc`). Fixture `classical` adds 12 `bits*` cases (measurements into any bit, IF on bits beyond the qubits); qiskit-aer 0.17.2 can't load one of them (its bug), recorded as `aer` in the fixture, still checked by the interpreter and branch enumerator. `test/cbits.test.ts`.
- **Qiskit bit order** (since 2026-09-25; before, QC-1 was big-endian with q0 leftmost):
  - Every qubit→bit mapping is `1 << q` (kernels in `sim/apply.ts`, `calc/steps.ts`, measure, expectation, pauliMatrix, density, analysis, branches, equiv, noise, the ported analyses). Ported files carry a `// QC-1: Qiskit bit order` marker at each changed site. Local k-qubit gate matrices stay first-qubit-high (`applyKQubit` maps local qubits itself), which is invisible: named gates equal Qiskit's argument by argument.
  - `reducedDensityMatrix`: kept[j] is bit j of ρ (Qiskit's partial_trace); `quantumDiscord` passes [b, a] to keep A high. `operatorEntanglement`, MPS/eigenstate cuts: A = qubits 0…a−1 = the low bits. PTM and tomography use Qiskit's Pauli basis order (base-4 digit q = qubit q). `stab/clifford.ts` labels its table's Kronecker factors to match the simulator.
  - `src/calc/order.ts`: `qiskitLabel`/`internalLabel` (Pauli strings: the simulator indexes character q = qubit q; users read and write q0 rightmost), `internalPauliSum` (used by `pauliInput` in catalog.ts for every LAB Pauli input, and by validation cases), `qiskitGenerators` (stabilizer tableau output), `prepCircuit`/`synthUnitary` (upstream's state prep and unitary synthesis read q0 as the high bit: their circuits with qubits mirrored).
  - Typed matrices use Qiskit's Operator convention, typed kets and amplitude lists Qiskit's index order; QFT blocks are Qiskit's QFTGate; the Z₀ preset is "…IIZ". Stabilizer SHOTS, branch cbits strings and Qiskit-script comments print q0 / c0 rightmost.
  - Validation compares with Qiskit directly: no `reverse_qargs`, no reversed labels (`validation/README.md`). Examples that store register values use q[0] as the least significant bit (QPE, counting, walks, adders, HHL, Shor); comments state kets as Qiskit writes them. Bug #60: the Fourier-addition example's phases. `test/bit-order.test.ts`.
- **Display limits:** KET and PROB list up to 4,096 basis states (KET_ROWS) and account for the rest (`restP`, an "all other outcomes" row); SHOTS up to 1,024 outcomes plus an "other" row. Long lists render only the rows in view (`RowList` in views.tsx), so length costs almost nothing per key. `topK` is a linear quickselect. Stabilizer views show every generator; marginals and Bloch vectors (O(n²) each) are sized to a work budget (all qubits up to n ≈ 512) and say so. Phones are powerful: prefer lifting a cap with a budget or virtualization to hiding data.
- **Untrusted input** (security review, bugs #55–#59, `test/security.test.ts`): QASM files, share links, AI proposals, chat text and typed states are untrusted. Angle expressions are parsed by `sim/expr.ts` into closures (never `new Function`); the site CSP has no `'unsafe-eval'`. The importer charges every expanded step, custom gates at their expanded size, to `MAX_IMPORT_STEPS` (100 000) before allocating. Markdown's block loop always advances; typed parsers check sizes before allocating. Dev and preview servers bind to localhost (`dev:lan`/`preview:lan` to expose them). Toolchain: Vite 8, Vitest 5 (Node ≥ 22.12; Docker build on node:24).
- **Words in the UI:** users see a quantum *circuit*, never a "tape". The first tab is CIRCUIT (panes MENU, CIRCUIT (the diagram), STEP, QASM), and messages say "circuit" or "steps". The code keeps its internal names (`tape`, Mode id `"tape"`, `fromTape.ts`…).

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
  - Groups (21, `CATEGORIES`): each analysis has a home `category` and may be listed in others (`also`), e.g. OTOCs under Chaos & scrambling and Dynamics, the QGT under Geometry & topology and Expectation & metrology; `analysesIn(group)` lists home panels first. `LabState.group` is a group id or "fav" / "recent" / "search"; the Calculator's `labGroups()` puts ★ Favourites and Recent (last 8 opened) first, both persisted in the session; `labSearch(q)` lists `searchAnalyses(q)` (every word in id, title, summary or group names; title matches first). Back returns to the group a panel was opened from. The AI's `list_analyses` reports each panel's groups.
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
  - Stabilizer views: KET shows generators, PROB shows P(qᵢ=1), BLOCH shows exact vectors (first 32), SHOTS shows bitstrings sampled under a work budget.
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
  - `prettyExpr` shows symbol names as glyphs with subscripts (theta → θ, gamma_0 → γ₀; `symbolGlyph` in entry.ts, the whole Greek alphabet); `plainExpr` reads the displayed text back (÷ × − √, implicit products). Angle entry (`src/ui/ExprField.tsx`, gate menu and QAOA fields): while focused, keys for π √ t, the circuit's symbols and Greek letters insert at the cursor; typed text is kept as typed, with symbol names made canonical (`canonicalName`/`symbolNames`: gamma0, Gamma_0, γ0, γ₀ → gamma_0).
- **Block library** (`src/calc/blockLib.ts`, palette group Blocks with family chips; `validation/ref/g_blocks.py`): every block is named after a Qiskit circuit-library object and checked against it exactly, global phase included, plain, on spread-out qubits, inverted and controlled (fixture `blocks`, 127 cases): Bell Pair / GHZ State (QC-1 definitions, checked against their states), Uniform Superposition (a port of UniformSuperpositionGate's construction), Graph State, QFT / QFT† (QFTGate; synth_qft_full for approximation / no swaps), Marked-State Oracle (DiagonalGate), Diffuser, Grover Operator (grover_operator = oracle then 2|s⟩⟨s|−I), Real Amplitudes / Efficient SU(2) (n_local's entangler maps incl. SCA, `entanglerPairs`), QAOA Ansatz (graph edges, p layers, symbols gamma_l / beta_l), Pauli Evolution (the validated Trotter builder plus the identity terms' phase as P(α)·X·P(α)·X, which stays exact with symbols), Phase Estimation (a user gate G#/Mj; Qiskit's layout ends with a reversing permutation), Pauli Measurement (steps: reset ancilla, basis changes, CX parity, measure; ⟨P⟩ vs Statevector.expectation_value). A `BlockSpec` has Title Case `name`, `qiskit` (the exact identifier), `settings` (`SettingDef` kinds int/choice/bool/expr/symbol/pauli/bits/edges/gate, defaults per k), optional `size` (settings fix k), `build`. Names users see are Title Case; exported gates are NAMEk in capitals, `Calculator.adoptGate` reuses an identical definition and names a different one NAME_2…; `CustomGate.about` (the settings, shown in the long-press menu) and `inverseOf`. `Calculator.addBlock(id, qubits, settings, col?)`, `blockSize`, `expandGate` (grid.ts `expandAt`: the block's steps from its column on, UNDO restores), `invertGate` on a custom gate (`src/calc/inverse.ts` `inverseGates`: QFTk ↔ IQFTk, else NAME_DG with nested inverses; inverting NAME_DG gives NAME). Custom-gate parameters are zero-padded from 11 on (p00…p11): Qiskit binds a definition's parameters alphabetically.
- **Typed states and matrices** (`src/calc/typed.ts`, CATALOG → TYPE IT → STATE…/MATRIX…, a textarea in the CATALOG view): kets with complex coefficients or amplitude lists (≤ 8 qubits) become PSIj ("reset, then PSIj"); unitaries up to 16×16 (unitary to 1e−3, then Gram–Schmidt-exact) become Mj. Built from the validated state prep / two-level synthesis plus an e^{iα}·I u_arb step so the gate is exact including global phase (matters when controlled). Placed on CTRL-marked + selected qubits, else q0…. Fixture `typed`: vs independently written numpy targets and Qiskit's import of the export.
- **Session report** (`src/ui/ReportView.tsx`, TAPE ≡ → Report): a light, printable page in a portal under `<body>` (print CSS hides the rest). It holds the session header, the circuit (`CircuitDiagram`, the pure half of CircuitView), the live KET view (`Calculator.toggleReport` requests one; `reportKet`), the LAB results pinned with PIN (`Calculator.pins`, this session only, at most 12), the tape and the QASM. Charts and the circuit stay dark "display" figures: their colours are validated on the dark surface only.
- **Error correction** (`src/noise/qec.ts`, LAB category "qec", `src/analysis/qecRuns.ts`): rotated surface code and repetition code at any odd d, union-find decoder (exhaustively tested to correct every error of weight ≤ (d−1)/2), code-capacity Monte Carlo (repetition code checked against the binomial tail), and the two-round syndrome-extraction circuit as a tape (the playground's APPLY; verified by simulating it on the stabilizer tableau). The `lattice` chart draws codes; the `text` input kind is a free phone-keyboard field; int inputs with ranges over 16 render as a − value + stepper.
- **Parallel trajectories** (`src/noise/parallel.ts`, `trajWorker.ts`): `noisyStats` always runs trajectories as TRAJ_CHUNKS = 8 seeded chunks merged in order, so `noisyStatsParallel` (the noisy PROB/BLOCH/SHOTS views) can farm them out to up to hardwareConcurrency − 1 nested workers and give bit-identical results; it runs in place for small jobs, the density path, or without workers (Node tests, browsers without nested workers). The NOISE flag says "· k cores" when it ran in parallel. Measured 3.7× on 8 cores with 4 workers (n = 14, 128 trajectories).
- **SVG export** (`src/ui/svgExport.ts`): every chart frame and the circuit diagram has an SVG button. `elementToSvg` walks the rendered DOM: nested `<svg>` are copied with computed styles inlined (no classes), HTML text becomes `<text>` split per rendered line, HTML boxes with a background/border become `<rect>`; the file is cropped to what was drawn, and the circuit's scrolled SVG is taken at full width. Saved through the share sheet (phones) or a download. DOM-dependent, so checked in the browser, not in Vitest.
- **Video** (`src/ui/recorder.ts`, PARAM → ● REC): one period of t in 120 frames. Each frame sets t, awaits `Calculator.nextView()` and a paint, rasterizes the display (`.lcd`) through the SVG exporter onto a canvas, and hands it to MediaRecorder (`captureStream(0)` + `requestFrame`) on a fixed 24 fps clock. WebM (VP9/VP8), or MP4 where only that records (Safari). The REC pill sits outside the display; t is restored; saved via `saveFile` (share sheet or download).
- **Plot programs** (`src/analysis/plotProgram.ts`, `plotHost.ts`; LAB → Verification & export → Plot program): user JavaScript gets `data` (amplitudes, probabilities, per-qubit ρ, symbols) and returns a declarative scene. Isolation is the browser's (bug #55): the bundled host worker starts an opaque-origin `data:` worker for the code, which inherits the host's own CSP (`deploy/plot-host-headers.conf`: no network, no script loads; nginx serves it for `assets/plotHost-*.js`, `vite.config.ts` for dev/preview). The runner verifies opaque origin, refused storage and a refused request before running, else refuses (fail closed); globals are also removed, with a 2.5 s timeout. The AI can't run plot code; the scene is sanitised (whitelisted element types, clamped numbers, literal/theme colours, path tokens only) and drawn as the `scene` chart. Code lives in LAB options only, never in share links. The LAB smoke test skips it (Node has no Worker); the sanitiser has its own tests.
- **AI chat** (`src/ai/{openrouter,agent}.ts`, `src/ui/ChatView.tsx`, the "AI" button): OpenRouter, called from the browser with the user's own key (localStorage `qc1:openrouter:key`, never in messages, share links, reports or exports; CSP `connect-src` allows only https://openrouter.ai besides 'self'). The agent reads, never writes: tools get_state (QASM, symbols, top amplitudes for n ≤ 14), list_analyses, run_analysis (runs LAB analyses on the UI thread, n ≤ 14), propose_tape (checked by the importer). Proposals, including circuit tools' verified rewrites, show with APPLY, which is `loadQasm`, an undoable replace. The conversation lives in module state for the session. `test/agent.test.ts` drives the loop with a fake fetch and checks that the prompt and tools never say "tape". Replies render through `src/ui/Markdown.tsx` (ported from Quantiom: headings, lists, tables, code, http(s) links, no HTML) with LaTeX by KaTeX (`src/ui/Tex.tsx`, lazy-loaded chunk, Dirac macros \\ket \\bra \\braket \\ketbra \\expval \\tr, `trust` off).
- **Science review fixes** (bugs #25–#33, `test/science.test.ts`, `test/normalEig.test.ts`): Floquet uses `src/calc/normalEig.ts` (complex Schur: Hessenberg + shifted QR; orthonormal vectors, residual and orthogonality gated in the LAB; gaps < 1e-12 reported as degeneracies) and cyclic gap ratios; energy matching works in centred, width-scaled energies; correlation length has a `status` (no fit is NaN, ∞ only for a flat fit); Hamiltonians are diagonalised as H = c·I + s·M (`normalizeHermitian` in sim/eig.ts; Krylov drops the identity part and rescales), Jacobi solvers stop relative to ‖A‖, and every level/degeneracy tolerance is 1e-9 of the spectrum's width (no absolute floors); the Boltzmann fit and ΔE are centred (bugs #34–#38). `test/science.test.ts` sweeps H′ = a·H + b·I through every Hamiltonian consumer: new energy code must pass it; the QGT differentiates adaptively (Richardson, first step bounded by the circuit's angle rate, cross-checked on a non-dyadic step sequence, with an error estimate and an "unresolved" flag) and diagonalises g scaled (bugs #39–#41); the optimiser, its QNG metric and the barren-plateau diagnostic use the same checked derivative (`checkedGradient`, "unresolved" stops rather than certifies); "resolved" means accurate, not just consistent: actual argument spacing, an absolute uncertainty including angle rounding (#54). Panel checks (`test/panels.test.ts`, bugs #42–#52): flat benchmark curves are not identifiable (read as "no decay" only when the model has no channel on those gates, #53), interleaved RB runs the gate itself, tomography uses the scope, shadows' error bar is per-snapshot, noise comparisons with measurements use the unconditional ensemble on both sides, uncomputed cuts show as "—", light cones follow classical bits; DFT Nyquist bins take 1/N; effective temperature reports "no fit" below two populated levels and adds the energy-matched Gibbs β; the Chern flux has the Berry-phase/QGT orientation (F = −arg of the plaquette) plus periodicity and mesh guards; the OTOC family (otoc, cone, butterfly, growth rate, operator weight, autocorrelation) requires a unitary circuit. Honest names: "Prefix conditional entropy" (id `contour`), "Entanglement growth rate" (id `entvelocity`), "OTOC growth rate" (id `lyapunov`, contiguous rising window with R²). Three Python references shared the TS formula and were fixed with it: a matching reference is not proof when both sides port the same formula, so invariant tests (global phase, residuals, Nyquist, orientation) back these.
- `src/qasm/fromTape.ts` turns the tape into OpenQASM 3. It uses stdgates names where
  they exist and `ctrl @`/`negctrl @` otherwise, adds exact `gate` definitions for
  non-stdgates (sy, sxdg, iswap, rxx, ryy, rzz), and folds `sqrt(...)` params to numbers.
  Verified against Qiskit statevectors for every gate (exact, including global phase).
  Custom-gate parameters are named p0, p1, … because Qiskit's importer binds them
  alphabetically. DCX and ECR are Qiskit's gates (QC-1 fix in `sim/matrices.ts`:
  upstream's matrices had the two qubits' roles reversed); `g_stabilizer` checks that
  Qiskit's `Clifford(circuit)`, which reads ecr/dcx/iswap by name, equals the
  instruction-by-instruction Clifford of QC-1's export.
- `src/ui/` has the App shell, keypad layout (`keys.ts`), display views and formatting.
- The session (tape + settings) is persisted in localStorage `qc1:session:v1` and
  replayed on launch; measurements replay with their recorded outcomes.

## Commands
- `npm run dev` / `npm test` / `npm run build` / `npm run icons` (needs rsvg-convert)
- `npm run validate`: regenerate Qiskit/numpy reference fixtures (needs `validation/.venv`; see validation/README.md)
- CI: `ci.yml` (`test`: typecheck, Vitest with the committed fixtures, build) on every push. `validate.yml` regenerates the fixtures and fails on drift, but only when fixture-relevant paths change (src/{sim,calc,qasm,noise,stab,analysis}, examples, validation, fixtures, lockfile), weekly, or by hand; its Python venv is cached. Add a path there if new computing code lives elsewhere.
