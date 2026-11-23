// Witness event: a signed, public statement "I saw this exact text at this
// URL at this time". Many independent witnesses converging on the same
// text_sha256 is what makes a capture credible without any central server.
//
//   kind:    CAPTURE_KIND (regular event — every capture is kept, so the
//            history of a page across time and witnesses is preserved)
//   tags:    ["r", <normalized url>]   query all witnesses of a page
//            ["x", <text_sha256>]      query all witnesses of a text version
//            ["t", <domain>]
//            ["alt", <human-readable>] NIP-31 fallback for other clients
//   content: JSON CaptureContent. The normalized text is inlined when small
//            enough for relays; otherwise it is referenced as a Blossom blob.

import { finalizeEvent, verifyEvent, type Event } from "nostr-tools";
import { hexToBytes, sha256Hex } from "../canonical";
import type { BlobRef, Capture } from "./capture";
import { CAPTURE_SCHEMA } from "./capture";
import type { PageState, Platform } from "./detect";
import { NORMALIZATION_ID, normalizeText, utf8Length } from "./normalize";

export const CAPTURE_KIND = 1909;

/** Most public relays accept events well above this; stay conservative. */
export const INLINE_TEXT_MAX_BYTES = 32 * 1024;

export interface WireBlob {
  kind: BlobRef["kind"];
  sha256: string;
  size: number;
  mime: string;
  urls: string[];
}

export interface CaptureContent {
  schema: typeof CAPTURE_SCHEMA;
  url: string;
  title: string;
  platform: Platform;
  page_state: PageState;
  page_evidence: string | null;
  captured_at: string;
  text_norm: string;
  text_sha256: string;
  text_chars: number;
  /** Present when the text fits inline; otherwise see blobs[kind=text]. */
  text?: string;
  blobs: WireBlob[];
  wayback_url?: string;
  /** base64 OpenTimestamps proof over the raw 32-byte text_sha256 digest. */
  ots_b64?: string;
}

export function canInlineText(text: string): boolean {
  return utf8Length(text) <= INLINE_TEXT_MAX_BYTES;
}

export function contentOf(c: Capture): CaptureContent {
  const content: CaptureContent = {
    schema: CAPTURE_SCHEMA,
    url: c.url,
    title: c.title,
    platform: c.platform,
    page_state: c.page_state,
    page_evidence: c.page_evidence,
    captured_at: c.captured_at,
    text_norm: c.text_norm,
    text_sha256: c.text_sha256,
    text_chars: [...c.text].length,
    blobs: c.blobs
      .filter((b) => b.urls.length > 0)
      .map((b) => ({ kind: b.kind, sha256: b.sha256, size: b.size, mime: b.mime, urls: b.urls })),
  };
  if (canInlineText(c.text)) content.text = c.text;
  if (c.wayback_url) content.wayback_url = c.wayback_url;
  if (c.ots_b64) content.ots_b64 = c.ots_b64;
  return content;
}

export function buildCaptureEvent(c: Capture, skHex: string, now: Date = new Date()): Event {
  const content = contentOf(c);
  if (content.text === undefined && !content.blobs.some((b) => b.kind === "text")) {
    throw new Error("正文过长，无法内联到事件中；请在设置里配置 Blossom 服务器后再发布");
  }
  const template = {
    kind: CAPTURE_KIND,
    created_at: Math.floor(now.getTime() / 1000),
    tags: [
      ["r", c.url],
      ["x", c.text_sha256],
      ["t", c.domain],
      ["alt", `互联网记忆存档：${c.title}`.slice(0, 200)],
    ],
    content: JSON.stringify(content),
  };
  return finalizeEvent(template, hexToBytes(skHex));
}

export interface ParsedCapture {
  event_id: string;
  pubkey: string;
  created_at: number;
  content: CaptureContent;
  /** true when the inline text was present and re-hashed successfully. */
  text_verified: boolean;
}

function tagValue(ev: Event, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}

/**
 * Verify signature, schema, tag/content agreement, and — if the text is
 * inline — that it is already normalized and hashes to text_sha256. Any
 * mismatch rejects the event outright.
 */
export async function parseCaptureEvent(ev: Event): Promise<ParsedCapture | null> {
  if (ev.kind !== CAPTURE_KIND || !verifyEvent(ev)) return null;
  let content: CaptureContent;
  try {
    content = JSON.parse(ev.content) as CaptureContent;
  } catch {
    return null;
  }
  if (content.schema !== CAPTURE_SCHEMA || content.text_norm !== NORMALIZATION_ID) return null;
  if (!/^[0-9a-f]{64}$/.test(content.text_sha256 ?? "")) return null;
  if (tagValue(ev, "x") !== content.text_sha256 || tagValue(ev, "r") !== content.url) return null;

  let textVerified = false;
  if (typeof content.text === "string") {
    if (normalizeText(content.text) !== content.text) return null;
    if ((await sha256Hex(content.text)) !== content.text_sha256) return null;
    textVerified = true;
  }
  return {
    event_id: ev.id,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    content,
    text_verified: textVerified,
  };
}
