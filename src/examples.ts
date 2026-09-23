/**
 * The example programs (examples/*.qasm), grouped as in examples/index.json.
 * The index is bundled; each program is its own lazily loaded chunk.
 */
import index from "../examples/index.json";

export type ExampleCategory = { label: string; items: { file: string; label: string }[] };

export const EXAMPLE_CATEGORIES = index as ExampleCategory[];
export const EXAMPLE_COUNT = EXAMPLE_CATEGORIES.reduce((k, c) => k + c.items.length, 0);

const FILES = import.meta.glob("../examples/*.qasm", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

export async function loadExample(file: string): Promise<string> {
  const load = FILES[`../examples/${file}`];
  if (!load) throw new Error(`no example ${file}`);
  return load();
}

/** The program's first comment block (before or after the header lines): its description. */
export function describeProgram(text: string): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("//")) out.push(line.replace(/^\/\/\s?/, ""));
    else if (line === "") { if (out.length) out.push(""); }
    else if (out.length) break;
  }
  return out.join("\n").trim();
}

