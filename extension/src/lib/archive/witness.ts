// Aggregate everyone's witness events and observations for one URL into
// something a reader can act on:
//
//   - text versions, each with its distinct witnesses (one vote per pubkey),
//     trusted witnesses (people you follow) counted separately
//   - whether your own local copy matches a version
//   - the earliest / latest time each version was seen
//   - deletion observations: who saw it gone, and since when
//
// Numbers are counts of distinct keys, not a "truth score". Keys are free to
// create, so trusted (followed) witnesses and agreement with your own copy
// matter more than raw totals; the UI says so.

import type { ParsedCapture } from "./event";
import type { ParsedObservation } from "./observation";
import { isGone, type PageState } from "./detect";

export interface TextVersion {
  text_sha256: string;
  witnesses: string[];
  trusted: number;
  first_captured_at: string;
  last_captured_at: string;
  /** Most useful event to read the text from (inline + verified first). */
  best: ParsedCapture;
  has_text: boolean;
  has_ots: boolean;
  wayback_url: string | null;
  matches_local: boolean;
  includes_self: boolean;
}

export interface GoneSummary {
  observers: string[];
  trusted: number;
  earliest: string;
  latest: string;
  states: PageState[];
}

export interface WitnessSummary {
  versions: TextVersion[];
  total_witnesses: number;
  gone: GoneSummary | null;
  /** Latest "live" observation, if any observer saw it online after a gone report. */
  last_seen_live: string | null;
}

export interface AggregateOptions {
  follows: Set<string>;
  self: string | null;
  localHashes: Set<string>;
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}
function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}

function better(a: ParsedCapture, b: ParsedCapture): ParsedCapture {
  // prefer verified inline text, then a text blob, then earliest capture
  const score = (p: ParsedCapture) =>
    (p.text_verified ? 4 : 0) + (p.content.blobs.some((x) => x.kind === "text") ? 2 : 0) + (p.content.ots_b64 ? 1 : 0);
  if (score(a) !== score(b)) return score(a) > score(b) ? a : b;
  return a.content.captured_at <= b.content.captured_at ? a : b;
}

export function aggregateWitnesses(
  captures: ParsedCapture[],
  observations: ParsedObservation[],
  opts: AggregateOptions,
): WitnessSummary {
  const byHash = new Map<string, { caps: ParsedCapture[]; keys: Set<string> }>();
  for (const c of captures) {
    // Captures recorded on a deletion page carry no article text worth comparing.
    if (isGone(c.content.page_state)) continue;
    const h = c.content.text_sha256;
    const g = byHash.get(h) ?? { caps: [], keys: new Set<string>() };
    g.caps.push(c);
    g.keys.add(c.pubkey);
    byHash.set(h, g);
  }

  const versions: TextVersion[] = [];
  for (const [hash, g] of byHash) {
    let best = g.caps[0];
    let first = g.caps[0].content.captured_at;
    let last = first;
    let wayback: string | null = null;
    for (const c of g.caps) {
      best = better(best, c);
      first = minIso(first, c.content.captured_at);
      last = maxIso(last, c.content.captured_at);
      wayback = wayback ?? c.content.wayback_url ?? null;
    }
    const witnesses = [...g.keys];
    versions.push({
      text_sha256: hash,
      witnesses,
      trusted: witnesses.filter((k) => opts.follows.has(k)).length,
      first_captured_at: first,
      last_captured_at: last,
      best,
      has_text: g.caps.some((c) => c.text_verified || c.content.blobs.some((b) => b.kind === "text")),
      has_ots: g.caps.some((c) => Boolean(c.content.ots_b64)),
      wayback_url: wayback,
      matches_local: opts.localHashes.has(hash),
      includes_self: opts.self !== null && g.keys.has(opts.self),
    });
  }
  versions.sort(
    (a, b) =>
      Number(b.matches_local) - Number(a.matches_local) ||
      b.trusted - a.trusted ||
      b.witnesses.length - a.witnesses.length ||
      (a.first_captured_at < b.first_captured_at ? -1 : 1),
  );

  // Observations: one latest observation per key decides that key's view.
  const latestByKey = new Map<string, ParsedObservation>();
  for (const o of observations) {
    const prev = latestByKey.get(o.pubkey);
    if (!prev || o.content.observed_at > prev.content.observed_at) latestByKey.set(o.pubkey, o);
  }
  const goneObs = [...latestByKey.values()].filter((o) => isGone(o.content.page_state));
  const liveObs = [...latestByKey.values()].filter((o) => !isGone(o.content.page_state));
  let gone: GoneSummary | null = null;
  if (goneObs.length > 0) {
    const times = goneObs.map((o) => o.content.observed_at).sort();
    gone = {
      observers: goneObs.map((o) => o.pubkey),
      trusted: goneObs.filter((o) => opts.follows.has(o.pubkey)).length,
      earliest: times[0],
      latest: times[times.length - 1],
      states: [...new Set(goneObs.map((o) => o.content.page_state))],
    };
  }
  const lastLive = liveObs.map((o) => o.content.observed_at).sort().pop() ?? null;

  const allKeys = new Set(captures.filter((c) => !isGone(c.content.page_state)).map((c) => c.pubkey));
  return { versions, total_witnesses: allKeys.size, gone, last_seen_live: lastLive };
}
