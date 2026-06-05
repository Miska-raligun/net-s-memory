// Background service worker: message router + assessment cache. All network
// calls (the user's LLM endpoint) happen here, off the page's origin.

import { assessPage } from "../lib/assess";
import { getCachedAssessment, getLlmConfig, putCachedAssessment } from "../lib/storage";
import { normalizeUrl } from "../lib/url";
import type { Request, Response } from "../lib/messages";

async function handle(msg: Request): Promise<Response> {
  if (msg.type === "GET_CACHED") {
    const cached = await getCachedAssessment(normalizeUrl(msg.url));
    return cached ? { ok: true, assessment: cached, cached: true } : { ok: true, assessment: null };
  }
  if (msg.type === "ASSESS") {
    const url = normalizeUrl(msg.page.url);
    if (!msg.force) {
      const cached = await getCachedAssessment(url);
      if (cached) return { ok: true, assessment: cached, cached: true };
    }
    const cfg = await getLlmConfig();
    const assessment = await assessPage(msg.page, cfg);
    await putCachedAssessment(assessment);
    return { ok: true, assessment, cached: false };
  }
  return { ok: false, error: "unknown message type" };
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e: unknown) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  return true; // keep the channel open for the async response
});
