// Article extraction. Runs in the content script where a live `document` is
// available.
//
// The archive hashes the extracted text, so extraction must be as stable as
// possible across users: platform-specific containers first (e.g. WeChat's
// #js_content), then Mozilla Readability, then the body. Paragraph structure
// is preserved by a DOM walk that emits "\n" around block elements, instead
// of Readability's flat textContent. Normalization happens later
// (lib/archive/normalize.ts).

import { Readability } from "@mozilla/readability";

export interface Extracted {
  title: string;
  text: string;
}

const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl", "dt",
  "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li",
  "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tr", "td", "th", "ul",
]);
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "button"]);

/** Text of an element with block boundaries turned into newlines. */
export function blockText(root: Node): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    const block = BLOCK.has(tag);
    if (block) parts.push("\n");
    node.childNodes.forEach(walk);
    if (block) parts.push("\n");
  };
  walk(root);
  return parts.join("");
}

interface PlatformExtractor {
  host: RegExp;
  content: string;
  title?: string;
}

const PLATFORM_EXTRACTORS: PlatformExtractor[] = [
  { host: /(^|\.)mp\.weixin\.qq\.com$/, content: "#js_content", title: "#activity-name" },
  { host: /(^|\.)zhuanlan\.zhihu\.com$/, content: ".Post-RichText", title: ".Post-Title" },
];

function fromPlatform(): Extracted | null {
  const ex = PLATFORM_EXTRACTORS.find((p) => p.host.test(location.hostname));
  if (!ex) return null;
  const el = document.querySelector(ex.content);
  if (!el) return null;
  const title = (ex.title && document.querySelector(ex.title)?.textContent?.trim()) || document.title;
  return { title, text: blockText(el) };
}

export function extractArticle(): Extracted {
  const fallbackTitle = document.title || location.hostname;

  const platform = fromPlatform();
  if (platform && platform.text.trim()) return platform;

  try {
    // Readability mutates the document it parses, so hand it a clone.
    const clone = document.cloneNode(true) as Document;
    const parsed = new Readability(clone).parse();
    if (parsed?.content) {
      const holder = new DOMParser().parseFromString(parsed.content, "text/html").body;
      const text = blockText(holder);
      if (text.trim()) return { title: (parsed.title || fallbackTitle).trim(), text };
    }
  } catch {
    // fall through to body text
  }
  return { title: fallbackTitle, text: document.body ? blockText(document.body) : "" };
}

/** Visible body text, for deletion-page detection (cheap, no Readability). */
export function bodyText(): string {
  return (document.body?.innerText || "").slice(0, 20_000);
}

/** HTTP status of the top-level navigation (Chrome 109+), if exposed. */
export function navigationStatus(): number | null {
  const nav = performance.getEntriesByType("navigation")[0] as
    | (PerformanceNavigationTiming & { responseStatus?: number })
    | undefined;
  return nav?.responseStatus && nav.responseStatus > 0 ? nav.responseStatus : null;
}

/** Serialized page HTML without our own widget host. */
export function snapshotHtml(excludeId: string): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector(`#${excludeId}`)?.remove();
  const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>\n` : "";
  return doctype + clone.outerHTML;
}
