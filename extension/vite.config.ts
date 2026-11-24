import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: "es2022",
    // Extension pages not referenced by the manifest must be listed here.
    rollupOptions: { input: { archive: "src/archive/index.html" } },
  },
  // CRXJS uses a websocket for HMR; pin a port so it is stable in dev.
  server: { port: 5179, strictPort: false, hmr: { port: 5179 } },
});
