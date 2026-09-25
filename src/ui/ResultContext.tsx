import type { Provenance } from "../calc/provenance";
import { parsePauliSum } from "../sim/trotter";

export function ResultSource({ source }: { source?: Provenance }) {
  if (!source) return null;
  return <div className="result-source"><strong>{source.method}</strong><span>{source.detail}</span></div>;
}

export function bitOrder(n: number, first = 0): string {
  return n <= 8 ? Array.from({ length: n }, (_, j) => `q${first + n - 1 - j}`).join(" ") : `q${first + n - 1} … q${first + 1} q${first}`;
}

export function BitOrder({ n }: { n: number }) {
  return <div className="bit-order" aria-label="Bitstring qubit order">{bitOrder(n)} <span>· q0 rightmost</span></div>;
}

export function pauliMeaning(text: string, n: number): string {
  try {
    const terms = parsePauliSum(text);
    if (!terms.length) return "Enter an observable to see its qubit mapping.";
    if (terms.some(t => t.paulis.length !== n)) return `Use ${n} letters per Pauli string, with q0 on the right.`;
    return terms.slice(0, 3).map(t => {
      const ops = [...t.paulis].flatMap((p, j) => p === "I" ? [] : [`${p} on q${n - 1 - j}`]);
      return `${t.paulis} → ${ops.join(", ") || "identity"}`;
    }).join("; ") + (terms.length > 3 ? "; …" : "");
  } catch { return "Use Pauli strings such as IIZ, with q0 on the right."; }
}
