/**
 * docs/help/analyses.md from the LAB registry (npm run docs:help).
 * The same summaries are shown on each analysis screen in the app.
 */
import { writeFileSync } from "node:fs";
import { ANALYSES, CATEGORIES, analysesIn } from "../src/analysis/catalog";

const lines = [
  "# LAB analyses",
  "",
  "Generated from `src/analysis/catalog.ts` (`npm run docs:help`). An analysis has one",
  "home group and may also be listed in related ones (\"see …\"). In the LAB, search",
  "matches titles, summaries and group names; ☆ on an analysis adds it to ★ Favourites.",
  "Each analysis is",
  "checked against Qiskit, Qiskit Aer, numpy or scipy references (`validation/`).",
  "",
];
for (const c of CATEGORIES) {
  const items = analysesIn(c.id);
  if (!items.length) continue;
  lines.push(`## ${c.label}`, "");
  for (const a of items) {
    if (a.category !== c.id) {
      const home = CATEGORIES.find((x) => x.id === a.category)!.label;
      lines.push(`- **${a.title}**: see ${home}.`);
      continue;
    }
    const size = a.maxQubits >= 1024 ? "any n (also above 20 qubits)" : `n ≤ ${a.maxQubits}`;
    const inputs = a.inputs.map((i) => i.label || i.key).filter(Boolean);
    lines.push(`- **${a.title}** (${a.mode === "run" ? "RUN" : "live"}, ${size}${a.minQubits ? `, n ≥ ${a.minQubits}` : ""}${inputs.length ? `; inputs: ${inputs.join(", ")}` : ""}) — ${a.summary}`);
  }
  lines.push("");
}
writeFileSync(new URL("../docs/help/analyses.md", import.meta.url), lines.join("\n"));
console.log(`docs/help/analyses.md: ${ANALYSES.length} analyses`);
