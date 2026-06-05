// Relay I/O via nostr-tools SimplePool. All of this runs in the background
// service worker — never in the content script — so websocket connections are
// not subject to the visited page's Content-Security-Policy.
//
// Every call opens a short-lived pool, does one round-trip (query reaches
// EOSE, or publish settles), then closes. That fits MV3's ephemeral SW
// lifetime and needs no long-lived connection.

import { SimplePool, type Event } from "nostr-tools";
import { ATTESTATION_KIND } from "./attestation";

const DEFAULT_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Fetch all attestations for one URL address (the "d" tag). */
export async function queryAttestations(
  relays: string[],
  urlAddr: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Event[]> {
  const pool = new SimplePool();
  try {
    return await withTimeout(
      pool.querySync(relays, { kinds: [ATTESTATION_KIND], "#d": [urlAddr] }),
      timeoutMs,
      [],
    );
  } catch {
    return [];
  } finally {
    pool.close(relays);
  }
}

/** Fetch the pubkeys a user follows (NIP-02 kind:3 contact list). */
export async function queryFollows(
  relays: string[],
  pubkey: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Set<string>> {
  const pool = new SimplePool();
  try {
    const ev = await withTimeout(
      pool.get(relays, { kinds: [3], authors: [pubkey] }),
      timeoutMs,
      null,
    );
    const set = new Set<string>();
    if (ev) {
      for (const tag of ev.tags) {
        if (tag[0] === "p" && tag[1]) set.add(tag[1]);
      }
    }
    return set;
  } catch {
    return new Set();
  } finally {
    pool.close(relays);
  }
}

export interface PublishResult {
  ok: number;
  failed: number;
}

export async function publishEvent(
  relays: string[],
  ev: Event,
): Promise<PublishResult> {
  const pool = new SimplePool();
  try {
    const settled = await Promise.allSettled(pool.publish(relays, ev));
    return {
      ok: settled.filter((r) => r.status === "fulfilled").length,
      failed: settled.filter((r) => r.status === "rejected").length,
    };
  } finally {
    pool.close(relays);
  }
}
