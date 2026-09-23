/** Fresh gate ids for generated circuits (replaces the upstream React-coupled newGateId). */
let next = 1;
export function newGateId(): string {
  return `g${next++}`;
}
