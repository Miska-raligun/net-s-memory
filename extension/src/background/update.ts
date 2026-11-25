// Daily "is there a newer release?" check. Read-only: nothing is downloaded
// or installed; the popup explains how to upgrade an unpacked extension.

import { checkForUpdate, compareVersions, isDue, RELEASES_API, type UpdateInfo } from "../lib/update";
import { getArchiveSettings, getUpdateApiUrl, getUpdateInfo, setUpdateInfo } from "../lib/storage";

export function currentVersion(): string {
  return chrome.runtime.getManifest().version;
}

/** Stored info, re-evaluated against the running version (it may have just been upgraded). */
export async function storedUpdate(): Promise<UpdateInfo | null> {
  const u = await getUpdateInfo();
  if (!u) return null;
  const cur = currentVersion();
  return { ...u, current: cur, available: u.latest !== null && compareVersions(u.latest, cur) > 0 };
}

export async function runUpdateCheck(force: boolean): Promise<UpdateInfo | null> {
  const prev = await getUpdateInfo();
  if (!force) {
    if (!(await getArchiveSettings()).check_updates) return storedUpdate();
    if (!isDue(prev?.checked_at ?? null, Date.now())) return storedUpdate();
  }
  const u = await checkForUpdate(currentVersion(), fetch, (await getUpdateApiUrl()) ?? RELEASES_API);
  // A failed check keeps the last known good result, only refreshing the error.
  const next = u.error && prev?.latest ? { ...prev, checked_at: u.checked_at, error: u.error } : u;
  await setUpdateInfo(next);
  return storedUpdate();
}
