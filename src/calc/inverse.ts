/**
 * The inverse of a custom gate as another custom gate: its steps reversed,
 * each inverted (qasm/import.ts `invert`, symbols negated), nested custom
 * gates inverted in turn. Named NAME_DG, except that a block's own inverse is
 * reused (QFTk ↔ IQFTk) and inverting NAME_DG gives NAME back.
 */
import { CUSTOM_PREFIX, type CustomGate } from "./custom";
import { invert } from "../qasm/import";
import { iqft, qft } from "./blocks";
import type { Entry, Step } from "./steps";

const bare = (tape: Entry[]) => JSON.stringify(tape.map((e) => e.map(({ id: _, pin: __, ...s }) => s)));

/** The block pairs whose inverse is the other block (default settings only). */
function blockInverse(def: CustomGate): CustomGate | null {
  const m = /^(I?)QFT(\d+)$/.exec(def.name);
  if (!m) return null;
  const k = Number(m[2]);
  if (k !== def.k || bare(def.tape) !== bare(m[1] ? iqft(k) : qft(k))) return null;
  return m[1] ? { name: `QFT${k}`, k, tape: qft(k), about: "QFT (the inverse of QFT†)" } : { name: `IQFT${k}`, k, tape: iqft(k), about: "QFT† (the inverse of QFT)" };
}

/**
 * The gates to define so that `def`'s inverse exists (itself first, then any
 * nested inverses), from the gates defined so far. Throws when a step has no
 * closed-form inverse.
 */
export function inverseGates(def: CustomGate, defined: CustomGate[]): CustomGate[] {
  const byName = new Map(defined.map((d) => [d.name, d]));
  const made: CustomGate[] = [];
  const inverseOf = (d: CustomGate): string => {
    if (d.inverseOf && byName.has(d.inverseOf)) return d.inverseOf;
    const pair = blockInverse(d);
    if (pair) {
      if (!byName.has(pair.name)) { byName.set(pair.name, pair); made.push(pair); }
      return pair.name;
    }
    const name = `${d.name}_DG`;
    const have = byName.get(name);
    if (have && have.inverseOf === d.name) return name;
    if (have) throw new Error(`${name} is another gate here`);
    const tape: Entry[] = [];
    for (const e of [...d.tape].reverse()) {
      const next: Step[] = [];
      for (const s of e) {
        if (s.gateId.startsWith(CUSTOM_PREFIX)) {
          const inner = byName.get(s.gateId.slice(CUSTOM_PREFIX.length));
          if (!inner) throw new Error(`${s.gateId.slice(CUSTOM_PREFIX.length)} isn't defined`);
          next.push({ ...s, gateId: CUSTOM_PREFIX + inverseOf(inner) });
          continue;
        }
        const inv = invert(s.gateId, s.params);
        if (!inv) throw new Error(`${s.gateId.toUpperCase()} has no closed-form inverse here`);
        inv.forEach((g, k) => next.push({ ...s, id: `${s.id}~${k}`, gateId: g.gate, params: g.params }));
      }
      tape.push(next);
    }
    const out: CustomGate = { name, k: d.k, tape, inverseOf: d.name, about: d.about ? `inverse of ${d.about}` : `inverse of ${d.name}` };
    byName.set(name, out);
    made.unshift(out);
    return name;
  };
  const top = inverseOf(def);
  const first = made.find((d) => d.name === top);
  return first ? [first, ...made.filter((d) => d !== first)] : made.length ? made : [byName.get(top)!];
}
