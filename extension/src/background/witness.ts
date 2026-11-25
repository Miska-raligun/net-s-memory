// Background handlers for step 3 (aggregating other people's witnesses) and
// step 4 (deletion observations + periodic re-checks of archived URLs).

import { nip19 } from "nostr-tools";
import { CAPTURE_SCHEMA, type Capture } from "../lib/archive/capture";
import { CAPTURE_KIND, parseCaptureEvent, type ParsedCapture } from "../lib/archive/event";
import {
  OBSERVATION_KIND,
  buildObservationEvent,
  parseObservationEvent,
  type ObservationMethod,
  type ParsedObservation,
} from "../lib/archive/observation";
import { aggregateWitnesses } from "../lib/archive/witness";
import {
  applyObservation,
  dueEntries,
  newWatch,
  recheckSupported,
  recheckUrl,
  type WatchEntry,
} from "../lib/archive/recheck";
import { fetchVerifiedBlob } from "../lib/archive/blossom";
import { isGone, platformOf, type PageState, type Platform } from "../lib/archive/detect";
import { normalizeText } from "../lib/archive/normalize";
import { sha256Hex } from "../lib/canonical";
import { identityFromSk, createIdentity } from "../lib/nostr/keys";
import { publishEvent, queryById, queryByUrl } from "../lib/nostr/relay";
import { getTrustContext } from "./trust";
import { normalizeUrl } from "../lib/url";
import {
  getArchiveSettings,
  getNostrSk,
  getRelays,
  getWatch,
  listCaptures,
  listWatches,
  putCapture,
  putWatch,
  setNostrSk,
} from "../lib/storage";
import type { PublishOutcome, WitnessView } from "../lib/messages";

const RECHECK_BATCH = 10;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

// ---- toolbar badge --------------------------------------------------------

export async function refreshBadge(): Promise<number> {
  const n = (await listWatches()).filter((w) => w.unseen_gone).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#e5534b" });
  await chrome.action.setBadgeText({ text: n > 0 ? String(n) : "" });
  return n;
}

export async function ackGone(): Promise<void> {
  for (const w of await listWatches()) {
    if (w.unseen_gone) {
      w.unseen_gone = false;
      await putWatch(w);
    }
  }
  await refreshBadge();
}

// ---- watch list -----------------------------------------------------------

/** Called after every local capture so the URL gets watched. */
export async function watchCapture(c: Capture): Promise<void> {
  if (c.witness_of) return; // imported copies say nothing about what we saw
  const existing = await getWatch(c.url);
  if (!existing) {
    const w = newWatch(c.url, c.captured_at, c.text_sha256, c.page_state);
    if (isGone(c.page_state)) applyObservation(w, { at: c.captured_at, state: c.page_state, evidence: c.page_evidence, method: "visit" });
    await putWatch(w);
  } else {
    if (!isGone(c.page_state)) existing.last_text_sha256 = c.text_sha256;
    applyObservation(existing, { at: c.captured_at, state: c.page_state, evidence: c.page_evidence, method: "visit" });
    await putWatch(existing);
  }
  await refreshBadge();
}

/** The content script reports what it saw on a page we are watching. */
export async function reportVisit(url: string, state: PageState, evidence: string | null): Promise<WatchEntry | null> {
  const w = await getWatch(normalizeUrl(url));
  if (!w) return null;
  const newlyGone = applyObservation(w, { at: nowIso(), state, evidence, method: "visit" });
  // The user is looking at the deletion right now; no need to badge it.
  if (newlyGone) w.unseen_gone = false;
  await putWatch(w);
  await refreshBadge();
  return w;
}

export interface RecheckReport {
  checked: number;
  inconclusive: number;
  newly_gone: string[];
}

/** Re-fetch due (or, with `all`, every supported live) watched URLs. */
export async function runRecheck(all = false, fetchImpl: typeof fetch = fetch): Promise<RecheckReport> {
  const watches = await listWatches();
  const targets = all
    ? watches.filter((w) => w.state === "live" && recheckSupported(w.url)).slice(0, RECHECK_BATCH * 2)
    : dueEntries(watches, nowIso(), RECHECK_BATCH);
  const report: RecheckReport = { checked: 0, inconclusive: 0, newly_gone: [] };
  for (const w of targets) {
    const r = await recheckUrl(w.url, fetchImpl);
    if (!r) {
      report.inconclusive++;
      continue; // keep next_check_at; try again on the next alarm
    }
    report.checked++;
    if (applyObservation(w, { at: nowIso(), state: r.state, evidence: r.evidence, method: "recheck" })) {
      report.newly_gone.push(w.url);
    }
    await putWatch(w);
  }
  await refreshBadge();
  return report;
}

// ---- witnesses from relays --------------------------------------------------

export async function queryWitnesses(rawUrl: string): Promise<WitnessView> {
  const url = normalizeUrl(rawUrl);
  const relays = await getRelays();
  const [events, who, local] = await Promise.all([
    queryByUrl(relays, url, [CAPTURE_KIND, OBSERVATION_KIND]),
    getTrustContext(relays),
    listCaptures(url),
  ]);
  const captures: ParsedCapture[] = [];
  const observations: ParsedObservation[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    if (ev.kind === CAPTURE_KIND) {
      const p = await parseCaptureEvent(ev);
      if (p && p.content.url === url) captures.push(p);
    } else {
      const p = parseObservationEvent(ev);
      if (p && p.content.url === url) observations.push(p);
    }
  }
  const summary = aggregateWitnesses(captures, observations, {
    follows: who.trusted,
    self: who.self,
    localHashes: new Set(local.map((c) => c.text_sha256)),
  });
  const shown = new Set([...summary.versions.flatMap((v) => v.witnesses), ...(summary.gone?.observers ?? [])]);
  const trusted_keys = [...shown].filter((k) => who.trusted.has(k));
  const labels: Record<string, string> = {};
  for (const k of shown) if (who.labels[k]) labels[k] = who.labels[k];
  return { ...summary, relays: relays.length, trusted_keys, labels, self: who.self };
}

/** Re-fetch the event by id, re-verify it, and keep it as a local copy. */
export async function importWitness(eventId: string): Promise<Capture> {
  const relays = await getRelays();
  const ev = await queryById(relays, eventId);
  if (!ev) throw new Error("中继上找不到这条见证");
  const p = await parseCaptureEvent(ev);
  if (!p) throw new Error("见证事件校验失败，未导入");
  let text = p.content.text;
  if (text === undefined) {
    const blob = p.content.blobs.find((b) => b.kind === "text" && b.sha256 === p.content.text_sha256);
    const bytes = blob ? await fetchVerifiedBlob(blob.urls, blob.sha256) : null;
    if (!bytes) throw new Error("取不到与哈希一致的正文副本");
    text = new TextDecoder().decode(bytes);
    if (normalizeText(text) !== text || (await sha256Hex(text)) !== p.content.text_sha256) {
      throw new Error("正文副本与哈希不一致，未导入");
    }
  }
  const c: Capture = {
    schema: CAPTURE_SCHEMA,
    id: `w-${p.event_id.slice(0, 16)}`,
    url: p.content.url,
    original_url: p.content.url,
    domain: new URL(p.content.url).hostname.replace(/^www\./, ""),
    platform: p.content.platform,
    title: p.content.title,
    text,
    text_norm: p.content.text_norm,
    text_sha256: p.content.text_sha256,
    page_state: p.content.page_state,
    page_evidence: p.content.page_evidence,
    captured_at: p.content.captured_at,
    blobs: p.content.blobs.map((b) => ({ ...b })),
    ots_b64: p.content.ots_b64,
    wayback_url: p.content.wayback_url ?? null,
    witness_of: {
      pubkey: p.pubkey,
      npub: nip19.npubEncode(p.pubkey),
      event_id: p.event_id,
      created_at: p.created_at,
    },
  };
  await putCapture(c);
  return c;
}

// ---- publishing observations ---------------------------------------------------

async function ensureSk(): Promise<string> {
  let sk = await getNostrSk();
  if (!sk) {
    sk = createIdentity().skHex;
    await setNostrSk(sk);
  }
  return sk;
}

export async function publishObservation(input: {
  url: string;
  state: PageState;
  evidence: string | null;
  http_status: number | null;
  method?: ObservationMethod;
}): Promise<PublishOutcome> {
  const url = normalizeUrl(input.url);
  const watch = await getWatch(url);
  const sk = await ensureSk();
  const ev = buildObservationEvent(
    {
      url,
      platform: platformOf(url) as Platform,
      page_state: input.state,
      evidence: input.evidence,
      http_status: input.http_status,
      observed_at: nowIso(),
      method: input.method ?? "visit",
      last_seen_text_sha256: watch?.last_text_sha256,
    },
    sk,
  );
  const result = await publishEvent(await getRelays(), ev);
  if (result.ok === 0) throw new Error(`所有中继都发布失败（${result.failed} 个）`);
  return { npub: identityFromSk(sk).npub, relays_ok: result.ok, relays_failed: result.failed };
}

// ---- alarm --------------------------------------------------------------------

export const RECHECK_ALARM = "nsm-recheck";

export async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(RECHECK_ALARM);
  if (!existing) await chrome.alarms.create(RECHECK_ALARM, { periodInMinutes: 60, delayInMinutes: 1 });
}

export async function onAlarm(name: string): Promise<void> {
  if (name !== RECHECK_ALARM) return;
  if (!(await getArchiveSettings()).recheck) return;
  await runRecheck(false);
}
