// Credibility attestation = a Nostr parameterized-replaceable event.
//
//   kind:   30909 (custom, in the 30000-39999 replaceable range)
//   tags:   ["d", <urlAddress>]  parameterized key → one current attestation
//                                 per (author, url), older ones are replaced
//           ["r", <normalizedUrl>]  the article addressed
//           ["t", <domain>]         for source-level aggregation
//   content: JSON AttestationContent (a compact view of the Assessment)
//
// The event itself is schnorr-signed (NIP-01); anyone can verify it offline.

import { finalizeEvent, verifyEvent, type Event } from "nostr-tools";
import { hexToBytes, sha256Hex } from "../canonical";
import type { Assessment } from "../types";

export const ATTESTATION_KIND = 30909;
export const CONTENT_SCHEMA = "nsm-attestation.v1";

export interface AttestationContent {
  schema: string;
  url: string;
  domain: string;
  score: number;
  reputation: { label: string; weight: number };
  llm: { score: number | null; consistency: string; model: string | null };
  summary: string;
}

/** Replaceable-event "d" tag: a short hash of the normalized URL. */
export async function urlAddress(normalizedUrl: string): Promise<string> {
  return (await sha256Hex(normalizedUrl)).slice(0, 32);
}

function contentOf(a: Assessment): AttestationContent {
  return {
    schema: CONTENT_SCHEMA,
    url: a.url,
    domain: a.domain,
    score: a.score,
    reputation: { label: a.signals.reputation.label, weight: a.signals.reputation.weight },
    llm: {
      score: a.llm_used ? a.signals.llm.score : null,
      consistency: a.signals.llm.consistency,
      model: a.signals.llm.model,
    },
    summary: a.signals.llm.summary,
  };
}

export async function buildAttestation(a: Assessment, skHex: string): Promise<Event> {
  const d = await urlAddress(a.url);
  const template = {
    kind: ATTESTATION_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", d],
      ["r", a.url],
      ["t", a.domain],
    ],
    content: JSON.stringify(contentOf(a)),
  };
  return finalizeEvent(template, hexToBytes(skHex));
}

export interface ParsedAttestation {
  pubkey: string;
  created_at: number;
  url: string;
  domain: string;
  score: number;
  content: AttestationContent;
}

/** Verify signature + schema, then project into a ParsedAttestation. */
export function parseAttestation(ev: Event): ParsedAttestation | null {
  if (ev.kind !== ATTESTATION_KIND) return null;
  if (!verifyEvent(ev)) return null;
  let content: AttestationContent;
  try {
    content = JSON.parse(ev.content) as AttestationContent;
  } catch {
    return null;
  }
  if (content.schema !== CONTENT_SCHEMA) return null;
  if (typeof content.score !== "number" || !Number.isFinite(content.score)) return null;
  return {
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    url: content.url,
    domain: content.domain,
    score: Math.max(0, Math.min(100, content.score)),
    content,
  };
}
