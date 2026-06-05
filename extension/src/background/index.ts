// Background service worker: message router, assessment cache, and all
// network I/O (the user's LLM endpoint + Nostr relays). Keeping every fetch
// and websocket here means nothing is subject to a visited page's CSP.

import { assessPage } from "../lib/assess";
import {
  getCachedAssessment,
  getLlmConfig,
  getNostrSk,
  getOtsProof,
  getRelays,
  putCachedAssessment,
  putOtsProof,
} from "../lib/storage";
import { normalizeUrl } from "../lib/url";
import { identityFromSk } from "../lib/nostr/keys";
import {
  buildAttestation,
  commitmentDigest,
  parseAttestation,
  urlAddress,
  type ParsedAttestation,
} from "../lib/nostr/attestation";
import { publishEvent, queryAttestations, queryFollows } from "../lib/nostr/relay";
import { computeCommunitySignal } from "../lib/nostr/trust";
import { inspect, stamp, upgrade } from "../lib/ots/ots";
import type { CommunitySignal } from "../lib/types";
import type { Request, Response } from "../lib/messages";

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Pull community attestations for a URL from relays and weight them. */
async function fetchCommunitySignal(normalizedUrl: string): Promise<CommunitySignal> {
  try {
    const relays = await getRelays();
    const addr = await urlAddress(normalizedUrl);
    const events = await queryAttestations(relays, addr);
    const parsed = events
      .map(parseAttestation)
      .filter((p): p is ParsedAttestation => p !== null);

    const sk = await getNostrSk();
    let selfPubkey: string | null = null;
    let follows = new Set<string>();
    if (sk) {
      const id = identityFromSk(sk);
      selfPubkey = id.pubkey;
      follows = await queryFollows(relays, id.pubkey);
    }
    return computeCommunitySignal(parsed, follows, selfPubkey);
  } catch {
    return { count: 0, weighted_score: null };
  }
}

async function handle(msg: Request): Promise<Response> {
  if (msg.type === "GET_CACHED") {
    const cached = await getCachedAssessment(normalizeUrl(msg.url));
    return cached ? { ok: true, assessment: cached, cached: true } : { ok: true, assessment: null };
  }

  if (msg.type === "ASSESS") {
    const url = normalizeUrl(msg.page.url);
    if (!msg.force) {
      const cached = await getCachedAssessment(url);
      if (cached) return { ok: true, assessment: cached, cached: true };
    }
    const cfg = await getLlmConfig();
    const community = await fetchCommunitySignal(url);
    const assessment = await assessPage(msg.page, cfg, community);
    await putCachedAssessment(assessment);
    return { ok: true, assessment, cached: false };
  }

  if (msg.type === "PUBLISH") {
    const url = normalizeUrl(msg.url);
    const assessment = await getCachedAssessment(url);
    if (!assessment) return { ok: false, error: "请先评估这篇文章再背书" };

    let sk = await getNostrSk();
    if (!sk) {
      // Auto-create a Nostr identity on first endorsement.
      const { createIdentity } = await import("../lib/nostr/keys");
      const { setNostrSk } = await import("../lib/storage");
      const id = createIdentity();
      await setNostrSk(id.skHex);
      sk = id.skHex;
    }
    const id = identityFromSk(sk);
    const relays = await getRelays();
    const otsProof = await getOtsProof(url); // embed anchor proof if we have one
    const event = await buildAttestation(assessment, sk, otsProof ?? undefined);
    const result = await publishEvent(relays, event);
    return {
      ok: true,
      published: { npub: id.npub, relays_ok: result.ok, relays_failed: result.failed },
    };
  }

  if (msg.type === "STAMP") {
    const url = normalizeUrl(msg.url);
    const assessment = await getCachedAssessment(url);
    if (!assessment) return { ok: false, error: "请先评估这篇文章再锚定" };
    const digest = await commitmentDigest(assessment);
    const proof = await stamp(digest);
    if (!proof) return { ok: false, error: "所有日历服务器都没有响应，请稍后重试" };
    await putOtsProof(url, b64encode(proof));
    const status = inspect(proof);
    return {
      ok: true,
      anchor: {
        has_proof: true,
        pending: status.pending,
        bitcoin_height: status.bitcoinHeight,
        complete: status.complete,
      },
    };
  }

  if (msg.type === "CHECK_ANCHOR") {
    const url = normalizeUrl(msg.url);
    const stored = await getOtsProof(url);
    if (!stored) {
      return { ok: true, anchor: { has_proof: false, pending: [], bitcoin_height: null, complete: false } };
    }
    let proof = b64decode(stored);
    const upgraded = await upgrade(proof); // pending → Bitcoin, if anchored
    if (upgraded) {
      proof = upgraded;
      await putOtsProof(url, b64encode(proof));
    }
    const status = inspect(proof);
    return {
      ok: true,
      anchor: {
        has_proof: true,
        pending: status.pending,
        bitcoin_height: status.bitcoinHeight,
        complete: status.complete,
      },
    };
  }

  return { ok: false, error: "unknown message type" };
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e: unknown) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  return true; // keep the channel open for the async response
});
