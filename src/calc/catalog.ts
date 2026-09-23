import { GATES_BY_ID } from "../sim/gates";

/**
 * CATALOG (2ND + ALL): the gates without a key of their own. Names, argument
 * names and defaults come from the ported gate catalog (sim/gates.ts);
 * `arity` is how many qubits the gate acts on — the target is the selected
 * qubit and the other arity−1 come from the most recent CTRL marks. Blocks
 * (arity 0) take all the marked qubits and the selected one, or every qubit.
 */
export type CatalogItem = {
  gate: string;
  label: string;
  group: string;
  arity: number;
  params: string[];
  argNames: string[];
  note: string;
};

type Spec = [gate: string, group: string, arity: CatalogItem["arity"], note?: string];

const SPECS: Spec[] = [
  ["i", "1 QUBIT", 1],
  ["sydg", "1 QUBIT", 1],
  ["r", "1 QUBIT", 1],
  ["gpi", "1 QUBIT", 1],
  ["gpi2", "1 QUBIT", 1],
  ["dcx", "2 QUBIT", 2],
  ["ecr", "2 QUBIT", 2],
  ["sqrtswap", "2 QUBIT", 2],
  ["sqrtswapdg", "2 QUBIT", 2],
  ["rzx", "2 QUBIT", 2, "exp(−iθ/2 Z⊗X); Z on the marked qubit"],
  ["fsim", "2 QUBIT", 2],
  ["xx_plus_yy", "2 QUBIT", 2, "XX+YY interaction by θ, phase β"],
  ["xx_minus_yy", "2 QUBIT", 2, "XX−YY interaction by θ, phase β"],
  ["ms", "2 QUBIT", 2],
  ["rccx", "3+ QUBIT", 3, "Toffoli up to a relative phase (Margolus); CTRL-mark 2 controls"],
  ["rcccx", "3+ QUBIT", 4, "C3X up to relative phases; CTRL-mark 3 controls"],
  ["init0", "STATE PREP", 1, "reset, then |0⟩"],
  ["init1", "STATE PREP", 1, "reset, then |1⟩"],
  ["initplus", "STATE PREP", 1, "reset, then |+⟩"],
  ["initminus", "STATE PREP", 1, "reset, then |−⟩"],
  ["initiplus", "STATE PREP", 1, "reset, then |+i⟩"],
  ["initiminus", "STATE PREP", 1, "reset, then |−i⟩"],
];

export const CATALOG: CatalogItem[] = [
  ...SPECS.map(([gate, group, arity, note]): CatalogItem => {
    const def = GATES_BY_ID[gate];
    return {
      gate, group, arity,
      label: gate === "initiplus" ? "|+i⟩" : def.symbol === "X*" ? (arity === 3 ? "RCCX" : "RC3X") : def.symbol,
      params: def.params.map((p) => p.default),
      argNames: def.params.map((p) => p.name),
      note: note ?? def.description ?? def.name,
    };
  }),
  // Algorithm blocks (calc/blocks.ts): on the CTRL-marked qubits and the selected one, or on every qubit.
  { gate: "block:qft", group: "BLOCKS", arity: 0, label: "QFT", params: [], argNames: [], note: "quantum Fourier transform; CTRL-mark its qubits (else all), first = most significant" },
  { gate: "block:iqft", group: "BLOCKS", arity: 0, label: "QFT†", params: [], argNames: [], note: "inverse QFT (the read-out of phase estimation)" },
  { gate: "block:diff", group: "BLOCKS", arity: 0, label: "DIFFUSER", params: [], argNames: [], note: "Grover diffusion 2|s⟩⟨s| − I on the marked qubits (else all)" },
  { gate: "block:qaoa", group: "BLOCKS", arity: 0, label: "QAOA", params: ["π/4", "π/8"], argNames: ["γ", "β"], note: "one MaxCut layer on a ring: RZZ(2γ) per edge, RX(2β) per qubit; enter γ,β" },
  // Typed on the phone keyboard (calc/typed.ts): a state or a matrix becomes a gate.
  { gate: "typed:state", group: "TYPE IT", arity: 0, label: "STATE…", params: [], argNames: [], note: "type a state (|00⟩ + |11⟩, or amplitudes): reset, then prepare it on the marked qubits (else q0…)" },
  { gate: "typed:matrix", group: "TYPE IT", arity: 0, label: "MATRIX…", params: [], argNames: [], note: "type a unitary (rows by ;), up to 16×16: it becomes a gate on the marked qubits (else q0…)" },
  {
    gate: "initialize", group: "STATE PREP", arity: 1, label: "|ψ⟩",
    params: ["1", "0", "0", "0"], argNames: ["α", "β"],
    note: "reset, then α|0⟩+β|1⟩; enter α,β or Reα,Imα,Reβ,Imβ",
  },
];
