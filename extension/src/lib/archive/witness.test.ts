import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from "nostr-tools";
import { bytesToHex, sha256Hex } from "../canonical";
import { buildCapture, type Capture } from "./capture";
import { buildCaptureEvent, parseCaptureEvent, type ParsedCapture } from "./event";
import {
  OBSERVATION_KIND,
  buildObservationEvent,
  parseObservationEvent,
  type ParsedObservation,
} from "./observation";
import { aggregateWitnesses } from "./witness";
import {
  applyObservation,
  dueEntries,
  htmlToText,
  newWatch,
  nextCheckAt,
  recheckSupported,
  recheckUrl,
} from "./recheck";
import { fetchVerifiedBlob } from "./blossom";

const URL_ = "https://mp.weixin.qq.com/s/abc";

function key(): { sk: string; pk: string } {
  const raw = generateSecretKey();
  return { sk: bytesToHex(raw), pk: getPublicKey(raw) };
}

async function cap(text: string, at: string, state: Capture["page_state"] = "live"): Promise<Capture> {
  return buildCapture(
    { url: URL_, title: "标题", text, page_state: state, page_evidence: null, platform: "wechat" },
    new Date(at),
  );
}

async function witness(sk: string, text: string, at: string): Promise<ParsedCapture> {
  const p = await parseCaptureEvent(buildCaptureEvent(await cap(text, at), sk));
  if (!p) throw new Error("parse failed");
  return p;
}

function observe(sk: string, state: "live" | "deleted" | "censored", at: string, x?: string): ParsedObservation {
  const ev = buildObservationEvent(
    {
      url: URL_,
      platform: "wechat",
      page_state: state,
      evidence: state === "live" ? null : "此内容因违规无法查看",
      http_status: 200,
      observed_at: at,
      method: "visit",
      last_seen_text_sha256: x,
    },
    sk,
    new Date(at),
  );
  const p = parseObservationEvent(ev);
  if (!p) throw new Error("parse failed");
  return p;
}

describe("observation events", () => {
  it("round-trips with r/s/x tags", async () => {
    const { sk, pk } = key();
    const x = await sha256Hex("正文");
    const o = observe(sk, "censored", "2026-11-24T01:00:00Z", x);
    expect(o.pubkey).toBe(pk);
    expect(o.content.page_state).toBe("censored");
    expect(o.content.last_seen_text_sha256).toBe(x);
  });

  it("rejects tag/content disagreement and tampering", () => {
    const { sk } = key();
    const ev = buildObservationEvent(
      {
        url: URL_, platform: "wechat", page_state: "deleted", evidence: null,
        http_status: null, observed_at: "2026-11-24T01:00:00Z", method: "visit",
      },
      sk,
      new Date("2026-11-24T01:00:00Z"),
    );
    expect(parseObservationEvent(ev)).not.toBeNull();
    expect(parseObservationEvent({ ...ev, content: ev.content.replace("deleted", "live") })).toBeNull();
    // re-signed with a lying s tag
    const lying = finalizeEvent(
      { kind: OBSERVATION_KIND, created_at: ev.created_at, content: ev.content, tags: [["r", URL_], ["s", "live"]] },
      Uint8Array.from(Buffer.from(sk, "hex")),
    );
    expect(parseObservationEvent(lying)).toBeNull();
  });

  it("rejects observations dated after the event itself", () => {
    const { sk } = key();
    const ev: Event = buildObservationEvent(
      {
        url: URL_, platform: "wechat", page_state: "deleted", evidence: null,
        http_status: null, observed_at: "2027-01-01T00:00:00Z", method: "visit",
      },
      sk,
      new Date("2026-11-24T00:00:00Z"),
    );
    expect(parseObservationEvent(ev)).toBeNull();
  });
});

describe("aggregateWitnesses", () => {
  it("groups by text hash, counts distinct keys, flags local + trusted", async () => {
    const a = key();
    const b = key();
    const c = key();
    const caps = [
      await witness(a.sk, "原文版本一", "2026-11-20T01:00:00Z"),
      await witness(a.sk, "原文版本一", "2026-11-20T05:00:00Z"), // same key twice → one witness
      await witness(b.sk, "原文版本一", "2026-11-20T03:00:00Z"),
      await witness(c.sk, "被改过的版本", "2026-11-21T00:00:00Z"),
    ];
    const v1 = await sha256Hex("原文版本一");
    const s = aggregateWitnesses(caps, [], {
      follows: new Set([b.pk]),
      self: a.pk,
      localHashes: new Set([v1]),
    });
    expect(s.total_witnesses).toBe(3);
    expect(s.versions).toHaveLength(2);
    const top = s.versions[0];
    expect(top.text_sha256).toBe(v1);
    expect(top.witnesses).toHaveLength(2);
    expect(top.trusted).toBe(1);
    expect(top.matches_local).toBe(true);
    expect(top.includes_self).toBe(true);
    expect(top.first_captured_at).toBe("2026-11-20T01:00:00Z");
    expect(top.last_captured_at).toBe("2026-11-20T05:00:00Z");
    expect(top.has_text).toBe(true);
    expect(s.versions[1].witnesses).toEqual([c.pk]);
  });

  it("ignores captures taken on deletion pages", async () => {
    const a = key();
    const gonePage = await parseCaptureEvent(
      buildCaptureEvent(await cap("此内容因违规无法查看", "2026-11-22T00:00:00Z", "censored"), a.sk),
    );
    const s = aggregateWitnesses([gonePage!], [], { follows: new Set(), self: null, localHashes: new Set() });
    expect(s.versions).toEqual([]);
    expect(s.total_witnesses).toBe(0);
  });

  it("summarizes deletion observations using each key's latest view", () => {
    const a = key();
    const b = key();
    const c = key();
    const s = aggregateWitnesses(
      [],
      [
        observe(a.sk, "live", "2026-11-21T00:00:00Z"),
        observe(a.sk, "censored", "2026-11-22T08:00:00Z"),
        observe(b.sk, "deleted", "2026-11-22T02:00:00Z"),
        observe(c.sk, "live", "2026-11-22T01:00:00Z"),
      ],
      { follows: new Set([b.pk]), self: null, localHashes: new Set() },
    );
    expect(s.gone?.observers.sort()).toEqual([a.pk, b.pk].sort());
    expect(s.gone?.trusted).toBe(1);
    expect(s.gone?.earliest).toBe("2026-11-22T02:00:00Z");
    expect(s.gone?.states.sort()).toEqual(["censored", "deleted"]);
    expect(s.last_seen_live).toBe("2026-11-22T01:00:00Z");
  });
});

describe("recheck scheduling", () => {
  it("follows the backoff schedule and stops", () => {
    expect(nextCheckAt("2026-11-24T00:00:00Z", 0)).toBe("2026-11-24T01:00:00Z");
    expect(nextCheckAt("2026-11-24T00:00:00Z", 2)).toBe("2026-11-25T00:00:00Z");
    expect(nextCheckAt("2026-11-24T00:00:00Z", 7)).toBeNull();
  });

  it("skips client-rendered platforms", () => {
    expect(recheckSupported("https://mp.weixin.qq.com/s/x")).toBe(true);
    expect(recheckSupported("https://weibo.com/1/abc")).toBe(false);
    expect(newWatch("https://weibo.com/1/abc", "2026-11-24T00:00:00Z", "a".repeat(64), "live").next_check_at).toBeNull();
  });

  it("records a live → gone transition once and stops polling", () => {
    const w = newWatch(URL_, "2026-11-24T00:00:00Z", "a".repeat(64), "live");
    expect(applyObservation(w, { at: "2026-11-24T01:00:00Z", state: "live", evidence: null, method: "recheck" })).toBe(false);
    expect(w.next_check_at).toBe("2026-11-24T06:00:00Z");
    expect(applyObservation(w, { at: "2026-11-24T06:00:00Z", state: "censored", evidence: "违规", method: "recheck" })).toBe(true);
    expect(w).toMatchObject({ state: "censored", gone_since: "2026-11-24T06:00:00Z", unseen_gone: true, next_check_at: null, checks: 2 });
    expect(applyObservation(w, { at: "2026-11-24T07:00:00Z", state: "censored", evidence: "违规", method: "visit" })).toBe(false);
    expect(w.history.map((h) => h.state)).toEqual(["live", "censored"]);
  });

  it("picks due entries oldest first, capped", () => {
    const a = newWatch(URL_ + "1", "2026-11-24T00:00:00Z", "a".repeat(64), "live");
    const b = newWatch(URL_ + "2", "2026-11-23T00:00:00Z", "a".repeat(64), "live");
    const c = newWatch(URL_ + "3", "2026-11-24T05:00:00Z", "a".repeat(64), "live");
    const due = dueEntries([a, b, c], "2026-11-24T02:00:00Z", 1);
    expect(due.map((w) => w.url)).toEqual([URL_ + "2"]);
    expect(dueEntries([a, b, c], "2026-11-24T02:00:00Z", 10)).toHaveLength(2);
  });
});

describe("recheckUrl", () => {
  const page = (body: string, status = 200) =>
    (async () => new Response(body, { status, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;

  it("strips html to text", () => {
    const r = htmlToText("<html><head><title> T </title><style>x{}</style></head><body><p>a&nbsp;b</p><script>z</script></body></html>");
    expect(r).toEqual({ title: "T", text: "T a b" });
  });

  it("detects a censored WeChat page without cookies", async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i: RequestInit) => {
      init = i;
      return new Response("<body><h2>此内容因违规无法查看</h2></body>");
    }) as unknown as typeof fetch;
    expect(await recheckUrl(URL_, f)).toEqual({ state: "censored", evidence: "此内容因违规无法查看", http_status: 200 });
    expect(init?.credentials).toBe("omit");
  });

  it("treats 404 as not_found, and anti-bot walls / 5xx / network errors as inconclusive", async () => {
    expect((await recheckUrl(URL_, page("x", 404)))?.state).toBe("not_found");
    expect(await recheckUrl(URL_, page("<p>当前环境异常，完成验证后即可继续访问</p>"))).toBeNull();
    expect(await recheckUrl(URL_, page("oops", 503))).toBeNull();
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await recheckUrl(URL_, boom)).toBeNull();
  });

  it("reports a long live article as live", async () => {
    expect((await recheckUrl(URL_, page(`<p>${"正文内容。".repeat(400)}</p>`)))?.state).toBe("live");
  });
});

describe("fetchVerifiedBlob", () => {
  it("accepts only bytes that hash to the expected sha256", async () => {
    const good = new TextEncoder().encode("真正的正文");
    const sha = await sha256Hex(good);
    const f = (async (u: string) =>
      new Response(u.includes("evil") ? "篡改过的正文" : good)) as unknown as typeof fetch;
    expect(await fetchVerifiedBlob(["https://evil.example/x"], sha, f)).toBeNull();
    expect(await fetchVerifiedBlob(["https://evil.example/x", "https://ok.example/x"], sha, f)).toEqual(good);
  });
});
