import { test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * QC-1 has no brand ties to the project its code was ported from: nothing a
 * user sees may name it. Source comments may (provenance); user-facing files
 * may not. CI additionally greps the built bundle (dist/).
 */
const ROOT = new URL("..", import.meta.url).pathname;
const USER_FACING = ["index.html", "vite.config.ts", "public", "examples", "docs/help"];
const TEXT = /\.(html|ts|tsx|json|md|qasm|svg|webmanifest|txt)$/;

function files(p: string): string[] {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs).flatMap((f) => files(join(p, f)));
}

test("no upstream brand in user-facing files", () => {
  const hits = USER_FACING.flatMap(files)
    .filter((f) => TEXT.test(f))
    .filter((f) => /quantiom/i.test(readFileSync(f, "utf8")));
  expect(hits).toEqual([]);
});
