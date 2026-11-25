import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Widget } from "./Widget";
import { bodyText, extractArticle, navigationStatus, snapshotHtml } from "../lib/extract";
import { detectPageState, isGone } from "../lib/archive/detect";
import cardCss from "../ui/card.css?inline";
import { sendMessage, type PageInfo, type Response } from "../lib/messages";

const MIN_ARTICLE_CHARS = 600;
const HOST_ID = "nsm-credibility-host";

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** Archive this page now (used for 存档本页 and for "存为证据" from another tab). */
async function captureNow(): Promise<Response> {
  const detection = detectPageState({
    url: location.href,
    title: document.title,
    bodyText: bodyText(),
    httpStatus: navigationStatus(),
  });
  const fresh = extractArticle();
  if (detection.state === "live" && fresh.text.replace(/\s+/g, "").length < 50) {
    return { ok: false, error: "这个页面几乎没有正文，无法作为证据存档" };
  }
  const host = document.getElementById(HOST_ID);
  if (host) host.style.visibility = "hidden"; // keep the widget out of the screenshot
  await nextFrame();
  await nextFrame();
  try {
    return await sendMessage({
      type: "CAPTURE",
      input: {
        url: location.href,
        title: fresh.title,
        text: fresh.text,
        page_state: detection.state,
        page_evidence: detection.evidence,
        platform: detection.platform,
      },
      html: snapshotHtml(HOST_ID),
    });
  } finally {
    if (host) host.style.visibility = "";
  }
}

// The worker opens a search result and asks this tab to archive itself.
if (window.top === window.self) {
  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
    if (msg?.type !== "AUTO_CAPTURE") return false;
    void captureNow().then(sendResponse, (e: unknown) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  });
}

function mount() {
  // Only the top frame, only once.
  if (window.top !== window.self) return;
  if (document.getElementById(HOST_ID)) return;

  const detection = detectPageState({
    url: location.href,
    title: document.title,
    bodyText: bodyText(),
    httpStatus: navigationStatus(),
  });
  const gone = isGone(detection.state);
  // Tell the worker what this page looks like now; it only records it if the
  // URL is one we archived before. Local only, no network.
  void sendMessage({ type: "REPORT_VISIT", url: location.href, state: detection.state, evidence: detection.evidence });
  const extracted = gone ? { title: document.title, text: "" } : extractArticle();
  const articleLike = extracted.text.replace(/\s+/g, "").length >= MIN_ARTICLE_CHARS;

  // Show up on article pages and on deletion pages; stay out of app shells.
  if (!gone && !articleLike) return;

  const page: PageInfo = { url: location.href, title: extracted.title, text: extracted.text };

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = cardCss;
  shadow.appendChild(style);

  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  createRoot(mountPoint).render(
    <StrictMode>
      <Widget page={page} detection={detection} articleLike={articleLike} capture={captureNow} />
    </StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
