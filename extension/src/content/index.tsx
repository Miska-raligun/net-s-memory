import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Widget } from "./Widget";
import { extractArticle } from "../lib/extract";
import cardCss from "../ui/card.css?inline";
import type { PageInfo } from "../lib/messages";

const MIN_ARTICLE_CHARS = 600;
const HOST_ID = "nsm-credibility-host";

function mount() {
  // Only run in the top frame and only on article-like pages, so we don't
  // litter app shells / iframes with a badge.
  if (window.top !== window.self) return;
  if (document.getElementById(HOST_ID)) return;

  const extracted = extractArticle();
  if (extracted.text.length < MIN_ARTICLE_CHARS) return;

  const page: PageInfo = {
    url: location.href,
    title: extracted.title,
    text: extracted.text,
  };

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
      <Widget page={page} />
    </StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
