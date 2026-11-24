// Background re-checking of URLs the user has archived.
//
// The service worker has no DOM, so the fetched HTML is reduced to text with
// a small tag-stripper — enough for deletion-page phrase detection, which is
// all we need here. Platforms whose pages are client-rendered (Weibo, Zhihu,
// Douyin, Bilibili) return an empty shell or a login wall to a plain fetch;
// re-checking them would produce false "live" / "deleted" verdicts, so they
// are only judged when the user actually visits (content-script detection).

import { detectPageState, platformOf, type PageState, type Platform } from "./detect";

/** Delays after capture at which to re-check; then stop (≈ 3 months). */
export const RECHECK_SCHEDULE_HOURS = [1, 6, 24, 72, 168, 720, 2160];

const UNRELIABLE: Platform[] = ["weibo", "zhihu", "douyin", "bilibili"];

export function recheckSupported(url: string): boolean {
  return !UNRELIABLE.includes(platformOf(url));
}

export interface WatchEntry {
  url: string;
  first_captured_at: string;
  last_text_sha256: string;
  state: PageState;
  evidence: string | null;
  checks: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  /** When we first saw it gone (visit or re-check). */
  gone_since: string | null;
  /** Unacknowledged transition to gone; drives the toolbar badge. */
  unseen_gone: boolean;
  history: { at: string; state: PageState; evidence: string | null; method: "visit" | "recheck" }[];
}

function addHours(iso: string, h: number): string {
  return new Date(Date.parse(iso) + h * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");
}

export function nextCheckAt(firstCapturedAt: string, checksDone: number): string | null {
  const h = RECHECK_SCHEDULE_HOURS[checksDone];
  return h === undefined ? null : addHours(firstCapturedAt, h);
}

export function newWatch(url: string, capturedAt: string, textSha256: string, state: PageState): WatchEntry {
  return {
    url,
    first_captured_at: capturedAt,
    last_text_sha256: textSha256,
    state,
    evidence: null,
    checks: 0,
    last_checked_at: null,
    next_check_at: recheckSupported(url) && state === "live" ? nextCheckAt(capturedAt, 0) : null,
    gone_since: null,
    unseen_gone: false,
    history: [],
  };
}

/** Fold one observation into a watch entry (pure). Returns true if it newly went gone. */
export function applyObservation(
  w: WatchEntry,
  obs: { at: string; state: PageState; evidence: string | null; method: "visit" | "recheck" },
): boolean {
  const wasGone = w.state !== "live";
  const changed = w.state !== obs.state;
  w.state = obs.state;
  w.evidence = obs.evidence;
  if (changed || w.history.length === 0) {
    w.history.push(obs);
    if (w.history.length > 50) w.history.shift();
  }
  if (obs.method === "recheck") {
    w.checks += 1;
    w.last_checked_at = obs.at;
  }
  const nowGone = obs.state !== "live";
  if (nowGone) {
    w.next_check_at = null; // stop polling something that is gone
    if (!wasGone) {
      w.gone_since = obs.at;
      w.unseen_gone = true;
      return true;
    }
  } else {
    w.gone_since = null;
    w.unseen_gone = false;
    w.next_check_at = recheckSupported(w.url) ? nextCheckAt(w.first_captured_at, w.checks) : null;
  }
  return false;
}

export function dueEntries(entries: WatchEntry[], nowIso: string, max: number): WatchEntry[] {
  return entries
    .filter((w) => w.next_check_at !== null && w.next_check_at <= nowIso)
    .sort((a, b) => (a.next_check_at! < b.next_check_at! ? -1 : 1))
    .slice(0, max);
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

export function htmlToText(html: string): { title: string; text: string } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const text = html
    .replace(/<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
  return { title, text };
}

/** Anti-bot / verification walls: neither live nor deleted, so inconclusive. */
const INCONCLUSIVE = [
  "环境异常",
  "完成验证后即可继续访问",
  "请在微信客户端打开链接",
  "访问过于频繁",
  "安全验证",
  "captcha",
];

export interface RecheckResult {
  state: PageState;
  evidence: string | null;
  http_status: number | null;
}

/**
 * Fetch without cookies (so the verdict reflects what the public sees, and
 * the request carries no account identity) and classify the response.
 * Returns null when the check is inconclusive (network error, 5xx, 429).
 */
export async function recheckUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<RecheckResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { credentials: "omit", redirect: "follow", signal: ctrl.signal });
    if (res.status >= 500 || res.status === 429) return null;
    const { title, text } = htmlToText(await res.text());
    const lower = `${title} ${text}`.toLowerCase();
    if (res.status < 400 && text.length < 3000 && INCONCLUSIVE.some((p) => lower.includes(p.toLowerCase()))) {
      return null;
    }
    const d = detectPageState({ url: res.url || url, title, bodyText: text, httpStatus: res.status });
    return { state: d.state, evidence: d.evidence, http_status: res.status };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
