/**
 * Observable presets for the current register size, in the Pauli-sum text
 * format as Qiskit writes it (q0 rightmost: "IIZ" is Z on q0). Shared by the
 * LAB input widget (UI) and the defaults of the compute side.
 */
const str = (n: number, ops: Record<number, string>) => Array.from({ length: n }, (_, p) => ops[n - 1 - p] ?? "I").join("");
const chain = (n: number, a: string, coef: string) =>
  Array.from({ length: n - 1 }, (_, i) => `${coef}*${str(n, { [i]: a, [i + 1]: a })}`).join(" + ");
const field = (n: number, a: string, coef: string) => Array.from({ length: n }, (_, i) => `${coef}*${str(n, { [i]: a })}`).join(" + ");

export function pauliPresets(n: number): { label: string; text: string }[] {
  const out = [{ label: "Z₀", text: str(n, { 0: "Z" }) }, { label: "Z⊗n", text: "Z".repeat(n) }];
  if (n >= 2) {
    out.push(
      { label: "TFIM", text: `${chain(n, "Z", "-1")} + ${field(n, "X", "-0.5")}` },
      { label: "XXZ", text: `${chain(n, "X", "1")} + ${chain(n, "Y", "1")} + ${chain(n, "Z", "0.5")}` },
      { label: "Heisenberg", text: `${chain(n, "X", "1")} + ${chain(n, "Y", "1")} + ${chain(n, "Z", "1")}` },
      { label: "ZZ chain", text: chain(n, "Z", "1") },
    );
  }
  return out;
}

export const defaultObservable = (n: number) => pauliPresets(n)[0].text;
