// Shared helpers for tests that edit circuits through the Calculator's editing API.
import { Calculator, type GateOpts } from "../src/calc/calculator";
import { InlineEngine } from "../src/calc/engine";

type Saved = ReturnType<Calculator["save"]>;

/** A calculator on an inline engine (optionally with the LAB's runAnalysis, optionally restored). */
export const calc = (saved?: Saved | null, runAnalysis?: ConstructorParameters<typeof InlineEngine>[0]) =>
  new Calculator(new InlineEngine(runAnalysis), saved);

/** Add a gate: `add(c, "x", [1], { controls: [0] })`. Returns addGate's result. */
export const add = (c: Calculator, gate: string, targets: number[], opts: Omit<GateOpts, "targets"> = {}) =>
  c.addGate(gate, { ...opts, targets });

/** A CX (or any controlled 1-qubit gate): `cx(c, 0, 1)`. */
export const cx = (c: Calculator, control: number, target: number, gate = "x") => add(c, gate, [target], { controls: [control] });

/** The core's statevector (InlineEngine only). */
export const stateOf = (c: Calculator) => (c.engine as InlineEngine).core.reg.state;
