// Article extraction via Mozilla Readability. Runs in the content script
// where a live `document` is available.

import { Readability } from "@mozilla/readability";

const MAX_TEXT_CHARS = 8000;

export interface Extracted {
  title: string;
  text: string;
}

export function extractArticle(): Extracted {
  const fallbackTitle = document.title || location.hostname;
  let title = fallbackTitle;
  let text = "";

  try {
    // Readability mutates the document it parses, so hand it a clone.
    const clone = document.cloneNode(true) as Document;
    const parsed = new Readability(clone).parse();
    if (parsed) {
      title = (parsed.title || fallbackTitle).trim();
      text = (parsed.textContent || "").trim();
    }
  } catch {
    // fall through to body text
  }

  if (!text) {
    text = (document.body?.innerText || "").trim();
  }
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
  }
  return { title, text };
}
