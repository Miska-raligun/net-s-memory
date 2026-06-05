// chrome.storage wrappers: LLM config + a small assessment cache.
//
// Note on the API key: chrome.storage.local is sandboxed per-extension and
// not synced. That is adequate for an API key the user pastes in; a future
// hardening pass can add password-derived encryption (mirroring the Argon2id
// approach in net-s-memory web/lib/identity.ts) for the Nostr secret key.

import type { Assessment, LlmConfig } from "./types";

const LLM_KEY = "llm_config";
const NOSTR_SK_KEY = "nostr_sk";
const RELAYS_KEY = "nostr_relays";
const CACHE_PREFIX = "assess:";
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
