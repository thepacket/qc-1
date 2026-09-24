/**
 * Quantiom's gate-block snippets (Edit → Insert block), as QC-1 steps: each
 * builds a small block with 0-based columns (`pin`) for an n-qubit circuit,
 * pasted after the circuit's last column. A controlled gate is its base gate
 * plus controls (CX = x with one control, CP = p with one).
 */
import type { Entry, Step } from "./steps";

export type Snippet = {
  id: string;
  label: string;
  hint: string;
  /** Qubits the circuit needs for the block. */
  minQubits: number;
  build: (n: number) => Entry[];
};

let seq = 0;
const g = (gateId: string, column: number, controls: number[], targets: number[], params: string[] = []): Entry =>
  [{ id: `sn${seq++}`, gateId, column, pin: column, controls, targets, clbits: [], params } satisfies Step];

export const SNIPPETS: Snippet[] = [
  {
    id: "bell", label: "Bell pair", hint: "H · CX on q0, q1", minQubits: 2,
    build: () => [g("h", 0, [], [0]), g("x", 1, [0], [1])],
  },
  {
    id: "ghz", label: "GHZ state", hint: "H, then a CX ladder across every qubit", minQubits: 2,
    build: (n) => {
      const out = [g("h", 0, [], [0])];
      for (let i = 1; i < n; i++) out.push(g("x", i, [i - 1], [i]));
      return out;
    },
  },
  {
    id: "qft", label: "QFT (all qubits)", hint: "H, controlled phases, bit-reversal swaps", minQubits: 2,
    build: (n) => {
      const out: Entry[] = [];
      let col = 0;
      for (let i = 0; i < n; i++) {
        out.push(g("h", col++, [], [i]));
        for (let j = i + 1; j < n; j++) out.push(g("p", col++, [j], [i], [`pi/${2 ** (j - i)}`]));
      }
      for (let i = 0; i < Math.floor(n / 2); i++) out.push(g("swap", col++, [], [i, n - 1 - i]));
      return out;
    },
  },
  {
    id: "iqft", label: "Inverse QFT", hint: "the QFT backwards, phases negated", minQubits: 2,
    build: (n) => {
      const out: Entry[] = [];
      let col = 0;
      for (let i = 0; i < Math.floor(n / 2); i++) out.push(g("swap", col++, [], [i, n - 1 - i]));
      for (let i = n - 1; i >= 0; i--) {
        for (let j = n - 1; j > i; j--) out.push(g("p", col++, [j], [i], [`-pi/${2 ** (j - i)}`]));
        out.push(g("h", col++, [], [i]));
      }
      return out;
    },
  },
  {
    id: "trotter-ising", label: "Trotter Ising layer", hint: "RZZ(2·J) on neighbours, RX(2·h): one TFIM step", minQubits: 2,
    build: (n) => {
      const out: Entry[] = [];
      let col = 0;
      for (let i = 0; i < n - 1; i++) out.push(g("rzz", col++, [], [i, i + 1], ["2*J"]));
      for (let i = 0; i < n; i++) out.push(g("rx", col, [], [i], ["2*h"]));
      return out;
    },
  },
];
