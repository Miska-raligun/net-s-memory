import { defineConfig } from "vitest/config";

// Opt-in integration tests (need a live websocket relay). Run with
// `npm run test:it`; kept out of the default CI test run.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.ts"],
    testTimeout: 20000,
  },
});
