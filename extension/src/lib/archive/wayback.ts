// Ask the Internet Archive to take its own copy (Save Page Now). This gives
// a third-party snapshot that neither the user nor any relay controls.
// Anonymous SPN is rate-limited and can take tens of seconds; failures are
// non-fatal and simply leave wayback_url unset.

const SNAPSHOT_RE = /https?:\/\/web\.archive\.org\/web\/(\d{14})[^/]*\/(.+)$/;

export function snapshotFromLocation(loc: string | null | undefined): string | null {
  if (!loc) return null;
  const abs = loc.startsWith("/") ? `https://web.archive.org${loc}` : loc;
  const m = SNAPSHOT_RE.exec(abs);
  return m ? `https://web.archive.org/web/${m[1]}/${m[2]}` : null;
}

export async function saveToWayback(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 90_000,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://web.archive.org/save/${url}`, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
    });
    return (
      snapshotFromLocation(res.headers.get("content-location")) ??
      snapshotFromLocation(res.url) ??
      null
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
