// chrome.storage wrappers: LLM config + a small assessment cache.
//
// Note on the API key: chrome.storage.local is sandboxed per-extension and
// not synced. That is adequate for an API key the user pastes in; a future
// hardening pass can add password-derived encryption (mirroring the Argon2id
// approach in net-s-memory web/lib/identity.ts) for the Nostr secret key.

import type { Assessment, LlmConfig } from "./types";
import type { Capture } from "./archive/capture";
import type { PageState } from "./archive/detect";
import type { Engine } from "./search/serp";
import type { WatchEntry } from "./archive/recheck";

const LLM_KEY = "llm_config";
const NOSTR_SK_KEY = "nostr_sk";
const RELAYS_KEY = "nostr_relays";
const CACHE_PREFIX = "assess:";
const OTS_PREFIX = "ots:";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

export async function getLlmConfig(): Promise<LlmConfig | null> {
  const out = await chrome.storage.local.get(LLM_KEY);
  return (out[LLM_KEY] as LlmConfig | undefined) ?? null;
}

export async function setLlmConfig(config: LlmConfig | null): Promise<void> {
  if (config === null) {
    await chrome.storage.local.remove(LLM_KEY);
  } else {
    await chrome.storage.local.set({ [LLM_KEY]: config });
  }
}

// --- Nostr identity (secp256k1 secret key, hex) ---
// Stored in chrome.storage.local. A future hardening pass should encrypt
// this with a password-derived key (mirroring web/lib/identity.ts Argon2id).
export async function getNostrSk(): Promise<string | null> {
  const out = await chrome.storage.local.get(NOSTR_SK_KEY);
  return (out[NOSTR_SK_KEY] as string | undefined) ?? null;
}

export async function setNostrSk(skHex: string | null): Promise<void> {
  if (skHex === null) await chrome.storage.local.remove(NOSTR_SK_KEY);
  else await chrome.storage.local.set({ [NOSTR_SK_KEY]: skHex });
}

export async function getRelays(): Promise<string[]> {
  const out = await chrome.storage.local.get(RELAYS_KEY);
  const relays = out[RELAYS_KEY] as string[] | undefined;
  return relays && relays.length > 0 ? relays : DEFAULT_RELAYS;
}

export async function setRelays(relays: string[]): Promise<void> {
  await chrome.storage.local.set({ [RELAYS_KEY]: relays });
}

interface CacheEntry {
  assessment: Assessment;
  stored_at: number;
}

export async function getCachedAssessment(url: string): Promise<Assessment | null> {
  const key = CACHE_PREFIX + url;
  const out = await chrome.storage.local.get(key);
  const entry = out[key] as CacheEntry | undefined;
  if (!entry) return null;
  if (Date.now() - entry.stored_at > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return entry.assessment;
}

export async function putCachedAssessment(assessment: Assessment): Promise<void> {
  const key = CACHE_PREFIX + assessment.url;
  const entry: CacheEntry = { assessment, stored_at: Date.now() };
  await chrome.storage.local.set({ [key]: entry });
}

// --- OpenTimestamps proofs (base64), keyed by normalized URL ---
export async function getOtsProof(url: string): Promise<string | null> {
  const key = OTS_PREFIX + url;
  const out = await chrome.storage.local.get(key);
  return (out[key] as string | undefined) ?? null;
}

export async function putOtsProof(url: string, proofB64: string): Promise<void> {
  await chrome.storage.local.set({ [OTS_PREFIX + url]: proofB64 });
}

// --- Archive: settings, captures, local blobs ------------------------------
//
// Captures and their artifacts stay in chrome.storage.local (the manifest
// requests unlimitedStorage). Nothing here leaves the browser until the user
// explicitly publishes a witness event.


export interface ArchiveSettings {
  /** Submit live pages to the Internet Archive (Save Page Now). */
  wayback: boolean;
  /** Timestamp each capture's text hash via OpenTimestamps (only the hash leaves the browser). */
  ots: boolean;
  /** Keep a local screenshot of the visible area. */
  screenshot: boolean;
  /** Keep a local copy of the raw HTML. */
  html: boolean;
  /** Blossom servers for publishing blobs. Empty = never upload blobs. */
  blossom_servers: string[];
  /** Also upload the screenshot / raw HTML when publishing (may contain your login info). */
  publish_screenshot: boolean;
  publish_html: boolean;
  /** Search engine opened in your own browser for "查找其他报道". */
  search_engine: Engine;
  /** Hide mainland-hosted results when searching for corroboration. */
  hide_domestic: boolean;
  /** Periodically re-fetch archived URLs (no cookies) to notice deletions. */
  recheck: boolean;
}

export const DEFAULT_ARCHIVE_SETTINGS: ArchiveSettings = {
  wayback: true,
  ots: true,
  screenshot: true,
  html: true,
  blossom_servers: [],
  publish_screenshot: false,
  publish_html: false,
  search_engine: "google",
  hide_domestic: true,
  recheck: true,
};

const ARCHIVE_SETTINGS_KEY = "archive_settings";
const CAPTURE_PREFIX = "cap:";
const CAPTURE_INDEX_KEY = "cap_index";
const BLOB_PREFIX = "blob:";

export interface CaptureSummary {
  id: string;
  url: string;
  title: string;
  captured_at: string;
  page_state: PageState;
  text_sha256: string;
}

export async function getArchiveSettings(): Promise<ArchiveSettings> {
  const out = await chrome.storage.local.get(ARCHIVE_SETTINGS_KEY);
  return { ...DEFAULT_ARCHIVE_SETTINGS, ...((out[ARCHIVE_SETTINGS_KEY] as Partial<ArchiveSettings>) ?? {}) };
}

export async function setArchiveSettings(s: ArchiveSettings): Promise<void> {
  await chrome.storage.local.set({ [ARCHIVE_SETTINGS_KEY]: s });
}

async function getIndex(): Promise<CaptureSummary[]> {
  const out = await chrome.storage.local.get(CAPTURE_INDEX_KEY);
  return (out[CAPTURE_INDEX_KEY] as CaptureSummary[] | undefined) ?? [];
}

function summaryOf(c: Capture): CaptureSummary {
  return {
    id: c.id,
    url: c.url,
    title: c.title,
    captured_at: c.captured_at,
    page_state: c.page_state,
    text_sha256: c.text_sha256,
  };
}

export async function putCapture(c: Capture): Promise<void> {
  const index = (await getIndex()).filter((s) => s.id !== c.id);
  index.unshift(summaryOf(c));
  index.sort((a, b) => (a.captured_at < b.captured_at ? 1 : -1));
  await chrome.storage.local.set({ [CAPTURE_PREFIX + c.id]: c, [CAPTURE_INDEX_KEY]: index });
}

export async function getCapture(id: string): Promise<Capture | null> {
  const out = await chrome.storage.local.get(CAPTURE_PREFIX + id);
  return (out[CAPTURE_PREFIX + id] as Capture | undefined) ?? null;
}

export async function listCaptures(url?: string): Promise<CaptureSummary[]> {
  const index = await getIndex();
  return url ? index.filter((s) => s.url === url) : index;
}

export async function deleteCapture(id: string): Promise<void> {
  const c = await getCapture(id);
  const index = (await getIndex()).filter((s) => s.id !== id);
  const keys = [CAPTURE_PREFIX + id];
  if (c) {
    // Drop local blobs no other capture references.
    const others = await Promise.all(index.map((s) => getCapture(s.id)));
    const stillUsed = new Set(others.flatMap((o) => o?.blobs.map((b) => b.sha256) ?? []));
    for (const b of c.blobs) if (!stillUsed.has(b.sha256)) keys.push(BLOB_PREFIX + b.sha256);
  }
  await chrome.storage.local.remove(keys);
  await chrome.storage.local.set({ [CAPTURE_INDEX_KEY]: index });
}

interface StoredBlob {
  mime: string;
  b64: string;
}

export async function putLocalBlob(sha256: string, mime: string, b64: string): Promise<void> {
  await chrome.storage.local.set({ [BLOB_PREFIX + sha256]: { mime, b64 } satisfies StoredBlob });
}

export async function getLocalBlob(sha256: string): Promise<StoredBlob | null> {
  const out = await chrome.storage.local.get(BLOB_PREFIX + sha256);
  return (out[BLOB_PREFIX + sha256] as StoredBlob | undefined) ?? null;
}

// --- Watch list: archived URLs and their observed state over time ---------

const WATCH_PREFIX = "watch:";
const WATCH_INDEX_KEY = "watch_index";

export async function listWatchUrls(): Promise<string[]> {
  const out = await chrome.storage.local.get(WATCH_INDEX_KEY);
  return (out[WATCH_INDEX_KEY] as string[] | undefined) ?? [];
}

export async function getWatch(url: string): Promise<WatchEntry | null> {
  const out = await chrome.storage.local.get(WATCH_PREFIX + url);
  return (out[WATCH_PREFIX + url] as WatchEntry | undefined) ?? null;
}

export async function listWatches(): Promise<WatchEntry[]> {
  const urls = await listWatchUrls();
  if (urls.length === 0) return [];
  const out = await chrome.storage.local.get(urls.map((u) => WATCH_PREFIX + u));
  return urls.map((u) => out[WATCH_PREFIX + u] as WatchEntry | undefined).filter((w): w is WatchEntry => !!w);
}

export async function putWatch(w: WatchEntry): Promise<void> {
  const urls = await listWatchUrls();
  const patch: Record<string, unknown> = { [WATCH_PREFIX + w.url]: w };
  if (!urls.includes(w.url)) patch[WATCH_INDEX_KEY] = [...urls, w.url];
  await chrome.storage.local.set(patch);
}
