/**
 * An IBM BackendProperties snapshot (JSON) as a NoiseModel.
 *
 * Per qubit, with t the median single-qubit gate length (35 ns if absent):
 *   ad = 1 − e^{−t/T1}                        (T1 relaxation)
 *   pd with √(1−ad)·√(1−pd) = e^{−t/T2}      (the total coherence decay is T2's;
 *                                             pd = 0 when T2 ≥ 2·T1)
 *   p1 = 2·max(0, r − r_relax)              r = the qubit's sx gate_error (average
 *                                             infidelity), r_relax the damping's own
 *                                             infidelity; depolarizing λ has r = λ/2
 *   readout = prob_meas1_prep0 (P(read 1 | 0)), readout10 = prob_meas0_prep1
 *             (P(read 0 | 1)) when the snapshot has them, else readout_error
 *             for both (symmetric)
 * Two-qubit gates (cx, ecr, cz): depolarizing λ = 4r/3 of their median error
 * (r = 3λ/4 for two qubits), per gate name; rz is virtual (no error).
 *
 * Upstream took gate_error itself as its depolarizing probability (off by
 * 1.5× / 1.25× in its own convention), used T2 as the dephasing time and
 * counted the relaxation twice.
 */
import { DEFAULT_NOISE, sanitiseNoise, type NoiseModel, type PerQubitRates } from "./model";

type Prop = { name?: unknown; value?: unknown };

const prop = (list: unknown, name: string): number | undefined => {
  if (!Array.isArray(list)) return undefined;
  for (const p of list as Prop[]) if (p && p.name === name && typeof p.value === "number" && Number.isFinite(p.value)) return p.value;
  return undefined;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Average infidelity of amplitude damping ad followed by phase damping pd (one qubit). */
export function dampingInfidelity(ad: number, pd: number): number {
  // Kraus products of AD {diag(1,√(1−a)), √a|0⟩⟨1|} and PD {diag(1,√(1−p)), √p|1⟩⟨1|}: only
  // diagonal ones have a trace. F_pro = Σ|Tr K|²/4, F_avg = (2F_pro + 1)/3.
  const c = Math.sqrt(1 - ad) * Math.sqrt(1 - pd);
  const fPro = ((1 + c) ** 2 + (1 - ad) * pd) / 4;
  return 1 - (2 * fPro + 1) / 3;
}

export function importIbmBackend(json: string): NoiseModel {
  const doc = JSON.parse(json) as Record<string, unknown>;
  if (!doc || !Array.isArray(doc.qubits)) throw new Error("not an IBM BackendProperties snapshot (no qubits array)");
  const qubits = doc.qubits as unknown[][];
  const gates = (Array.isArray(doc.gates) ? doc.gates : []) as { gate?: unknown; qubits?: unknown; parameters?: unknown }[];
  const n = qubits.length;
  const lengths = gates.filter((g) => g.gate === "sx" || g.gate === "x").map((g) => prop(g.parameters, "gate_length")).filter((x): x is number => x !== undefined);
  const t = lengths.length ? median(lengths) : 35e-9;
  const errorOf = (name: string[], q: number[]) => {
    const g = gates.find((x) => name.includes(String(x.gate)) && Array.isArray(x.qubits) && x.qubits.length === q.length && q.every((v, i) => (x.qubits as number[])[i] === v));
    return g ? prop(g.parameters, "gate_error") : undefined;
  };

  const perQubit: PerQubitRates[] = [];
  for (let q = 0; q < n; q++) {
    const T1 = prop(qubits[q], "T1"), T2 = prop(qubits[q], "T2");
    const ad = T1 && T1 > 0 ? 1 - Math.exp(-t / T1) : 0;
    let pd = 0;
    if (T2 && T2 > 0) {
      const target = Math.exp(-t / T2); // total coherence factor
      const fromAd = Math.sqrt(1 - ad);
      pd = Math.max(0, 1 - (target / fromAd) ** 2);
    }
    const r = errorOf(["sx", "x"], [q]);
    const p1 = r === undefined ? undefined : Math.min(1, 2 * Math.max(0, r - dampingInfidelity(ad, pd)));
    const p01 = prop(qubits[q], "prob_meas1_prep0"), p10 = prop(qubits[q], "prob_meas0_prep1");
    const sym = prop(qubits[q], "readout_error");
    perQubit.push({ p1, ad, pd, readout: p01 ?? sym, ...(p10 !== undefined ? { readout10: p10 } : {}) });
  }

  const perGate: Record<string, number> = { rz: 0 };
  const twoQ = new Map<string, number[]>();
  const coupling: number[][] = Array.from({ length: n }, () => []);
  const edge = (a: number, b: number) => {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || a < 0 || b < 0 || a >= n || b >= n) return;
    if (!coupling[a].includes(b)) coupling[a].push(b);
    if (!coupling[b].includes(a)) coupling[b].push(a);
  };
  for (const g of gates) {
    const name = String(g.gate);
    if (!["cx", "ecr", "cz"].includes(name) || !Array.isArray(g.qubits) || g.qubits.length !== 2) continue;
    const r = prop(g.parameters, "gate_error");
    if (r !== undefined && r < 1) twoQ.set(name, [...(twoQ.get(name) ?? []), r]);
    if (!Array.isArray(doc.coupling_map)) edge(g.qubits[0] as number, g.qubits[1] as number);
  }
  if (Array.isArray(doc.coupling_map)) for (const e of doc.coupling_map as unknown[]) if (Array.isArray(e) && e.length === 2) edge(e[0] as number, e[1] as number);
  for (const [name, rs] of twoQ) perGate[name] = Math.min(1, (4 / 3) * median(rs));

  const mean = (k: keyof PerQubitRates) => {
    const v = perQubit.map((r) => r[k]).filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  const allTwo = [...twoQ.values()].flat();
  const name = typeof doc.backend_name === "string" ? doc.backend_name : "device";
  const date = typeof doc.last_update_date === "string" ? ` @ ${doc.last_update_date.slice(0, 10)}` : "";
  return sanitiseNoise({
    enabled: true,
    trajectories: DEFAULT_NOISE.trajectories,
    p1: mean("p1") ?? DEFAULT_NOISE.p1,
    p2: allTwo.length ? Math.min(1, (4 / 3) * median(allTwo)) : DEFAULT_NOISE.p2,
    ad: mean("ad") ?? 0,
    pd: mean("pd") ?? 0,
    readout: mean("readout") ?? DEFAULT_NOISE.readout,
    crosstalk: 0,
    perQubit,
    coupling: coupling.some((c) => c.length) ? coupling : undefined,
    perGate,
    source: `${name}${date}`,
  });
}
