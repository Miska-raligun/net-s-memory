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

  async function capture(): Promise<Response> {
    // Re-extract at click time: the page may have lazy-loaded more content.
    const fresh = extractArticle();
    host.style.visibility = "hidden"; // keep the widget out of the screenshot
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
      host.style.visibility = "";
    }
  }

  createRoot(mountPoint).render(
    <StrictMode>
      <Widget page={page} detection={detection} articleLike={articleLike} capture={capture} />
    </StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
