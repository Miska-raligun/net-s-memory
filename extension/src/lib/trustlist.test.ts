import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import {
  importTrust,
  labelsOf,
  parsePubkey,
  removeTrust,
  shortNpub,
  trustedSet,
  upsertTrust,
  type TrustEntry,
} from "./trustlist";

const pk = () => getPublicKey(generateSecretKey());
const NOW = "2026-11-25T00:00:00Z";

describe("parsePubkey", () => {
  it("accepts npub, nostr:npub, nprofile and hex", () => {
    const p = pk();
    expect(parsePubkey(nip19.npubEncode(p))).toBe(p);
    expect(parsePubkey(`  nostr:${nip19.npubEncode(p)} `)).toBe(p);
    expect(parsePubkey(nip19.nprofileEncode({ pubkey: p, relays: [] }))).toBe(p);
    expect(parsePubkey(p.toUpperCase())).toBe(p);
  });

  it("refuses an nsec with a clear warning", () => {
    expect(() => parsePubkey(nip19.nsecEncode(generateSecretKey()))).toThrow(/私钥/);
  });

  it("rejects garbage", () => {
    expect(() => parsePubkey("npub1notreal")).toThrow(/不是有效/);
    expect(() => parsePubkey("")).toThrow();
  });

  it("shortens for display", () => {
    expect(shortNpub(pk())).toMatch(/^npub1[a-z0-9]{7}….{4}$/);
  });
});

describe("trust list edits", () => {
  it("adds, relabels without duplicating, and removes", () => {
    const a = pk();
    let list: TrustEntry[] = [];
    list = upsertTrust(list, a, "  老王  ", "manual", NOW);
    expect(list).toEqual([{ pubkey: a, label: "老王", added_at: NOW, source: "manual" }]);
    list = upsertTrust(list, a, "老王（记者）", "manual", "2026-11-26T00:00:00Z");
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("老王（记者）");
    expect(list[0].added_at).toBe(NOW);
    list = upsertTrust(list, a, "", "manual", NOW); // empty label keeps the old one
    expect(list[0].label).toBe("老王（记者）");
    expect(removeTrust(list, a)).toEqual([]);
  });

  it("a manual add promotes an imported entry", () => {
    const a = pk();
    let { list } = importTrust([], [a], "import:npub1x", NOW, null);
    expect(list[0].source).toBe("import:npub1x");
    list = upsertTrust(list, a, "小李", "manual", NOW);
    expect(list[0]).toMatchObject({ source: "manual", label: "小李" });
  });

  it("bulk import adds only new, valid keys and never yourself", () => {
    const a = pk();
    const b = pk();
    const self = pk();
    const start = upsertTrust([], a, "老王", "manual", NOW);
    const r = importTrust(start, [a, b, b, self, "nothex"], "import:npub1y", NOW, self);
    expect(r.added).toBe(1);
    expect(r.list.map((e) => e.pubkey)).toEqual([a, b]);
    expect(r.list[0].label).toBe("老王"); // existing label untouched
  });

  it("merges public follows only when enabled", () => {
    const a = pk();
    const f = pk();
    const list = upsertTrust([], a, "", "manual", NOW);
    expect([...trustedSet(list, new Set([f]), true)].sort()).toEqual([a, f].sort());
    expect([...trustedSet(list, new Set([f]), false)]).toEqual([a]);
  });

  it("exposes labels for display", () => {
    const a = pk();
    const b = pk();
    const list = upsertTrust(upsertTrust([], a, "老王", "manual", NOW), b, "", "manual", NOW);
    expect(labelsOf(list)).toEqual({ [a]: "老王" });
  });
});
