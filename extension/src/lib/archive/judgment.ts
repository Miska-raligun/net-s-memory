// Truthfulness judgment: a signed, public opinion about whether one *text
// version* (identified by its text_sha256) is accurate.
//
// This is deliberately separate from witnessing. A witness says "this text
// existed here"; a judgment says "I think what it claims is true/false,
// because …, see this archived evidence". Judgments are opinions of a key,
// never a platform verdict, and the UI says so.
//
//   kind:    JUDGMENT_KIND (parameterized replaceable, 30000–39999), so each
//            author has at most one current judgment per text version and can
//            change their mind
//   tags:    ["d", text_sha256]  replaceable address
//            ["x", text_sha256]  query all judgments of a version
//            ["r", url]          the page the version came from
//            ["l", verdict]
//            ["q", evidence_text_sha256, relation] for each piece of evidence
//            ["alt", ...]
//   content: JSON JudgmentContent
//
// Evidence must itself be an archived text (by hash), not a bare link, so it
// cannot silently disappear or change; anyone can fetch the witnessed copy.

import { finalizeEvent, verifyEvent, type Event } from "nostr-tools";
import { hexToBytes } from "../canonical";
import { normalizeUrl } from "../url";

export const JUDGMENT_KIND = 30911;
export const JUDGMENT_SCHEMA = "nsm-judgment.v1";

export type Verdict = "true" | "mostly_true" | "disputed" | "false" | "unverifiable";
export const VERDICTS: Verdict[] = ["true", "mostly_true", "disputed", "false", "unverifiable"];
export const VERDICT_LABEL: Record<Verdict, string> = {
  true: "属实",
  mostly_true: "大体属实",
  disputed: "存疑",
  false: "不实",
  unverifiable: "无法判断",
};

export type Relation = "supports" | "refutes" | "context";
export const RELATIONS: Relation[] = ["supports", "refutes", "context"];
export const RELATION_LABEL: Record<Relation, string> = {
  supports: "支持",
  refutes: "反驳",
  context: "背景",
};

export const REASON_MIN = 10;
export const REASON_MAX = 1000;
export const EVIDENCE_MAX = 10;

export interface EvidenceRef {
  text_sha256: string;
  url: string;
  title: string;
  relation: Relation;
}

export interface JudgmentContent {
  schema: typeof JUDGMENT_SCHEMA;
  url: string;
  text_sha256: string;
  verdict: Verdict;
  reason: string;
  evidence: EvidenceRef[];
  judged_at: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Validate user input; returns a list of problems (empty = ok). */
export function validateJudgment(j: Omit<JudgmentContent, "schema" | "judged_at">): string[] {
  const errs: string[] = [];
  if (!HEX64.test(j.text_sha256)) errs.push("缺少要判断的正文版本");
  if (!VERDICTS.includes(j.verdict)) errs.push("请选择结论");
  const n = [...j.reason.trim()].length;
  if (n < REASON_MIN) errs.push(`理由至少 ${REASON_MIN} 个字`);
  if (n > REASON_MAX) errs.push(`理由最多 ${REASON_MAX} 个字`);
  if (j.evidence.length > EVIDENCE_MAX) errs.push(`证据最多 ${EVIDENCE_MAX} 份`);
  const seen = new Set<string>();
  for (const e of j.evidence) {
    if (!HEX64.test(e.text_sha256) || !RELATIONS.includes(e.relation)) errs.push("证据格式不正确");
    if (e.text_sha256 === j.text_sha256) errs.push("不能用被判断的正文本身当证据");
    if (seen.has(e.text_sha256)) errs.push("同一份证据重复了");
    seen.add(e.text_sha256);
  }
  return [...new Set(errs)];
}

export function buildJudgmentEvent(
  input: Omit<JudgmentContent, "schema" | "judged_at">,
  skHex: string,
  now: Date = new Date(),
): Event {
  const errs = validateJudgment(input);
  if (errs.length) throw new Error(errs.join("；"));
  const content: JudgmentContent = {
    schema: JUDGMENT_SCHEMA,
    url: normalizeUrl(input.url),
    text_sha256: input.text_sha256,
    verdict: input.verdict,
    reason: input.reason.trim(),
    evidence: input.evidence.map((e) => ({
      text_sha256: e.text_sha256,
      url: normalizeUrl(e.url),
      title: e.title.slice(0, 200),
      relation: e.relation,
    })),
    judged_at: now.toISOString().replace(/\.\d+Z$/, "Z"),
  };
  return finalizeEvent(
    {
      kind: JUDGMENT_KIND,
      created_at: Math.floor(now.getTime() / 1000),
      tags: [
        ["d", content.text_sha256],
        ["x", content.text_sha256],
        ["r", content.url],
        ["l", content.verdict],
        ...content.evidence.map((e) => ["q", e.text_sha256, e.relation]),
        ["alt", `互联网记忆真实性判断：${VERDICT_LABEL[content.verdict]}（个人观点）`],
      ],
      content: JSON.stringify(content),
    },
    hexToBytes(skHex),
  );
}

export interface ParsedJudgment {
  event_id: string;
  pubkey: string;
  created_at: number;
  content: JudgmentContent;
}

const tag = (ev: Event, n: string) => ev.tags.find((t) => t[0] === n)?.[1];

export function parseJudgmentEvent(ev: Event): ParsedJudgment | null {
  if (ev.kind !== JUDGMENT_KIND || !verifyEvent(ev)) return null;
  let c: JudgmentContent;
  try {
    c = JSON.parse(ev.content) as JudgmentContent;
  } catch {
    return null;
  }
  if (c.schema !== JUDGMENT_SCHEMA || !Array.isArray(c.evidence) || typeof c.reason !== "string") return null;
  if (validateJudgment(c).length) return null;
  if (tag(ev, "d") !== c.text_sha256 || tag(ev, "x") !== c.text_sha256 || tag(ev, "l") !== c.verdict) return null;
  const q = ev.tags.filter((t) => t[0] === "q").map((t) => `${t[1]}:${t[2]}`).sort();
  const e = c.evidence.map((x) => `${x.text_sha256}:${x.relation}`).sort();
  if (q.join() !== e.join()) return null;
  return { event_id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, content: c };
}

export interface JudgmentGroup {
  counts: Record<Verdict, number>;
  items: ParsedJudgment[];
}

export interface JudgmentSummary {
  trusted: JudgmentGroup;
  others: JudgmentGroup;
  mine: ParsedJudgment | null;
}

function emptyGroup(): JudgmentGroup {
  return { counts: { true: 0, mostly_true: 0, disputed: 0, false: 0, unverifiable: 0 }, items: [] };
}

/**
 * Latest judgment per key for one text version, split into the people you
 * trust and everyone else. No combined score on purpose.
 */
export function aggregateJudgments(
  judgments: ParsedJudgment[],
  textSha256: string,
  trusted: Set<string>,
  self: string | null,
): JudgmentSummary {
  const latest = new Map<string, ParsedJudgment>();
  for (const j of judgments) {
    if (j.content.text_sha256 !== textSha256) continue;
    const prev = latest.get(j.pubkey);
    if (!prev || j.created_at > prev.created_at) latest.set(j.pubkey, j);
  }
  const out: JudgmentSummary = { trusted: emptyGroup(), others: emptyGroup(), mine: null };
  for (const j of [...latest.values()].sort((a, b) => b.created_at - a.created_at)) {
    if (self && j.pubkey === self) {
      out.mine = j;
      continue;
    }
    const g = trusted.has(j.pubkey) ? out.trusted : out.others;
    g.counts[j.content.verdict]++;
    g.items.push(j);
  }
  return out;
}
