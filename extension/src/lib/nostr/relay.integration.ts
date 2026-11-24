// End-to-end P2P loop against a minimal in-process NIP-01 relay.
//
// Excluded from the default `vitest run` (CI) because it needs a live
// websocket server; run with `npm run test:it`. It exercises the REAL
// modules — buildAttestation → publishEvent → queryAttestations →
// parseAttestation → queryFollows → computeCommunitySignal — so the relay
// glue in relay.ts is validated, not just the pure logic.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AddressInfo, WebSocketServer } from "ws";
import { bytesToHex } from "../canonical";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { buildAttestation, parseAttestation, urlAddress } from "./attestation";
import { publishEvent, queryAttestations, queryFollows } from "./relay";
import { computeCommunitySignal } from "./trust";
import type { ParsedAttestation } from "./attestation";
import type { Assessment } from "../types";

// --- minimal relay -------------------------------------------------------
interface Filter {
  kinds?: number[];
  authors?: string[];
  [tag: string]: unknown;
}

function keyFor(ev: { kind: number; pubkey: string; tags: string[][]; id: string }): string {
  if (ev.kind >= 30000 && ev.kind < 40000) {
    const d = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return `${ev.kind}:${ev.pubkey}:${d}`;
  }
  if (ev.kind === 3) return `${ev.kind}:${ev.pubkey}`;
  return ev.id;
}

function matches(ev: { kind: number; pubkey: string; tags: string[][] }, f: Filter): boolean {
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  for (const k of Object.keys(f)) {
    if (k.startsWith("#")) {
      const tag = k.slice(1);
      const vals = f[k] as string[];
      if (!ev.tags.some((t) => t[0] === tag && vals.includes(t[1]))) return false;
    }
  }
  return true;
}

function startRelay(): { url: string; close: () => void } {
  const wss = new WebSocketServer({ port: 0 });
  const store = new Map<string, { kind: number; pubkey: string; tags: string[][]; id: string }>();
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] === "EVENT") {
        const ev = msg[1];
        store.set(keyFor(ev), ev);
        ws.send(JSON.stringify(["OK", ev.id, true, ""]));
      } else if (msg[0] === "REQ") {
        const sub = msg[1];
        const filters = msg.slice(2) as Filter[];
        for (const ev of store.values()) {
          if (filters.some((f) => matches(ev, f))) ws.send(JSON.stringify(["EVENT", sub, ev]));
        }
        ws.send(JSON.stringify(["EOSE", sub]));
      }
    });
  });
  const port = (wss.address() as AddressInfo).port;
  return { url: `ws://127.0.0.1:${port}`, close: () => wss.close() };
}

// --- fixtures ------------------------------------------------------------
function assessment(url: string, score: number): Assessment {
  return {
    schema: "assessment.v1",
    url,
    domain: "example.com",
    title: "t",
    score,
    breakdown: { reputation_score: 0, llm_score: 0, corroboration_score: 0, community_score: 0, total: score },
    signals: {
      reputation: { label: "medium", weight: 0.5, matched_domain: null },
      llm: { score, consistency: "high", summary: "ok", model: "m" },
      corroboration: { count: 0, sources: [] },
      community: { count: 0, weighted_score: null },
    },
    generated_at: "2026-06-05T00:00:00Z",
    llm_used: true,
  };
}

let relay: { url: string; close: () => void };
beforeAll(() => {
  relay = startRelay();
});
afterAll(() => relay.close());

describe("nostr relay round-trip", () => {
  it("publishes two attestations, queries them, and trust-weights the result", async () => {
    const url = "https://example.com/article-1";
    const relays = [relay.url];

    const skA = bytesToHex(generateSecretKey());
    const skB = bytesToHex(generateSecretKey());
    const pkA = getPublicKey(Uint8Array.from(skA.match(/../g)!.map((h) => parseInt(h, 16))));

    const evA = await buildAttestation(assessment(url, 95), skA);
    const evB = await buildAttestation(assessment(url, 20), skB);
    const rA = await publishEvent(relays, evA);
    const rB = await publishEvent(relays, evB);
    expect(rA.ok).toBe(1);
    expect(rB.ok).toBe(1);

    const addr = await urlAddress(url);
    const events = await queryAttestations(relays, addr);
    const parsed = events.map(parseAttestation).filter((p): p is ParsedAttestation => p !== null);
    expect(parsed).toHaveLength(2);

    // A viewer who follows A should weight A's high score far above B's.
    const skViewerBytes = generateSecretKey();
    const skViewer = bytesToHex(skViewerBytes);
    const viewerPk = getPublicKey(skViewerBytes);
    // publish a kind:3 contact list for the viewer following A
    const { finalizeEvent } = await import("nostr-tools");
    const follow = finalizeEvent(
      { kind: 3, created_at: Math.floor(Date.now() / 1000), tags: [["p", pkA]], content: "" },
      Uint8Array.from(skViewer.match(/../g)!.map((h) => parseInt(h, 16))),
    );
    await publishEvent(relays, follow);

    const follows = await queryFollows(relays, viewerPk);
    expect(follows.has(pkA)).toBe(true);

    const signal = computeCommunitySignal(parsed, follows, viewerPk);
    expect(signal.count).toBe(2);
    // weighted: (1.0*95 + 0.15*20) / 1.15 ≈ 85 — much closer to A
    expect(signal.weighted_score).toBeGreaterThan(80);
  });
});
