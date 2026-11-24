// A Capture is one person's local copy of a page at one moment: the
// normalized article text (the evidence everyone can compare), plus optional
// supporting artifacts (raw HTML, a screenshot) referenced by sha256.
//
// Captures live only in the browser until the user explicitly publishes a
// witness event for one (see ./event.ts).

import { sha256Hex } from "../canonical";
import { extractDomain, normalizeUrl } from "../url";
import type { PageState, Platform } from "./detect";
import { NORMALIZATION_ID, normalizeText } from "./normalize";

export const CAPTURE_SCHEMA = "nsm-capture.v1";

export type BlobKind = "text" | "html" | "screenshot";

export interface BlobRef {
  kind: BlobKind;
  sha256: string;
  size: number;
  mime: string;
  /** Where the blob can be fetched (Blossom servers). Empty = local only. */
  urls: string[];
}

export interface PublishRecord {
  event_id: string;
  npub: string;
  at: string;
  relays_ok: number;
  relays_failed: number;
}

export interface Capture {
  schema: typeof CAPTURE_SCHEMA;
  id: string;
  url: string;
  original_url: string;
  domain: string;
  platform: Platform;
  title: string;
  text: string;
  text_norm: string;
  text_sha256: string;
  page_state: PageState;
  page_evidence: string | null;
  captured_at: string;
  blobs: BlobRef[];
  ots_b64?: string;
  wayback_url?: string | null;
  published?: PublishRecord[];
  /** Set when this copy was imported from someone else's witness event. */
  witness_of?: { pubkey: string; npub: string; event_id: string; created_at: number };
}

/** What the content script hands to the background worker. */
export interface CaptureInput {
  url: string;
  title: string;
  text: string;
  page_state: PageState;
  page_evidence: string | null;
  platform: Platform;
}

export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

export async function buildCapture(input: CaptureInput, now: Date = new Date()): Promise<Capture> {
  const url = normalizeUrl(input.url);
  const text = normalizeText(input.text);
  const textHash = await sha256Hex(text);
  const capturedAt = isoSeconds(now);
  return {
    schema: CAPTURE_SCHEMA,
    id: `${capturedAt.replace(/[-:]/g, "")}-${textHash.slice(0, 12)}`,
    url,
    original_url: input.url,
    domain: extractDomain(url) ?? "",
    platform: input.platform,
    title: normalizeText(input.title).replace(/\n/g, " "),
    text,
    text_norm: NORMALIZATION_ID,
    text_sha256: textHash,
    page_state: input.page_state,
    page_evidence: input.page_evidence,
    captured_at: capturedAt,
    blobs: [],
  };
}

export function hexDigestToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
