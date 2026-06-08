// Four-signal credibility scoring, mirroring backend/app/analyze/credibility.py
//   final 0-100 = corroboration(≤30) + reputation(≤30) + llm(≤30) + community(≤10)
//
// Differences from the server: corroboration and community arrive from the
// P2P layer (Nostr) instead of a database, and the LLM score is produced by
// the user's own key. When a signal is absent we fall back to the same
// neutral defaults the server uses, so scores stay comparable.

import type { ScoreBreakdown, SignalSet } from "./types";

export const CORROBORATION_MAX = 30;
export const REPUTATION_MAX = 30;
export const LLM_MAX = 30;
export const COMMUNITY_MAX = 10;
export const NEUTRAL_LLM_SCORE = 50;
export const NEUTRAL_COMMUNITY = 5;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function combineSignals(signals: SignalSet): ScoreBreakdown {
  const corroboration_score = Math.min(
    CORROBORATION_MAX,
    Math.max(0, signals.corroboration.count) * 8,
  );

  const reputation_score = Math.round(
    clamp(signals.reputation.weight, 0, 1) * REPUTATION_MAX,
  );

  const rawLlm =
    signals.llm.score === null ? NEUTRAL_LLM_SCORE : clamp(signals.llm.score, 0, 100);
  const llm_score = Math.round((rawLlm / 100) * LLM_MAX);

  const community_score =
    signals.community.weighted_score === null
      ? NEUTRAL_COMMUNITY
      : Math.round((clamp(signals.community.weighted_score, 0, 100) / 100) * COMMUNITY_MAX);

  const total =
    corroboration_score + reputation_score + llm_score + community_score;

  return { reputation_score, llm_score, corroboration_score, community_score, total };
}
