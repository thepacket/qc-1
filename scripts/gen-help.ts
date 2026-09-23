/**
 * docs/help/analyses.md from the LAB registry (npm run docs:help).
 * The same summaries are shown on each analysis screen in the app.
 */
import { writeFileSync } from "node:fs";
import { ANALYSES, CATEGORIES } from "../src/analysis/catalog";

const lines = [
  "# LAB analyses",
  "",
  "Generated from `src/analysis/catalog.ts` (`npm run docs:help`). Each analysis is",
  "checked against Qiskit, Qiskit Aer, numpy or scipy references (`validation/`).",
  "",
];
for (const c of CATEGORIES) {
  const items = ANALYSES.filter((a) => a.category === c.id);
  if (!items.length) continue;
  lines.push(`## ${c.label}`, "");
  for (const a of items) {
    const size = a.maxQubits >= 1024 ? "any n (also above 20 qubits)" : `n ≤ ${a.maxQubits}`;
    const inputs = a.inputs.map((i) => i.label || i.key).filter(Boolean);
    lines.push(`- **${a.title}** (${a.mode === "run" ? "RUN" : "live"}, ${size}${a.minQubits ? `, n ≥ ${a.minQubits}` : ""}${inputs.length ? `; inputs: ${inputs.join(", ")}` : ""}) — ${a.summary}`);
  }
  lines.push("");
}
writeFileSync(new URL("../docs/help/analyses.md", import.meta.url), lines.join("\n"));
console.log(`docs/help/analyses.md: ${ANALYSES.length} analyses`);
