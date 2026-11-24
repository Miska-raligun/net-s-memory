import { describe, expect, it } from "vitest";
import { domainCandidates, extractDomain, normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  it("lowercases host and drops fragment", () => {
    expect(normalizeUrl("https://Example.COM/a#section")).toBe("https://example.com/a");
  });

  it("strips tracking params but keeps real ones", () => {
    expect(normalizeUrl("https://x.com/p?utm_source=a&id=7&fbclid=zz")).toBe(
      "https://x.com/p?id=7",
    );
  });

  it("sorts remaining query params deterministically", () => {
    expect(normalizeUrl("https://x.com/p?b=2&a=1")).toBe("https://x.com/p?a=1&b=2");
  });

  it("removes a trailing slash on a path but not the bare origin", () => {
    expect(normalizeUrl("https://x.com/a/")).toBe("https://x.com/a");
    expect(normalizeUrl("https://x.com/")).toBe("https://x.com/");
  });

  it("drops default ports", () => {
    expect(normalizeUrl("https://x.com:443/a")).toBe("https://x.com/a");
  });

  it("returns input unchanged when not a URL", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });

  it("collides two tracking-decorated variants of the same article", () => {
    const a = normalizeUrl("https://News.Sina.com.cn/x?utm_medium=q&spm=1");
    const b = normalizeUrl("https://news.sina.com.cn/x/?ref=home");
    expect(a).toBe(b);
  });
});

describe("extractDomain", () => {
  it("lowercases and strips www", () => {
    expect(extractDomain("https://www.People.com.cn/x")).toBe("people.com.cn");
  });
  it("returns null on garbage", () => {
    expect(extractDomain("nope")).toBeNull();
  });
});

describe("domainCandidates", () => {
  it("yields longest-to-shortest suffixes", () => {
    // Stops before the bare TLD — "cn" alone is never a registrable domain.
    expect(domainCandidates("news.sina.com.cn")).toEqual([
      "news.sina.com.cn",
      "sina.com.cn",
      "com.cn",
    ]);
  });
});
