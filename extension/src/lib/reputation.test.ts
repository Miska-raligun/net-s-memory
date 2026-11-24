import { describe, expect, it } from "vitest";
import { lookupReputation } from "./reputation";

describe("lookupReputation", () => {
  it("matches an exact seed domain", () => {
    const r = lookupReputation("people.com.cn");
    expect(r.label).toBe("high");
    expect(r.weight).toBeCloseTo(0.9);
    expect(r.matched_domain).toBe("people.com.cn");
  });

  it("matches via a registrable-domain suffix (subdomain)", () => {
    const r = lookupReputation("news.sina.com.cn");
    expect(r.matched_domain).toBe("sina.com.cn");
    expect(r.label).toBe("medium");
  });

  it("falls back to neutral/unknown for unseen domains", () => {
    const r = lookupReputation("totally-unknown-blog.example");
    expect(r.label).toBe("unknown");
    expect(r.weight).toBeCloseTo(0.5);
    expect(r.matched_domain).toBeNull();
  });

  it("handles null domain", () => {
    expect(lookupReputation(null).label).toBe("unknown");
  });

  it("buckets a low-weight platform as low", () => {
    expect(lookupReputation("weibo.com").label).toBe("low");
  });
});
