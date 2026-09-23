import type { KeyId } from "../calc/calculator";

export type KeyKind = "shift" | "nav" | "mod" | "gate" | "digit" | "op" | "clear" | "eq";
export type KeyDef = { id: KeyId; label: string; alt?: string; kind: KeyKind; wide?: boolean; aria: string };

/** 5 × 8 portrait keypad. `alt` is the 2ND function printed above the key. */
export const KEYPAD: KeyDef[] = [
  { id: "2nd", label: "2ND", kind: "shift", aria: "Second function" },
  { id: "left", label: "◀", alt: "N−", kind: "nav", aria: "Previous qubit" },
  { id: "right", label: "▶", alt: "N+", kind: "nav", aria: "Next qubit" },
  { id: "q", label: "Q", alt: "N", kind: "nav", aria: "Select qubit number" },
  { id: "undo", label: "UNDO", alt: "REDO", kind: "nav", aria: "Undo" },

  { id: "ctrl", label: "CTRL", alt: "○CTRL", kind: "mod", aria: "Mark control" },
  { id: "all", label: "ALL", alt: "CAT", kind: "mod", aria: "Apply to all qubits" },
  { id: "swap", label: "SWAP", alt: "iSWAP", kind: "gate", aria: "Swap" },
  { id: "meas", label: "MEAS", alt: "RST", kind: "gate", aria: "Measure" },
  { id: "ac", label: "AC", kind: "clear", aria: "All clear" },

  { id: "h", label: "H", alt: "√Y", kind: "gate", aria: "Hadamard" },
  { id: "x", label: "X", alt: "MX", kind: "gate", aria: "Pauli X" },
  { id: "y", label: "Y", alt: "MY", kind: "gate", aria: "Pauli Y" },
  { id: "z", label: "Z", alt: "IF", kind: "gate", aria: "Pauli Z" },
  { id: "sx", label: "√X", alt: "√X†", kind: "gate", aria: "Square root of X" },

  { id: "s", label: "S", alt: "S†", kind: "gate", aria: "S gate" },
  { id: "t", label: "T", alt: "T†", kind: "gate", aria: "T gate" },
  { id: "rx", label: "RX", alt: "RXX", kind: "gate", aria: "Rotate X" },
  { id: "ry", label: "RY", alt: "RYY", kind: "gate", aria: "Rotate Y" },
  { id: "rz", label: "RZ", alt: "RZZ", kind: "gate", aria: "Rotate Z" },

  { id: "7", label: "7", alt: "sin", kind: "digit", aria: "7" },
  { id: "8", label: "8", alt: "cos", kind: "digit", aria: "8" },
  { id: "9", label: "9", alt: "exp", kind: "digit", aria: "9" },
  { id: "div", label: "÷", alt: "(", kind: "op", aria: "Divide" },
  { id: "p", label: "P", alt: "U", kind: "gate", aria: "Phase" },

  { id: "4", label: "4", kind: "digit", aria: "4" },
  { id: "5", label: "5", kind: "digit", aria: "5" },
  { id: "6", label: "6", kind: "digit", aria: "6" },
  { id: "mul", label: "×", alt: ")", kind: "op", aria: "Multiply" },
  { id: "minus", label: "−", alt: "+", kind: "op", aria: "Minus" },

  { id: "1", label: "1", kind: "digit", aria: "1" },
  { id: "2", label: "2", kind: "digit", aria: "2" },
  { id: "3", label: "3", kind: "digit", aria: "3" },
  { id: "pi", label: "π", alt: "√", kind: "op", aria: "Pi" },
  { id: "bs", label: "⌫", alt: "RCL", kind: "op", aria: "Backspace" },

  { id: "0", label: "0", kind: "digit", wide: true, aria: "0" },
  { id: ".", label: ".", alt: "t", kind: "digit", aria: "Decimal point" },
  { id: ",", label: ",", alt: "VAR", kind: "digit", aria: "Argument separator" },
  { id: "eq", label: "=", alt: "STO", kind: "eq", aria: "Repeat last" },
];

/** Hardware-keyboard shortcuts (desktop / Bluetooth keyboards). */
export const KEYBOARD: Record<string, KeyId> = {
  "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  ".": ".", ",": ",", "/": "div", "*": "mul", "-": "minus", p: "pi",
  Backspace: "bs", Escape: "ac", Enter: "eq", "=": "eq",
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "left", ArrowDown: "right", q: "q", u: "undo",
  c: "ctrl", a: "all", m: "meas", w: "swap",
  h: "h", x: "x", y: "y", z: "z", s: "s", t: "t", v: "sx",
  Shift: "2nd",
};
