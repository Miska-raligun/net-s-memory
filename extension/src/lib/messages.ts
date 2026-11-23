// Typed message protocol between content script / popup / extension pages
// and the background service worker. chrome.runtime.sendMessage is untyped,
// so we wrap it.

import type { Capture, CaptureInput } from "./archive/capture";
import type { CaptureSummary } from "./storage";
import type { Engine, SearchHit } from "./search/serp";
import type { Assessment } from "./types";

export interface PageInfo {
  url: string;
  title: string;
  text: string;
}

export type Request =
  | { type: "ASSESS"; page: PageInfo; force?: boolean }
  | { type: "GET_CACHED"; url: string }
  | { type: "PUBLISH"; url: string }
  | { type: "STAMP"; url: string }
  | { type: "CHECK_ANCHOR"; url: string }
  // --- archive ---
  | { type: "CAPTURE"; input: CaptureInput; html: string | null }
  | { type: "CAPTURE_EXTRAS"; id: string }
  | { type: "LIST_CAPTURES"; url?: string }
  | { type: "GET_CAPTURE"; id: string }
  | { type: "DELETE_CAPTURE"; id: string }
  | { type: "PUBLISH_CAPTURE"; id: string }
  | { type: "REFRESH_CAPTURE_ANCHOR"; id: string }
  | { type: "OPEN_ARCHIVE"; id?: string }
  // --- search (Google / Bing in the user's own browser) ---
  | { type: "SEARCH"; query: string; excludeUrl?: string };

export type Response =
  | { ok: true; assessment: Assessment; cached: boolean }
  | { ok: true; assessment: null }
  | { ok: true; published: PublishOutcome }
  | { ok: true; anchor: AnchorOutcome }
  | { ok: true; capture: Capture; anchor?: AnchorOutcome; published?: PublishOutcome; warnings?: string[] }
  | { ok: true; captures: CaptureSummary[] }
  | { ok: true; search: SearchOutcome }
  | { ok: true; done: true }
  | { ok: false; error: string };

export interface PublishOutcome {
  npub: string;
  relays_ok: number;
  relays_failed: number;
}

export interface AnchorOutcome {
  has_proof: boolean;
  pending: string[];
  bitcoin_height: number | null;
  complete: boolean;
}

export interface SearchOutcome {
  engine: Engine;
  query: string;
  search_url: string;
  hits: SearchHit[];
  hidden_domestic: number;
}

/** Background → SERP content script. */
export interface SerpExtractRequest {
  type: "SERP_EXTRACT";
}

export interface SerpExtractResponse {
  engine: Engine | null;
  hits: SearchHit[];
  blocked: boolean;
}

export function sendMessage(req: Request): Promise<Response> {
  return chrome.runtime.sendMessage(req) as Promise<Response>;
}
