import { describe, expect, it } from "vitest";
import { checkForUpdate, compareVersions, isDue, parseRelease } from "./update";

const SHA = "2f6a0f87f1a09a542cbcaf46b83b7bbc02d74c348d1ecb518e0a4cb953fc9ae3";
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/Miska-raligun/net-s-memory/releases/tag/${tag}`,
  published_at: "2026-11-25T03:36:00Z",
  draft: false,
  prerelease: false,
  body: `sha256sum x\n# 应为 ${SHA}\n`,
  assets: [
    {
      name: `net-s-memory-extension-${tag}.zip`,
      browser_download_url: `https://github.com/Miska-raligun/net-s-memory/releases/download/${tag}/net-s-memory-extension-${tag}.zip`,
      digest: `sha256:${SHA}`,
    },
    { name: `net-s-memory-extension-${tag}.zip.sha256`, browser_download_url: "https://github.com/x" },
  ],
  ...extra,
});

describe("compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("0.10.0", "0.9.3")).toBe(1);
    expect(compareVersions("v0.3.0", "0.3")).toBe(0);
    expect(compareVersions("0.3.0", "0.3.1")).toBe(-1);
    expect(compareVersions("1.0", "0.99.99")).toBe(1);
  });
});

describe("parseRelease", () => {
  it("extracts version, zip url and digest", () => {
    expect(parseRelease(release("v0.4.0"))).toEqual({
      version: "0.4.0",
      release_url: "https://github.com/Miska-raligun/net-s-memory/releases/tag/v0.4.0",
      zip_url: "https://github.com/Miska-raligun/net-s-memory/releases/download/v0.4.0/net-s-memory-extension-v0.4.0.zip",
      zip_sha256: SHA,
      published_at: "2026-11-25T03:36:00Z",
    });
  });

  it("falls back to the checksum in the notes", () => {
    const r = release("v0.4.0");
    delete (r.assets[0] as { digest?: string }).digest;
    expect(parseRelease(r)?.zip_sha256).toBe(SHA);
  });

  it("ignores drafts, prereleases and non-version tags", () => {
    expect(parseRelease(release("v0.4.0", { prerelease: true }))).toBeNull();
    expect(parseRelease(release("v0.4.0", { draft: true }))).toBeNull();
    expect(parseRelease(release("nightly"))).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });

  it("only trusts github.com download links", () => {
    const r = release("v0.4.0");
    r.assets[0].browser_download_url = "https://evil.example/x.zip";
    expect(parseRelease(r)?.zip_url).toBeNull();
  });
});

describe("isDue", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  it("is due when never checked or after the interval", () => {
    expect(isDue(null, now)).toBe(true);
    expect(isDue("2026-11-24T11:59:00Z", now)).toBe(true);
    expect(isDue("2026-11-25T01:00:00Z", now)).toBe(false);
  });
});

describe("checkForUpdate", () => {
  const json = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("reports a newer version", async () => {
    const u = await checkForUpdate("0.3.0", json(release("v0.4.0")));
    expect(u).toMatchObject({ current: "0.3.0", latest: "0.4.0", available: true, zip_sha256: SHA, error: null });
  });

  it("reports up to date", async () => {
    const u = await checkForUpdate("0.4.0", json(release("v0.4.0")));
    expect(u).toMatchObject({ latest: "0.4.0", available: false, error: null });
  });

  it("never offers a downgrade", async () => {
    expect((await checkForUpdate("0.5.0", json(release("v0.4.0")))).available).toBe(false);
  });

  it("does not send cookies and survives failures", async () => {
    let init: RequestInit | undefined;
    const spy = (async (_u: string, i: RequestInit) => {
      init = i;
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const u = await checkForUpdate("0.3.0", spy);
    expect(init?.credentials).toBe("omit");
    expect(u).toMatchObject({ available: false, error: "GitHub 返回 HTTP 404" });
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect((await checkForUpdate("0.3.0", boom)).error).toMatch(/连不上/);
  });
});
