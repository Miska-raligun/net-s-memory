// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isDomestic } from "./domestic";
import {
  buildSearchUrl,
  engineOf,
  filterHits,
  looksBlocked,
  parseBing,
  parseGoogle,
  unwrapResultUrl,
} from "./serp";

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function b64url(s: string): string {
  const bin = String.fromCharCode(...new TextEncoder().encode(s));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const GOOGLE_HTML = `
<div id="search"><div id="rso">
  <div class="MjjYud"><div class="g">
    <a href="https://www.reuters.com/world/china/factory-2026-11-20/"><h3>Factory pollution probe</h3></a>
    <div class="VwiC3b">Authorities opened an investigation…</div>
  </div></div>
  <div class="MjjYud"><div class="g">
    <a href="/url?q=https://news.sina.com.cn/c/2026-11-20/doc.shtml&sa=U"><h3>某企业排污被查</h3></a>
    <div class="VwiC3b">新浪新闻报道…</div>
  </div></div>
  <div class="MjjYud"><div class="g">
    <a href="https://www.google.com/search?q=related"><h3>Related searches</h3></a>
  </div></div>
  <div class="MjjYud"><div class="g">
    <a href="https://www.reuters.com/world/china/factory-2026-11-20/"><h3>Factory pollution probe</h3></a>
  </div></div>
</div></div>`;

const BING_HTML = `
<ol id="b_results">
  <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=abc&u=a1${b64url(
    "https://www.bbc.com/zhongwen/simp/chinese-news-1",
  )}&ntb=1">BBC 中文：工厂排污</a></h2>
    <div class="b_caption"><p>据报道……</p></div></li>
  <li class="b_algo"><h2><a href="https://www.thepaper.cn/newsDetail_forward_1">澎湃新闻</a></h2>
    <div class="b_caption"><p>澎湃……</p></div></li>
  <li class="b_ad"><h2><a href="https://ads.example.com">广告</a></h2></li>
</ol>`;

describe("search URLs", () => {
  it("uses the international Bing index and Google directly", () => {
    expect(buildSearchUrl("bing", "某企业 排污")).toBe(
      "https://www.bing.com/search?q=%E6%9F%90%E4%BC%81%E4%B8%9A%20%E6%8E%92%E6%B1%A1&ensearch=1",
    );
    expect(buildSearchUrl("google", "a b")).toBe("https://www.google.com/search?q=a%20b&hl=zh-CN");
  });

  it("identifies engines", () => {
    expect(engineOf("https://www.google.com.hk/search?q=1")).toBe("google");
    expect(engineOf("https://cn.bing.com/search?q=1")).toBe("bing");
    expect(engineOf("https://duckduckgo.com/?q=1")).toBeNull();
  });
});

describe("unwrapResultUrl", () => {
  it("decodes Bing click-tracking links", () => {
    const href = `https://www.bing.com/ck/a?!&&p=1&u=a1${b64url("https://example.org/新闻?id=1")}&ntb=1`;
    expect(unwrapResultUrl(href)).toBe("https://example.org/新闻?id=1");
  });
  it("decodes Google /url redirects", () => {
    expect(unwrapResultUrl("/url?q=https://example.org/a&sa=U")).toBe("https://example.org/a");
  });
  it("ignores other relative links", () => {
    expect(unwrapResultUrl("/search?q=x")).toBeNull();
  });
});

describe("parsers", () => {
  it("parses Google results, unwraps, skips engine links, dedupes", () => {
    const hits = parseGoogle(doc(GOOGLE_HTML));
    expect(hits.map((h) => h.url)).toEqual([
      "https://www.reuters.com/world/china/factory-2026-11-20/",
      "https://news.sina.com.cn/c/2026-11-20/doc.shtml",
    ]);
    expect(hits[0]).toMatchObject({ domain: "reuters.com", domestic: false, snippet: "Authorities opened an investigation…" });
    expect(hits[1].domestic).toBe(true);
  });

  it("parses Bing organic results only", () => {
    const hits = parseBing(doc(BING_HTML));
    expect(hits.map((h) => h.domain)).toEqual(["bbc.com", "thepaper.cn"]);
    expect(hits[0].url).toBe("https://www.bbc.com/zhongwen/simp/chinese-news-1");
    expect(hits[1].domestic).toBe(true);
  });

  it("detects captcha walls", () => {
    expect(looksBlocked("google", doc("<div></div>"), "https://www.google.com/sorry/index")).toBe(true);
    expect(looksBlocked("bing", doc("<form id='captcha-form'></form>"), "https://www.bing.com/search")).toBe(true);
    expect(looksBlocked("bing", doc(BING_HTML), "https://www.bing.com/search?q=1")).toBe(false);
  });
});

describe("filterHits / isDomestic", () => {
  it("classifies mainland domains", () => {
    expect(isDomestic("news.sina.com.cn")).toBe(true);
    expect(isDomestic("mp.weixin.qq.com")).toBe(true);
    expect(isDomestic("thepaper.cn")).toBe(true);
    expect(isDomestic("zhihu.com")).toBe(true);
    expect(isDomestic("bbc.com")).toBe(false);
    expect(isDomestic("rfi.fr")).toBe(false);
  });

  it("hides domestic sources and the page itself", () => {
    const hits = parseBing(doc(BING_HTML));
    const r = filterHits(hits, { hideDomestic: true, excludeUrl: "https://www.bbc.com/zhongwen/simp/chinese-news-1#x" });
    expect(r.hits).toEqual([]);
    expect(r.hiddenDomestic).toBe(1);
    expect(filterHits(hits, { hideDomestic: false }).hits).toHaveLength(2);
  });
});
