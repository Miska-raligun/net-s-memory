import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: the unit tests cover pure logic only
// (no CRXJS/React plugins needed), which also avoids a dual-vite type clash.
export default defineConfig({
  resolve: {
    alias: {
      // The package's package.json "main" points at a missing file; node
      // falls back to index.js but Vite/Vitest needs it spelled out. Used
      // only by the OTS cross-validation test (devDependency).
      opentimestamps: fileURLToPath(new URL("./node_modules/opentimestamps/index.js", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
