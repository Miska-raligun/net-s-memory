// Runs only on Google / Bing result pages (see manifest). Passive: it does
// nothing unless the background worker — which opened this tab for a
// "查找其他报道" request — asks it to read the results.

import { engineOf, looksBlocked, parseSerp } from "../lib/search/serp";
import type { SerpExtractRequest, SerpExtractResponse } from "../lib/messages";

chrome.runtime.onMessage.addListener((msg: SerpExtractRequest, _sender, sendResponse) => {
  if (msg?.type !== "SERP_EXTRACT") return false;
  const engine = engineOf(location.href);
  const res: SerpExtractResponse = engine
    ? {
        engine,
        hits: parseSerp(engine, document),
        blocked: looksBlocked(engine, document, location.href),
      }
    : { engine: null, hits: [], blocked: false };
  sendResponse(res);
  return false;
});
