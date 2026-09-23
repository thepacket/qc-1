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
