import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

// Manifest V3. The extension is fully client-side: it talks only to the
// user's own LLM endpoint, public Nostr relays, and OpenTimestamps
// calendars — never to a net-s-memory server.
export default defineManifest({
  manifest_version: 3,
  name: "互联网记忆 · 信源可信度",
  version: pkg.version,
  description:
    "去中心化的新闻信源可信度标注：客户端 LLM 现场评估 + Nostr P2P 社区存证，无需任何自建服务器。",
  default_locale: undefined,
  action: {
    default_popup: "src/popup/index.html",
    default_title: "信源可信度",
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content/index.tsx"],
      run_at: "document_idle",
    },
  ],
  permissions: ["storage", "activeTab"],
  // Needed so the background worker can fetch the user's chosen LLM
  // endpoint (any origin) and open relay websockets.
  host_permissions: ["http://*/*", "https://*/*"],
});
