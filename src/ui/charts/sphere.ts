/** Oblique projection shared by the Bloch view and Q-sphere: x toward the viewer (lower left), y right, z up. */
const AZ = (25 * Math.PI) / 180;
const EL = (15 * Math.PI) / 180;
export function project(x: number, y: number, z: number): [number, number, number] {
  const sx = y * Math.cos(AZ) - x * Math.sin(AZ);
  const depth = x * Math.cos(AZ) + y * Math.sin(AZ);
  const sy = z * Math.cos(EL) - depth * Math.sin(EL);
  return [sx, sy, depth * Math.cos(EL) + z * Math.sin(EL)];
}
