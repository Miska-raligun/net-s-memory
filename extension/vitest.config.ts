import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: the unit tests cover pure logic only
// (no CRXJS/React plugins needed), which also avoids a dual-vite type clash.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
