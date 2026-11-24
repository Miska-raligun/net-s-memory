// Typed message protocol between content script / popup / extension pages
// and the background service worker. chrome.runtime.sendMessage is untyped,
// so we wrap it.

import type { Capture, CaptureInput } from "./archive/capture";
import type { CaptureSummary } from "./storage";
import type { Engine, SearchHit } from "./search/serp";
import type { Assessment } from "./types";
import type { PageState } from "./archive/detect";
import type { WitnessSummary } from "./archive/witness";
import type { WatchEntry } from "./archive/recheck";

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
  // --- witnesses & observations (steps 3–4) ---
  | { type: "QUERY_WITNESSES"; url: string }
  | { type: "IMPORT_WITNESS"; event_id: string }
  | { type: "REPORT_VISIT"; url: string; state: PageState; evidence: string | null }
  | { type: "PUBLISH_OBSERVATION"; url: string; state: PageState; evidence: string | null; http_status: number | null }
  | { type: "RECHECK_NOW" }
  | { type: "LIST_WATCHES" }
  | { type: "ACK_GONE" }
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
  | { ok: true; witnesses: WitnessSummary & { relays: number } }
  | { ok: true; watch: WatchEntry | null }
  | { ok: true; watches: WatchEntry[] }
  | { ok: true; recheck: RecheckReport }
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

export interface RecheckReport {
  checked: number;
  inconclusive: number;
  newly_gone: string[];
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
