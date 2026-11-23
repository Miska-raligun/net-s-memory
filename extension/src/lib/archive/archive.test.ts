import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey, verifyEvent, type Event } from "nostr-tools";
import { bytesToHex, sha256Hex } from "../canonical";
import { normalizeText } from "./normalize";
import { detectPageState, platformOf } from "./detect";
import { buildCapture, type Capture } from "./capture";
import {
  CAPTURE_KIND,
  INLINE_TEXT_MAX_BYTES,
  buildCaptureEvent,
  parseCaptureEvent,
} from "./event";
import { authHeader, buildUploadAuth, uploadBlob, uploadToAll } from "./blossom";
import { saveToWayback, snapshotFromLocation } from "./wayback";

describe("normalizeText", () => {
  it("canonicalizes whitespace, invisibles and line endings", () => {
    const raw = "\uFEFF  标题\u3000第一段\r\n\r\n\t第二段\u00A0 有\u200B空格  \u2028 \n\n";
    expect(normalizeText(raw)).toBe("标题 第一段\n第二段 有空格");
  });

  it("is idempotent", () => {
    const once = normalizeText("a  b\n\n c \r\nd");
    expect(normalizeText(once)).toBe(once);
  });

  it("applies NFC so composed and decomposed forms hash the same", async () => {
    const composed = "café";
    const decomposed = "café";
    expect(await sha256Hex(normalizeText(composed))).toBe(
      await sha256Hex(normalizeText(decomposed)),
    );
  });
});

describe("detectPageState", () => {
  it("recognizes platforms by host", () => {
    expect(platformOf("https://mp.weixin.qq.com/s/abc")).toBe("wechat");
    expect(platformOf("https://m.weibo.cn/detail/1")).toBe("weibo");
    expect(platformOf("https://www.zhihu.com/question/1")).toBe("zhihu");
    expect(platformOf("https://example.com/")).toBe("generic");
  });

  it("flags a censored WeChat article", () => {
    const d = detectPageState({
      url: "https://mp.weixin.qq.com/s/abc",
      title: "",
      bodyText: "此内容因违规无法查看 根据相关法律法规和政策",
    });
    expect(d).toEqual({ platform: "wechat", state: "censored", evidence: "此内容因违规无法查看" });
  });

  it("flags an author-deleted Weibo post", () => {
    const d = detectPageState({
      url: "https://weibo.com/123/Nabc",
      title: "微博",
      bodyText: "抱歉，此微博已被作者删除。查看帮助",
    });
    expect(d.state).toBe("deleted");
  });

  it("uses the HTTP status when available", () => {
    const d = detectPageState({ url: "https://example.com/a", title: "x", bodyText: "x", httpStatus: 404 });
    expect(d).toEqual({ platform: "generic", state: "not_found", evidence: "HTTP 404" });
  });

  it("does not misread a long article that mentions deletion", () => {
    const article = "某地事故调查报告全文。".repeat(80) + "有网友称相关帖子页面不存在，内容已被删除。";
    const d = detectPageState({ url: "https://news.example.com/a", title: "调查", bodyText: article });
    expect(d.state).toBe("live");
  });

  it("matches generic phrases only on very short pages", () => {
    const d = detectPageState({ url: "https://news.example.com/a", title: "404", bodyText: "您访问的页面不存在 返回首页" });
    expect(d.state).toBe("not_found");
  });
});

function sk(): string {
  return bytesToHex(generateSecretKey());
}

async function sampleCapture(text = "第一段\n第二段"): Promise<Capture> {
  return buildCapture(
    {
      url: "https://Example.com/news/1?utm_source=x#top",
      title: "某企业排污  调查",
      text: `  ${text}  `,
      page_state: "live",
      page_evidence: null,
      platform: "generic",
    },
    new Date("2026-11-23T08:00:00.123Z"),
  );
}

describe("buildCapture", () => {
  it("normalizes url/text and hashes the normalized text", async () => {
    const c = await sampleCapture();
    expect(c.url).toBe("https://example.com/news/1");
    expect(c.text).toBe("第一段\n第二段");
    expect(c.text_sha256).toBe(await sha256Hex("第一段\n第二段"));
    expect(c.captured_at).toBe("2026-11-23T08:00:00Z");
    expect(c.title).toBe("某企业排污 调查");
    expect(c.id).toMatch(/^20261123T080000Z-[0-9a-f]{12}$/);
  });
});

describe("capture witness event", () => {
  it("round-trips: signed, tagged, text re-verified", async () => {
    const key = sk();
    const c = await sampleCapture();
    const ev = buildCaptureEvent(c, key);
    expect(ev.kind).toBe(CAPTURE_KIND);
    expect(verifyEvent(ev)).toBe(true);
    expect(ev.tags).toContainEqual(["x", c.text_sha256]);
    expect(ev.tags).toContainEqual(["r", c.url]);

    const parsed = await parseCaptureEvent(ev);
    expect(parsed).not.toBeNull();
    expect(parsed!.text_verified).toBe(true);
    expect(parsed!.pubkey).toBe(getPublicKey(Uint8Array.from(Buffer.from(key, "hex"))));
    expect(parsed!.content.text).toBe(c.text);
  });

  it("rejects a re-signed event whose text no longer matches its hash", async () => {
    const key = sk();
    const c = await sampleCapture();
    const forged = { ...c, text: "某企业环保达标获表彰" }; // hash still the original
    const ev = buildCaptureEvent(forged, key);
    expect(verifyEvent(ev)).toBe(true); // signature itself is fine…
    expect(await parseCaptureEvent(ev)).toBeNull(); // …but content check fails
  });

  it("rejects content edited after signing", async () => {
    const ev = buildCaptureEvent(await sampleCapture(), sk());
    const tampered: Event = { ...ev, content: ev.content.replace("第一段", "第1段") };
    expect(await parseCaptureEvent(tampered)).toBeNull();
  });

  it("rejects an x tag that disagrees with content", async () => {
    const ev = buildCaptureEvent(await sampleCapture(), sk());
    const other = { ...ev, tags: ev.tags.map((t) => (t[0] === "x" ? ["x", "0".repeat(64)] : t)) };
    expect(await parseCaptureEvent(other)).toBeNull();
  });

  it("refuses to publish oversized text without a text blob", async () => {
    const big = await sampleCapture("长".repeat(INLINE_TEXT_MAX_BYTES));
    expect(() => buildCaptureEvent(big, sk())).toThrow(/Blossom/);
  });

  it("references oversized text through a blob instead of inlining it", async () => {
    const big = await sampleCapture("长".repeat(INLINE_TEXT_MAX_BYTES));
    big.blobs.push({
      kind: "text",
      sha256: big.text_sha256,
      size: 1,
      mime: "text/plain; charset=utf-8",
      urls: ["https://blossom.example/abc"],
    });
    const parsed = await parseCaptureEvent(buildCaptureEvent(big, sk()));
    expect(parsed).not.toBeNull();
    expect(parsed!.content.text).toBeUndefined();
    expect(parsed!.text_verified).toBe(false);
    expect(parsed!.content.blobs[0].kind).toBe("text");
  });

  it("omits local-only blobs from the wire format", async () => {
    const c = await sampleCapture();
    c.blobs.push({ kind: "screenshot", sha256: "a".repeat(64), size: 10, mime: "image/jpeg", urls: [] });
    const parsed = await parseCaptureEvent(buildCaptureEvent(c, sk()));
    expect(parsed!.content.blobs).toEqual([]);
  });
});

describe("blossom upload", () => {
  it("builds a BUD-01 auth event bound to the blob hash", () => {
    const ev = buildUploadAuth(sk(), "ab".repeat(32), new Date("2026-11-23T00:00:00Z"));
    expect(ev.kind).toBe(24242);
    expect(ev.tags).toContainEqual(["t", "upload"]);
    expect(ev.tags).toContainEqual(["x", "ab".repeat(32)]);
    const decoded = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(authHeader(ev).slice(6)), (c) => c.charCodeAt(0))),
    );
    expect(decoded.id).toBe(ev.id);
    expect(verifyEvent(decoded)).toBe(true);
  });

  it("PUTs the bytes and checks the returned hash", async () => {
    const bytes = new TextEncoder().encode("hello");
    const hash = await sha256Hex(bytes);
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ url: `https://b.example/${hash}`, sha256: hash, size: 5 }));
    }) as unknown as typeof fetch;
    const desc = await uploadBlob("https://b.example/", bytes, "text/plain", sk(), fakeFetch);
    expect(desc).toEqual({ url: `https://b.example/${hash}`, sha256: hash, size: 5 });
    expect(seen!.url).toBe("https://b.example/upload");
    expect(seen!.init.method).toBe("PUT");
    expect((seen!.init.headers as Record<string, string>).Authorization).toMatch(/^Nostr /);
  });

  it("rejects a server that returns a different hash", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ url: "https://b.example/x", sha256: "0".repeat(64) }))) as unknown as typeof fetch;
    await expect(
      uploadBlob("https://b.example", new Uint8Array([1]), "application/octet-stream", sk(), fakeFetch),
    ).rejects.toThrow(/不一致/);
  });

  it("collects partial success across servers", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = await sha256Hex(bytes);
    const fakeFetch = (async (url: string) =>
      url.startsWith("https://ok")
        ? new Response(JSON.stringify({ url: `https://ok.example/${hash}`, sha256: hash }))
        : new Response("nope", { status: 413 })) as unknown as typeof fetch;
    const r = await uploadToAll(["https://ok.example", "https://bad.example"], bytes, "x/y", sk(), fakeFetch);
    expect(r.urls).toEqual([`https://ok.example/${hash}`]);
    expect(r.errors[0]).toMatch(/413/);
  });
});

describe("wayback", () => {
  it("parses snapshot locations", () => {
    expect(snapshotFromLocation("/web/20261123080000/https://example.com/a")).toBe(
      "https://web.archive.org/web/20261123080000/https://example.com/a",
    );
    expect(snapshotFromLocation("https://web.archive.org/save/https://x")).toBeNull();
    expect(snapshotFromLocation(null)).toBeNull();
  });

  it("returns the snapshot URL from Content-Location", async () => {
    const fakeFetch = (async () =>
      new Response("", {
        headers: { "Content-Location": "/web/20261123080000/https://example.com/a" },
      })) as unknown as typeof fetch;
    expect(await saveToWayback("https://example.com/a", fakeFetch)).toBe(
      "https://web.archive.org/web/20261123080000/https://example.com/a",
    );
  });

  it("returns null on network failure", async () => {
    const fakeFetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await saveToWayback("https://example.com/a", fakeFetch)).toBeNull();
  });
});
