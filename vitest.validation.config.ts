import { defineConfig } from "vitest/config";

// Only the validation dump; `npm test` never runs this. The dump is one batch
// job (8–10 s on GitHub's runners), not a unit test: Vitest's 5 s default
// failed every Validate run from 2026-09-24 on.
export default defineConfig({
  test: { environment: "node", include: ["validation/**/*.test.ts"], testTimeout: 300_000 },
});
