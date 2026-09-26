/** Labels describe the reduced qubit state, never the purity of the register. */
export function blochStateLabel(length: number, estimated: boolean): string {
  if (estimated) return length > 1 + 1e-6 ? "Estimate outside sphere" : "Estimated vector";
  if (length < 1e-6) return "Maximally mixed";
  if (Math.abs(length - 1) < 1e-6) return "Pure";
  return "Mixed";
}
