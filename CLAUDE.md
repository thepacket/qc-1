# QC-1 — Quantum Calculator One

A pocket-calculator PWA for quantum states, for phones in portrait orientation. It has
an LCD display on top and a 5×8 key grid below. Vite + React + TypeScript.

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
- CI (`.github/workflows/ci.yml`): `test` on every push; `validate` regenerates fixtures and fails on drift
