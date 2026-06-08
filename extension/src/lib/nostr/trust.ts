// Web-of-trust weighting for community attestations.
//
// Sybil resistance without a central authority is hard; this is a pragmatic
// MVP. We reuse the user's NIP-02 follow graph: people you follow count at
// full weight, strangers are shown but heavily discounted. (Follow-of-follow
// decay and NIP-13 proof-of-work weighting are left for a later pass.)

import type { CommunitySignal } from "../types";
import type { ParsedAttestation } from "./attestation";

export const FOLLOW_WEIGHT = 1.0;
export const UNKNOWN_WEIGHT = 0.15;

/**
 * Collapse a set of attestations into one community signal. Keeps only the
 * latest attestation per author and excludes the user's own.
 */
export function computeCommunitySignal(
  attestations: ParsedAttestation[],
  follows: Set<string>,
  selfPubkey: string | null,
): CommunitySignal {
  const latestByAuthor = new Map<string, ParsedAttestation>();
  for (const a of attestations) {
    if (selfPubkey && a.pubkey === selfPubkey) continue;
    const prev = latestByAuthor.get(a.pubkey);
    if (!prev || a.created_at > prev.created_at) latestByAuthor.set(a.pubkey, a);
  }

  const list = [...latestByAuthor.values()];
  if (list.length === 0) return { count: 0, weighted_score: null };

  let weightSum = 0;
  let weightedScore = 0;
  for (const a of list) {
    const w = follows.has(a.pubkey) ? FOLLOW_WEIGHT : UNKNOWN_WEIGHT;
    weightSum += w;
    weightedScore += w * a.score;
  }

  return {
    count: list.length,
    weighted_score: weightSum > 0 ? Math.round(weightedScore / weightSum) : null,
  };
}
