// Who counts as a trusted witness: your local trust list, plus (optionally)
// the public follow list of your own Nostr key. Nothing here publishes.

import { identityFromSk } from "../lib/nostr/keys";
import { queryFollows } from "../lib/nostr/relay";
import { getArchiveSettings, getNostrSk, getRelays, getTrustList, setTrustList } from "../lib/storage";
import {
  importTrust,
  labelsOf,
  npubOf,
  parsePubkey,
  removeTrust,
  trustedSet,
  upsertTrust,
  type TrustEntry,
} from "../lib/trustlist";

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

async function selfPubkey(): Promise<string | null> {
  const sk = await getNostrSk();
  return sk ? identityFromSk(sk).pubkey : null;
}

export interface TrustContext {
  self: string | null;
  trusted: Set<string>;
  labels: Record<string, string>;
}

export async function getTrustContext(relays?: string[]): Promise<TrustContext> {
  const [list, settings, self] = await Promise.all([getTrustList(), getArchiveSettings(), selfPubkey()]);
  let follows = new Set<string>();
  if (settings.use_public_follows && self) {
    follows = await queryFollows(relays ?? (await getRelays()), self);
  }
  return { self, trusted: trustedSet(list, follows, settings.use_public_follows), labels: labelsOf(list) };
}

export async function addTrust(input: string, label: string): Promise<TrustEntry[]> {
  const pk = parsePubkey(input);
  if (pk === (await selfPubkey())) throw new Error("这是你自己的公钥");
  const list = upsertTrust(await getTrustList(), pk, label, "manual", nowIso());
  await setTrustList(list);
  return list;
}

export async function dropTrust(pubkey: string): Promise<TrustEntry[]> {
  const list = removeTrust(await getTrustList(), pubkey);
  await setTrustList(list);
  return list;
}

/** Read someone's public follow list once and add those keys locally. */
export async function importFollowsOf(input: string): Promise<{ list: TrustEntry[]; added: number; found: number }> {
  const pk = parsePubkey(input);
  const follows = await queryFollows(await getRelays(), pk, 8000);
  if (follows.size === 0) throw new Error("在你的中继上没有找到这个人的公开关注列表");
  const r = importTrust(await getTrustList(), follows, `import:${npubOf(pk)}`, nowIso(), await selfPubkey());
  await setTrustList(r.list);
  return { list: r.list, added: r.added, found: follows.size };
}
