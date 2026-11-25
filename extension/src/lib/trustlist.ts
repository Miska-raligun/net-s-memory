// Local trust list: the witnesses *you* vouch for.
//
// Trust only matters for weighting on your own machine, so the list is kept
// in chrome.storage.local and never published. (A public NIP-02 follow list
// would reveal your social graph and tie a pseudonymous witness key back to
// you.) Optionally the public follow list of your own key is merged in, and
// another person's public follow list can be imported once, read-only.

import { nip19 } from "nostr-tools";

export interface TrustEntry {
  /** hex pubkey */
  pubkey: string;
  /** your own note, e.g. "老王（调查记者）" */
  label: string;
  added_at: string;
  /** "manual", or "import:<npub>" when bulk-imported from someone's follow list */
  source: string;
}

export const LABEL_MAX = 40;

/** Accept an npub, an nprofile, or 64-char hex. Returns the hex pubkey. */
export function parsePubkey(input: string): string {
  const s = input.trim().replace(/^nostr:/, "");
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(s);
  } catch {
    throw new Error("不是有效的 npub / 公钥");
  }
  if (decoded.type === "npub") return decoded.data as string;
  if (decoded.type === "nprofile") return (decoded.data as { pubkey: string }).pubkey;
  if (decoded.type === "nsec") throw new Error("这是私钥（nsec），请不要粘贴到这里；这里需要对方的 npub");
  throw new Error("不是有效的 npub / 公钥");
}

export function npubOf(pubkey: string): string {
  return nip19.npubEncode(pubkey);
}

export function shortNpub(pubkey: string): string {
  const n = npubOf(pubkey);
  return `${n.slice(0, 12)}…${n.slice(-4)}`;
}

/** Add or relabel. Manual adds always win over earlier imports. */
export function upsertTrust(
  list: TrustEntry[],
  pubkey: string,
  label: string,
  source: string,
  now: string,
): TrustEntry[] {
  const clean = label.trim().slice(0, LABEL_MAX);
  const existing = list.find((e) => e.pubkey === pubkey);
  if (existing) {
    return list.map((e) =>
      e.pubkey === pubkey
        ? {
            ...e,
            label: clean || e.label,
            source: source === "manual" ? "manual" : e.source,
          }
        : e,
    );
  }
  return [...list, { pubkey, label: clean, added_at: now, source }];
}

export function removeTrust(list: TrustEntry[], pubkey: string): TrustEntry[] {
  return list.filter((e) => e.pubkey !== pubkey);
}

/** Bulk import (e.g. someone's follow list): adds new keys only, keeps labels. */
export function importTrust(
  list: TrustEntry[],
  pubkeys: Iterable<string>,
  source: string,
  now: string,
  self: string | null,
): { list: TrustEntry[]; added: number } {
  const have = new Set(list.map((e) => e.pubkey));
  const out = [...list];
  let added = 0;
  for (const pk of pubkeys) {
    if (!/^[0-9a-f]{64}$/.test(pk) || have.has(pk) || pk === self) continue;
    have.add(pk);
    out.push({ pubkey: pk, label: "", added_at: now, source });
    added++;
  }
  return { list: out, added };
}

/** The set used for weighting: local list ∪ (optionally) your public follows. */
export function trustedSet(
  list: TrustEntry[],
  publicFollows: Set<string>,
  usePublicFollows: boolean,
): Set<string> {
  const s = new Set(list.map((e) => e.pubkey));
  if (usePublicFollows) for (const pk of publicFollows) s.add(pk);
  return s;
}

export function labelsOf(list: TrustEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of list) if (e.label) out[e.pubkey] = e.label;
  return out;
}
