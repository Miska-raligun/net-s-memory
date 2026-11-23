// Search-engine results page (SERP) handling for Google and Bing.
//
// No search API is used. The background worker opens a real search tab in
// the user's own browser (their own cookies, consent and region), and a
// content script reads the rendered results page with the parsers below.
// That keeps us off domestic search providers and needs no API key.

import { extractDomain } from "../url";
import { isDomestic } from "./domestic";

export type Engine = "google" | "bing";

export interface SearchHit {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  domestic: boolean;
}

export function buildSearchUrl(engine: Engine, query: string): string {
  const q = encodeURIComponent(query);
  if (engine === "bing") {
    // ensearch=1 forces Bing's international index instead of cn.bing.com.
    return `https://www.bing.com/search?q=${q}&ensearch=1`;
  }
  return `https://www.google.com/search?q=${q}&hl=zh-CN`;
}

/** Hosts whose /search pages the SERP content script is allowed to read. */
export const SERP_MATCHES = [
  "https://www.google.com/search*",
  "https://www.google.com.hk/search*",
  "https://www.google.com.tw/search*",
  "https://www.bing.com/search*",
  "https://cn.bing.com/search*",
];

export function engineOf(href: string): Engine | null {
  try {
    const host = new URL(href).hostname;
    if (/(^|\.)google\.com(\.[a-z]{2})?$/.test(host)) return "google";
    if (/(^|\.)bing\.com$/.test(host)) return "bing";
  } catch {
    // ignore
  }
  return null;
}

function b64urlDecode(s: string): string | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Unwrap engine click-tracking redirects to the destination URL. */
export function unwrapResultUrl(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href, "https://www.example.invalid");
  } catch {
    return null;
  }
  // Bing: /ck/a?...&u=a1<base64url(dest)>
  if (/bing\.com$/.test(u.hostname) && u.pathname.startsWith("/ck/")) {
    const enc = u.searchParams.get("u");
    if (enc && enc.startsWith("a1")) return b64urlDecode(enc.slice(2));
    return null;
  }
  // Google: /url?q=<dest> or /url?url=<dest>
  if (u.pathname === "/url") {
    return u.searchParams.get("q") ?? u.searchParams.get("url");
  }
  if (u.hostname === "www.example.invalid") return null; // relative, not a result
  return u.toString();
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function toHit(title: string, href: string | null, snippet: string): SearchHit | null {
  if (!title || !href) return null;
  const url = unwrapResultUrl(href);
  if (!url || !/^https?:/.test(url)) return null;
  const domain = extractDomain(url);
  if (!domain || engineOf(url)) return null; // skip links back into the engine
  return { title, url, domain, snippet, domestic: isDomestic(domain) };
}

export function parseGoogle(doc: Document): SearchHit[] {
  const out: SearchHit[] = [];
  for (const h3 of Array.from(doc.querySelectorAll("#search a h3, #rso a h3"))) {
    const a = h3.closest("a");
    const block = h3.closest("div.g, div[data-hveid], div.MjjYud") ?? a?.parentElement;
    const snippetEl = block?.querySelector(".VwiC3b, [data-sncf], .IsZvec");
    const hit = toHit(text(h3), a?.getAttribute("href") ?? null, text(snippetEl));
    if (hit) out.push(hit);
  }
  return dedupe(out);
}

export function parseBing(doc: Document): SearchHit[] {
  const out: SearchHit[] = [];
  for (const li of Array.from(doc.querySelectorAll("#b_results > li.b_algo"))) {
    const a = li.querySelector("h2 a");
    const snippetEl = li.querySelector(".b_caption p, .b_lineclamp2, .b_lineclamp3, .b_algoSlug");
    const hit = toHit(text(a), a?.getAttribute("href") ?? null, text(snippetEl));
    if (hit) out.push(hit);
  }
  return dedupe(out);
}

export function parseSerp(engine: Engine, doc: Document): SearchHit[] {
  return engine === "google" ? parseGoogle(doc) : parseBing(doc);
}

/** Heuristic: the engine is showing a captcha / consent wall, not results. */
export function looksBlocked(engine: Engine, doc: Document, href: string): boolean {
  if (engine === "google" && /\/sorry\//.test(href)) return true;
  if (doc.querySelector("#captcha-form, #recaptcha, iframe[src*='recaptcha']")) return true;
  if (engine === "google" && doc.querySelector("form[action*='consent']")) return true;
  return false;
}

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));
}

/** Drop the page being searched for and (optionally) mainland sources. */
export function filterHits(
  hits: SearchHit[],
  opts: { excludeUrl?: string; hideDomestic: boolean },
): { hits: SearchHit[]; hiddenDomestic: number } {
  let hidden = 0;
  const kept = hits.filter((h) => {
    if (opts.excludeUrl && h.url.split("#")[0] === opts.excludeUrl.split("#")[0]) return false;
    if (opts.hideDomestic && h.domestic) {
      hidden++;
      return false;
    }
    return true;
  });
  return { hits: kept, hiddenDomestic: hidden };
}
