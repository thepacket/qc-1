import { defineConfig } from "vitest/config";

// Only the validation dump; `npm test` never runs this.
export default defineConfig({
  test: { environment: "node", include: ["validation/**/*.test.ts"] },
});
