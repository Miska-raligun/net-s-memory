// Observation event: a signed statement "at time T, this URL was in state S"
// (typically: deleted / censored). Observations are what turn scattered
// captures into a public record of *when* something disappeared.
//
//   kind:    OBSERVATION_KIND (regular event; every observation is kept)
//   tags:    ["r", <normalized url>]
//            ["s", <page_state>]
//            ["x", <text_sha256>]   optional: the last text version the
//                                   observer had seen live, linking the
//                                   deletion to a specific witnessed version
//            ["alt", ...]
//   content: JSON ObservationContent

import { finalizeEvent, verifyEvent, type Event } from "nostr-tools";
import { hexToBytes } from "../canonical";
import { normalizeUrl } from "../url";
import type { PageState, Platform } from "./detect";
import { STATE_LABEL } from "./detect";

export const OBSERVATION_KIND = 1910;
export const OBSERVATION_SCHEMA = "nsm-observation.v1";

export type ObservationMethod = "visit" | "recheck";

export interface ObservationContent {
  schema: typeof OBSERVATION_SCHEMA;
  url: string;
  platform: Platform;
  page_state: PageState;
  evidence: string | null;
  http_status: number | null;
  observed_at: string;
  /** How it was observed: the user visiting, or a background re-check. */
  method: ObservationMethod;
  last_seen_text_sha256?: string;
}

const STATES: PageState[] = ["live", "deleted", "censored", "restricted", "not_found"];

export function buildObservationEvent(
  obs: Omit<ObservationContent, "schema" | "url"> & { url: string },
  skHex: string,
  now: Date = new Date(),
): Event {
  const content: ObservationContent = { ...obs, schema: OBSERVATION_SCHEMA, url: normalizeUrl(obs.url) };
  if (!content.last_seen_text_sha256) delete content.last_seen_text_sha256;
  const tags = [
    ["r", content.url],
    ["s", content.page_state],
    ["alt", `互联网记忆观察：${STATE_LABEL[content.page_state]} ${content.url}`.slice(0, 200)],
  ];
  if (content.last_seen_text_sha256) tags.push(["x", content.last_seen_text_sha256]);
  return finalizeEvent(
    {
      kind: OBSERVATION_KIND,
      created_at: Math.floor(now.getTime() / 1000),
      tags,
      content: JSON.stringify(content),
    },
    hexToBytes(skHex),
  );
}

export interface ParsedObservation {
  event_id: string;
  pubkey: string;
  created_at: number;
  content: ObservationContent;
}

function tag(ev: Event, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}

export function parseObservationEvent(ev: Event): ParsedObservation | null {
  if (ev.kind !== OBSERVATION_KIND || !verifyEvent(ev)) return null;
  let c: ObservationContent;
  try {
    c = JSON.parse(ev.content) as ObservationContent;
  } catch {
    return null;
  }
  if (c.schema !== OBSERVATION_SCHEMA || !STATES.includes(c.page_state)) return null;
  if (tag(ev, "r") !== c.url || tag(ev, "s") !== c.page_state) return null;
  if (c.last_seen_text_sha256 !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(c.last_seen_text_sha256) || tag(ev, "x") !== c.last_seen_text_sha256) return null;
  }
  // An observation claiming to be from the future is not credible.
  const observed = Date.parse(c.observed_at);
  if (!Number.isFinite(observed) || observed > (ev.created_at + 600) * 1000) return null;
  return { event_id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, content: c };
}
