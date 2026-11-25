import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from "nostr-tools";
import { bytesToHex, sha256Hex } from "../canonical";
import {
  JUDGMENT_KIND,
  aggregateJudgments,
  buildJudgmentEvent,
  parseJudgmentEvent,
  validateJudgment,
  type ParsedJudgment,
  type Verdict,
} from "./judgment";
import { containment, groupSameSource, sameSource, shingles } from "./similarity";

const key = () => {
  const raw = generateSecretKey();
  return { sk: bytesToHex(raw), raw, pk: getPublicKey(raw) };
};
const H = (s: string) => sha256Hex(s);
const URL_ = "https://mp.weixin.qq.com/s/abc";
const REASON = "当地环保局公布的检测报告与文中数据一致。";

async function judgment(sk: string, verdict: Verdict, at: string, evidenceText?: string) {
  const target = await H("被判断的正文");
  const ev = buildJudgmentEvent(
    {
      url: URL_,
      text_sha256: target,
      verdict,
      reason: REASON,
      evidence: evidenceText
        ? [{ text_sha256: await H(evidenceText), url: "https://www.bbc.com/zhongwen/x", title: "BBC", relation: "supports" }]
        : [],
    },
    sk,
    new Date(at),
  );
  return { ev, target };
}

describe("judgment events", () => {
  it("round-trips with d/x/l/q tags", async () => {
    const k = key();
    const { ev, target } = await judgment(k.sk, "mostly_true", "2026-11-25T00:00:00Z", "证据正文");
    expect(ev.kind).toBe(JUDGMENT_KIND);
    expect(ev.tags).toContainEqual(["d", target]);
    expect(ev.tags).toContainEqual(["l", "mostly_true"]);
    expect(ev.tags.find((t) => t[0] === "q")?.[2]).toBe("supports");
    const p = parseJudgmentEvent(ev);
    expect(p?.pubkey).toBe(k.pk);
    expect(p?.content.reason).toBe(REASON);
  });

  it("validates input", async () => {
    const t = await H("x");
    const base = { url: URL_, text_sha256: t, verdict: "true" as Verdict, reason: REASON, evidence: [] };
    expect(validateJudgment(base)).toEqual([]);
    expect(validateJudgment({ ...base, reason: "太短" })).toContain("理由至少 10 个字");
    expect(validateJudgment({ ...base, verdict: "maybe" as Verdict })).toContain("请选择结论");
    expect(
      validateJudgment({ ...base, evidence: [{ text_sha256: t, url: URL_, title: "", relation: "supports" }] }),
    ).toContain("不能用被判断的正文本身当证据");
    expect(() => buildJudgmentEvent({ ...base, reason: "" }, key().sk)).toThrow(/理由/);
  });

  it("rejects tampering and tag/content mismatches", async () => {
    const k = key();
    const { ev } = await judgment(k.sk, "false", "2026-11-25T00:00:00Z", "证据");
    expect(parseJudgmentEvent({ ...ev, content: ev.content.replace("false", "true") })).toBeNull();
    const c = JSON.parse(ev.content);
    // re-signed with an l tag that lies about the verdict
    const lying = finalizeEvent(
      { kind: JUDGMENT_KIND, created_at: ev.created_at, content: ev.content,
        tags: ev.tags.map((t) => (t[0] === "l" ? ["l", "true"] : t)) },
      k.raw,
    );
    expect(parseJudgmentEvent(lying)).toBeNull();
    // evidence in content without the matching q tag
    const noQ = finalizeEvent(
      { kind: JUDGMENT_KIND, created_at: ev.created_at, content: JSON.stringify(c),
        tags: ev.tags.filter((t) => t[0] !== "q") },
      k.raw,
    );
    expect(parseJudgmentEvent(noQ)).toBeNull();
  });
});

describe("aggregateJudgments", () => {
  it("keeps each key's latest view, splits trusted / others / mine, no score", async () => {
    const a = key(), b = key(), c = key(), me = key();
    const evs: Event[] = [];
    let target = "";
    for (const [k, v, at] of [
      [a, "false", "2026-11-25T00:00:00Z"],
      [a, "true", "2026-11-25T05:00:00Z"], // a changed their mind
      [b, "disputed", "2026-11-25T01:00:00Z"],
      [c, "false", "2026-11-25T02:00:00Z"],
      [me, "true", "2026-11-25T03:00:00Z"],
    ] as const) {
      const r = await judgment(k.sk, v, at);
      evs.push(r.ev);
      target = r.target;
    }
    const parsed = evs.map(parseJudgmentEvent).filter((x): x is ParsedJudgment => !!x);
    const s = aggregateJudgments(parsed, target, new Set([a.pk, b.pk]), me.pk);
    expect(s.trusted.counts).toMatchObject({ true: 1, disputed: 1, false: 0 });
    expect(s.trusted.items.map((i) => i.pubkey).sort()).toEqual([a.pk, b.pk].sort());
    expect(s.others.counts.false).toBe(1);
    expect(s.mine?.content.verdict).toBe("true");
    expect(Object.keys(s)).not.toContain("score");
  });

  it("ignores judgments about other versions", async () => {
    const a = key();
    const { ev } = await judgment(a.sk, "true", "2026-11-25T00:00:00Z");
    const s = aggregateJudgments([parseJudgmentEvent(ev)!], "0".repeat(64), new Set(), null);
    expect(s.others.items).toEqual([]);
  });
});

describe("same-source (通稿) detection", () => {
  const wire =
    "新华社北京11月20日电 记者从有关部门获悉，某市化工园区一企业因违规排放被立案调查，相关负责人已被约谈。" +
    "调查组表示，将依法依规严肃处理，并及时向社会公布调查结果。目前，涉事河段水质监测工作正在进行。";

  it("treats a lightly edited republication as the same source", () => {
    const repost = `转自新华社。\n${wire.replace("记者从有关部门获悉，", "记者获悉，")}（责任编辑：张三）`;
    expect(sameSource(wire, repost)).toBe(true);
  });

  it("treats an excerpt of the wire copy as the same source", () => {
    expect(sameSource(wire, wire.slice(0, 60))).toBe(true);
  });

  it("does not merge independent reporting on the same event", () => {
    const independent =
      "BBC中文记者实地走访发现，村民反映河道自今年夏天起频繁出现死鱼，" +
      "多名村民称曾多次向当地政府举报但未获回应，环保组织呼吁公开水质检测数据。";
    expect(sameSource(wire, independent)).toBe(false);
  });

  it("ignores punctuation and whitespace differences", () => {
    expect(containment(shingles("甲乙丙丁戊己庚辛"), shingles("甲，乙 丙。丁戊己\n庚辛"))).toBe(1);
  });

  it("groups items into independent sources", () => {
    const other = "法广报道：环保人士指出该园区多年来多次被投诉，地方监管部门的回应前后矛盾，引发外界质疑。";
    const groups = groupSameSource([
      { id: "a", text: wire },
      { id: "b", text: `来源：新华网 ${wire}` },
      { id: "c", text: other },
    ]);
    expect(groups.map((g) => g.sort()).sort()).toEqual([["a", "b"], ["c"]]);
  });
});
