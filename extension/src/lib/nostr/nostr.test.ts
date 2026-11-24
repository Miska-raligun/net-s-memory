import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "../canonical";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import {
  ATTESTATION_KIND,
  buildAttestation,
  parseAttestation,
  urlAddress,
} from "./attestation";
import { computeCommunitySignal, FOLLOW_WEIGHT, UNKNOWN_WEIGHT } from "./trust";
import type { ParsedAttestation } from "./attestation";
import type { Assessment } from "../types";

function fakeAssessment(score: number): Assessment {
  return {
    schema: "assessment.v1",
    url: "https://example.com/a",
    domain: "example.com",
    title: "t",
    score,
    breakdown: {
      reputation_score: 0,
      llm_score: 0,
      corroboration_score: 0,
      community_score: 0,
      total: score,
    },
    signals: {
      reputation: { label: "medium", weight: 0.5, matched_domain: null },
      llm: { score: 70, consistency: "high", summary: "ok", model: "m" },
      corroboration: { count: 0, sources: [] },
      community: { count: 0, weighted_score: null },
    },
    generated_at: "2026-06-05T00:00:00Z",
    llm_used: true,
  };
}

describe("attestation", () => {
  it("signs and verifies a round-trip", async () => {
    const skHex = bytesToHex(generateSecretKey());
    const ev = await buildAttestation(fakeAssessment(82), skHex);
    expect(ev.kind).toBe(ATTESTATION_KIND);

    const parsed = parseAttestation(ev);
    expect(parsed).not.toBeNull();
    expect(parsed!.score).toBe(82);
    expect(parsed!.domain).toBe("example.com");
    expect(parsed!.pubkey).toBe(getPublicKey(hexToBytes(skHex)));
  });

  it("rejects a tampered event", async () => {
    const skHex = bytesToHex(generateSecretKey());
    const ev = await buildAttestation(fakeAssessment(50), skHex);
    // Rebuild as a plain object literal so nostr-tools' cached
    // "already-verified" symbol is dropped and the sig is re-checked.
    const tampered = {
      id: ev.id,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      kind: ev.kind,
      tags: ev.tags,
      sig: ev.sig,
      content: ev.content.replace('"score":50', '"score":99'),
    };
    expect(parseAttestation(tampered)).toBeNull();
  });

  it("derives a stable 32-char address from a URL", async () => {
    const a = await urlAddress("https://example.com/a");
    const b = await urlAddress("https://example.com/a");
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });
});

function att(pubkey: string, score: number, created_at = 1000): ParsedAttestation {
  return {
    pubkey,
    created_at,
    url: "u",
    domain: "d",
    score,
    content: {
      schema: "nsm-attestation.v1",
      url: "u",
      domain: "d",
      score,
      reputation: { label: "medium", weight: 0.5 },
      llm: { score, consistency: "high", model: null },
      summary: "",
    },
  };
}

describe("computeCommunitySignal", () => {
  it("returns null score when there are no attestations", () => {
    expect(computeCommunitySignal([], new Set(), null)).toEqual({
      count: 0,
      weighted_score: null,
    });
  });

  it("excludes the user's own attestation", () => {
    const sig = computeCommunitySignal([att("me", 90)], new Set(), "me");
    expect(sig.count).toBe(0);
  });

  it("keeps only the latest attestation per author", () => {
    const sig = computeCommunitySignal(
      [att("a", 10, 1000), att("a", 80, 2000)],
      new Set(),
      null,
    );
    expect(sig.count).toBe(1);
    expect(sig.weighted_score).toBe(80);
  });

  it("weights followed signers above strangers", () => {
    // followed=100 (w=1.0), stranger=0 (w=0.15) → 100/1.15 ≈ 87
    const sig = computeCommunitySignal(
      [att("friend", 100), att("rando", 0)],
      new Set(["friend"]),
      null,
    );
    expect(sig.count).toBe(2);
    const expected = Math.round((FOLLOW_WEIGHT * 100 + UNKNOWN_WEIGHT * 0) / (FOLLOW_WEIGHT + UNKNOWN_WEIGHT));
    expect(sig.weighted_score).toBe(expected);
  });
});
