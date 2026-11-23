import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";
import { SERP_MATCHES } from "./src/lib/search/serp";

// Manifest V3. Fully client-side: no net-s-memory server. The extension
// talks only to public Nostr relays, OpenTimestamps calendars, the Internet
// Archive, optional Blossom servers and LLM endpoint the user configures, and
// Google/Bing result pages opened in the user's own browser.
export default defineManifest({
  manifest_version: 3,
  name: "互联网记忆 · 存档与见证",
  version: pkg.version,
  description:
    "在浏览器里存下网页原文并做哈希与比特币时间戳，识别删帖页面，用 Nostr 发布可独立验证的见证。无需任何自建服务器。",
  action: {
    default_popup: "src/popup/index.html",
    default_title: "互联网记忆",
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      exclude_matches: SERP_MATCHES,
      js: ["src/content/index.tsx"],
      run_at: "document_idle",
    },
    {
      matches: SERP_MATCHES,
      js: ["src/content/serp.ts"],
      run_at: "document_idle",
    },
  ],
  // unlimitedStorage: captures (text, HTML, screenshots) stay local.
  permissions: ["storage", "unlimitedStorage", "activeTab"],
  // <all_urls> is what chrome.tabs.captureVisibleTab requires for the
  // screenshot; it also covers relays, calendars, Blossom and the LLM endpoint.
  host_permissions: ["<all_urls>"],
});
