// Update check for the unpacked extension.
//
// Chrome never auto-updates an extension loaded with "Load unpacked", so the
// extension asks GitHub Releases (at most once a day, without cookies) whether
// a newer version exists and tells the user how to upgrade. Nothing is
// downloaded or installed automatically.

export const RELEASES_API = "https://api.github.com/repos/Miska-raligun/net-s-memory/releases/latest";
export const CHECK_INTERVAL_HOURS = 24;
const ZIP_RE = /^net-s-memory-extension-v[\d.]+\.zip$/;

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  release_url: string | null;
  zip_url: string | null;
  zip_sha256: string | null;
  published_at: string | null;
  checked_at: string;
  error: string | null;
}

/** Compare dotted numeric versions ("0.10.0" > "0.9.3"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

interface ReleaseJson {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  body?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown; digest?: unknown }[];
}

export interface ParsedRelease {
  version: string;
  release_url: string;
  zip_url: string | null;
  zip_sha256: string | null;
  published_at: string | null;
}

export function parseRelease(json: unknown): ParsedRelease | null {
  const r = json as ReleaseJson;
  if (!r || typeof r.tag_name !== "string" || r.draft === true || r.prerelease === true) return null;
  const version = r.tag_name.replace(/^v/, "");
  if (!/^\d+(\.\d+){0,3}$/.test(version)) return null;
  const zip = (r.assets ?? []).find((a) => typeof a.name === "string" && ZIP_RE.test(a.name));
  let sha: string | null = null;
  if (zip && typeof zip.digest === "string" && /^sha256:[0-9a-f]{64}$/.test(zip.digest)) {
    sha = zip.digest.slice(7);
  } else if (typeof r.body === "string") {
    sha = /应为 ([0-9a-f]{64})/.exec(r.body)?.[1] ?? null;
  }
  const url = (u: unknown) => (typeof u === "string" && u.startsWith("https://github.com/") ? u : null);
  return {
    version,
    release_url: url(r.html_url) ?? `https://github.com/Miska-raligun/net-s-memory/releases/tag/v${version}`,
    zip_url: zip ? url(zip.browser_download_url) : null,
    zip_sha256: sha,
    published_at: typeof r.published_at === "string" ? r.published_at : null,
  };
}

export function isDue(lastCheckedAt: string | null, nowMs: number, intervalHours = CHECK_INTERVAL_HOURS): boolean {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  return !Number.isFinite(last) || nowMs - last >= intervalHours * 3_600_000;
}

export async function checkForUpdate(
  current: string,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = RELEASES_API,
  now: Date = new Date(),
): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    current,
    latest: null,
    available: false,
    release_url: null,
    zip_url: null,
    zip_sha256: null,
    published_at: null,
    checked_at: now.toISOString().replace(/\.\d+Z$/, "Z"),
    error: null,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetchImpl(apiUrl, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return { ...base, error: `GitHub 返回 HTTP ${res.status}` };
    const rel = parseRelease(await res.json());
    if (!rel) return { ...base, error: "没有可用的正式版本" };
    return {
      ...base,
      latest: rel.version,
      available: compareVersions(rel.version, current) > 0,
      release_url: rel.release_url,
      zip_url: rel.zip_url,
      zip_sha256: rel.zip_sha256,
      published_at: rel.published_at,
    };
  } catch {
    return { ...base, error: "连不上 GitHub（可能需要代理）" };
  } finally {
    clearTimeout(timer);
  }
}
