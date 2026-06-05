// URL normalization + domain extraction.
//
// Normalization is what lets two users' attestations about "the same
// article" collide on one address. We are deliberately conservative: lower
// the host, drop tracking params and fragments, strip a trailing slash.

const TRACKING_PARAM_PREFIXES = ["utm_", "ga_", "yclid", "_hs"];
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "spm",
  "ref",
  "ref_src",
  "ref_url",
  "from",
  "source",
  "share_token",
  "scene",
]);

function isTracking(key: string): boolean {
  const k = key.toLowerCase();
  if (TRACKING_PARAMS.has(k)) return true;
  return TRACKING_PARAM_PREFIXES.some((p) => k.startsWith(p));
}

/** Normalize an article URL into a stable canonical form. */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw.trim();
  }
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  // Drop default ports.
  if (
    (u.protocol === "http:" && u.port === "80") ||
    (u.protocol === "https:" && u.port === "443")
  ) {
    u.port = "";
  }
  // Strip tracking params, then sort the remainder for determinism.
  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (!isTracking(k)) kept.push([k, v]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);

  let out = u.toString();
  // Remove a single trailing slash on the path (but not the bare origin).
  if (out.endsWith("/") && new URL(out).pathname !== "/") {
    out = out.slice(0, -1);
  }
  return out;
}

/** Hostname only, lower-cased, no leading "www.". */
export function extractDomain(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/**
 * Candidate registrable domains, longest → shortest, for suffix matching
 * against the seed reputation table. e.g. "news.sina.com.cn" yields
 * ["news.sina.com.cn", "sina.com.cn", "com.cn", "cn"]. A full Public
 * Suffix List would be more precise; this is a pragmatic seed.
 */
export function domainCandidates(domain: string): string[] {
  const parts = domain.split(".").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(i).join("."));
  }
  return out;
}
