// Typed message protocol between content script / popup and the background
// service worker. chrome.runtime.sendMessage is untyped, so we wrap it.

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
  | { type: "CHECK_ANCHOR"; url: string };

export type Response =
  | { ok: true; assessment: Assessment; cached: boolean }
  | { ok: true; assessment: null }
  | { ok: true; published: PublishOutcome }
  | { ok: true; anchor: AnchorOutcome }
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

export function sendMessage(req: Request): Promise<Response> {
  return chrome.runtime.sendMessage(req) as Promise<Response>;
}
