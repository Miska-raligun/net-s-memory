// Truthfulness judgments: evidence collection, independence analysis,
// querying others' judgments, and publishing your own.

import type { Event } from "nostr-tools";
import { CAPTURE_KIND, parseCaptureEvent } from "../lib/archive/event";
import {
  JUDGMENT_KIND,
  aggregateJudgments,
  buildJudgmentEvent,
  parseJudgmentEvent,
  type EvidenceRef,
  type JudgmentSummary,
  type ParsedJudgment,
  type Relation,
  type Verdict,
} from "../lib/archive/judgment";
import { groupSameSource } from "../lib/archive/similarity";
import type { Capture } from "../lib/archive/capture";
import { identityFromSk } from "../lib/nostr/keys";
import { publishEvent } from "../lib/nostr/relay";
import { SimplePool } from "nostr-tools";
import {
  getCapture,
  getEvidence,
  getLlmConfig,
  getRelays,
  listCaptures,
  setEvidence,
  type EvidenceItem,
} from "../lib/storage";
import { runClaimChecklist, type ChecklistItem } from "../lib/llm";
import { captureExtras, ensureSk, publishCapture } from "./archive";
import { getTrustContext } from "./trust";
import { importWitness, watchCapture } from "./witness";
import type { PublishOutcome } from "../lib/messages";

const LOAD_TIMEOUT_MS = 25_000;

async function queryEvents(relays: string[], filter: Record<string, unknown>, timeoutMs = 6000): Promise<Event[]> {
  const pool = new SimplePool();
  try {
    return await Promise.race([
      pool.querySync(relays, filter as never),
      new Promise<Event[]>((r) => setTimeout(() => r([]), timeoutMs)),
    ]);
  } catch {
    return [];
  } finally {
    pool.close(relays);
  }
}

/** Find the local capture for a text version (prefer your own over imported copies). */
async function captureForHash(sha: string): Promise<Capture | null> {
  const list = (await listCaptures()).filter((c) => c.text_sha256 === sha);
  const caps = (await Promise.all(list.map((s) => getCapture(s.id)))).filter((c): c is Capture => !!c);
  return caps.find((c) => !c.witness_of) ?? caps[0] ?? null;
}

// ---- evidence ------------------------------------------------------------------

export interface EvidenceView {
  capture_id: string;
  relation: Relation;
  title: string;
  url: string;
  domain: string;
  text_sha256: string;
  imported: boolean;
  published: boolean;
  /** Same text (≥60% containment) as the page being judged: a repost, not independent. */
  same_as_target: boolean;
  /** Id of the same-source group among the evidence (items sharing it are one source). */
  group: number;
  group_size: number;
}

export interface EvidenceReport {
  items: EvidenceView[];
  /** Distinct sources among the evidence, excluding reposts of the target. */
  independent_sources: number;
}

export async function evidenceReport(targetSha: string): Promise<EvidenceReport> {
  const target = await captureForHash(targetSha);
  const stored = await getEvidence(targetSha);
  const caps = await Promise.all(stored.map((e) => getCapture(e.capture_id)));
  const live = stored
    .map((e, i) => ({ e, c: caps[i] }))
    .filter((x): x is { e: EvidenceItem; c: Capture } => !!x.c);

  const groups = groupSameSource([
    ...(target ? [{ id: "__target__", text: target.text }] : []),
    ...live.map((x) => ({ id: x.c.id, text: x.c.text })),
  ]);
  const groupOf = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((id) => groupOf.set(id, i)));
  const targetGroup = groupOf.get("__target__");

  const items: EvidenceView[] = live.map(({ e, c }) => {
    const g = groupOf.get(c.id) ?? -1;
    return {
      capture_id: c.id,
      relation: e.relation,
      title: c.title,
      url: c.url,
      domain: c.domain,
      text_sha256: c.text_sha256,
      imported: !!c.witness_of,
      published: !!c.witness_of || (c.published?.length ?? 0) > 0,
      same_as_target: targetGroup !== undefined && g === targetGroup,
      group: g,
      group_size: groups[g]?.filter((id) => id !== "__target__").length ?? 1,
    };
  });
  const independent = new Set(items.filter((i) => !i.same_as_target).map((i) => i.group)).size;
  return { items, independent_sources: independent };
}

export async function addEvidence(targetSha: string, captureId: string, relation: Relation = "context"): Promise<void> {
  const c = await getCapture(captureId);
  if (!c) throw new Error("找不到这份存档");
  if (c.text_sha256 === targetSha) throw new Error("不能用被判断的正文本身当证据");
  const list = await getEvidence(targetSha);
  if (list.some((e) => e.capture_id === captureId)) return;
  await setEvidence(targetSha, [...list, { capture_id: captureId, relation }]);
}

export async function updateEvidence(targetSha: string, captureId: string, relation: Relation | null): Promise<void> {
  const list = await getEvidence(targetSha);
  await setEvidence(
    targetSha,
    relation === null
      ? list.filter((e) => e.capture_id !== captureId)
      : list.map((e) => (e.capture_id === captureId ? { ...e, relation } : e)),
  );
}

function waitForComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("页面加载超时"));
    }, LOAD_TIMEOUT_MS);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // It may already be complete before the listener was attached.
    void chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") listener(tabId, { status: "complete" });
    });
  });
}

/**
 * Open a search result in a tab, archive it there (same pipeline as clicking
 * 存档本页 on that page), add it to the evidence for `targetSha`, then return
 * the user to the tab they were on.
 */
export async function openAndCapture(url: string, targetSha: string, returnTabId?: number): Promise<Capture> {
  if (!/^https?:\/\//.test(url)) throw new Error("只能存档网页链接");
  const tab = await chrome.tabs.create({ url, active: true }); // visible, so the screenshot works
  if (tab.id === undefined) throw new Error("无法打开标签页");
  await waitForComplete(tab.id);
  let capture: Capture | null = null;
  let lastErr = "页面没有响应存档请求";
  for (let i = 0; i < 12 && !capture; i++) {
    try {
      const res = (await chrome.tabs.sendMessage(tab.id, { type: "AUTO_CAPTURE" })) as
        | { ok: true; capture: Capture }
        | { ok: false; error: string }
        | undefined;
      if (res?.ok) capture = res.capture;
      else if (res && !res.ok) lastErr = res.error;
    } catch {
      // content script not ready yet
    }
    if (!capture) await new Promise((r) => setTimeout(r, 500));
  }
  if (returnTabId !== undefined) await chrome.tabs.update(returnTabId, { active: true }).catch(() => undefined);
  if (!capture) throw new Error(lastErr);
  await watchCapture(capture);
  await addEvidence(targetSha, capture.id, "context");
  void captureExtras(capture.id).catch(() => undefined); // OTS + Wayback in the background
  return capture;
}

/** Pull a piece of evidence someone else cited, by its text hash. */
export async function fetchEvidence(textSha: string): Promise<Capture> {
  const local = await captureForHash(textSha);
  if (local) return local;
  const events = await queryEvents(await getRelays(), { kinds: [CAPTURE_KIND], "#x": [textSha], limit: 20 });
  for (const ev of events) {
    const p = await parseCaptureEvent(ev);
    if (p && p.content.text_sha256 === textSha) {
      try {
        return await importWitness(ev.id);
      } catch {
        // try the next witness
      }
    }
  }
  throw new Error("中继上找不到这份证据的存档见证");
}

// ---- judgments -------------------------------------------------------------------

export interface JudgmentView extends JudgmentSummary {
  labels: Record<string, string>;
  self: string | null;
  relays: number;
}

export async function queryJudgments(textSha: string): Promise<JudgmentView> {
  const relays = await getRelays();
  const [events, who] = await Promise.all([
    queryEvents(relays, { kinds: [JUDGMENT_KIND], "#x": [textSha], limit: 500 }),
    getTrustContext(relays),
  ]);
  const parsed = events.map(parseJudgmentEvent).filter((p): p is ParsedJudgment => !!p);
  const summary = aggregateJudgments(parsed, textSha, who.trusted, who.self);
  return { ...summary, labels: who.labels, self: who.self, relays: relays.length };
}

export async function publishJudgment(input: {
  url: string;
  text_sha256: string;
  verdict: Verdict;
  reason: string;
}): Promise<{ published: PublishOutcome; witnessed: number; evidence: number }> {
  const sk = await ensureSk();
  const report = await evidenceReport(input.text_sha256);

  // Evidence others cannot fetch is useless: make sure each one has a public witness.
  let witnessed = 0;
  for (const e of report.items) {
    if (e.published) continue;
    await publishCapture(e.capture_id);
    witnessed++;
  }
  const evidence: EvidenceRef[] = report.items.map((e) => ({
    text_sha256: e.text_sha256,
    url: e.url,
    title: e.title,
    relation: e.relation,
  }));
  const ev = buildJudgmentEvent({ ...input, evidence }, sk);
  const result = await publishEvent(await getRelays(), ev);
  if (result.ok === 0) throw new Error(`所有中继都发布失败（${result.failed} 个）`);
  return {
    published: { npub: identityFromSk(sk).npub, relays_ok: result.ok, relays_failed: result.failed },
    witnessed,
    evidence: evidence.length,
  };
}

export async function claimChecklist(textSha: string): Promise<ChecklistItem[]> {
  const cfg = await getLlmConfig();
  if (!cfg) throw new Error("未配置 LLM key（设置 → LLM 设置）");
  const c = await captureForHash(textSha);
  if (!c) throw new Error("找不到这份存档");
  return runClaimChecklist(cfg, { title: c.title, text: c.text });
}
