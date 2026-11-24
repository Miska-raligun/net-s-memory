// Shared data shapes for the credibility extension.
//
// `Assessment` mirrors the server's `Analysis` (web/lib/api.ts) closely so
// the UI and any future bridge to net-s-memory stay byte-compatible, but it
// is produced entirely client-side.

export type ReputationLabel = "high" | "medium" | "low" | "unknown";
export type Consistency = "high" | "medium" | "low" | "contradictory" | "unknown";

export interface ReputationSignal {
  label: ReputationLabel;
  /** weight in [0, 1] */
  weight: number;
  /** domain the reputation was matched against, for transparency */
  matched_domain: string | null;
}

export interface LlmSignal {
  /** 0-100, or null when no LLM key is configured / call failed */
  score: number | null;
  consistency: Consistency;
  summary: string;
  model: string | null;
}

export interface CorroborationSignal {
  count: number;
  sources: string[];
}

/** Weighted community signal derived from Nostr attestations (Phase 2+). */
export interface CommunitySignal {
  /** number of distinct signers seen */
  count: number;
  /** trust-weighted mean score in [0, 100], or null when none */
  weighted_score: number | null;
}

export interface SignalSet {
  reputation: ReputationSignal;
  llm: LlmSignal;
  corroboration: CorroborationSignal;
  community: CommunitySignal;
}

export interface ScoreBreakdown {
  reputation_score: number;
  llm_score: number;
  corroboration_score: number;
  community_score: number;
  total: number;
}

/** The full, displayable credibility assessment for one article. */
export interface Assessment {
  schema: "assessment.v1";
  /** normalized URL the assessment addresses */
  url: string;
  domain: string;
  title: string;
  score: number;
  breakdown: ScoreBreakdown;
  signals: SignalSet;
  /** ISO-8601 UTC */
  generated_at: string;
  /** whether the LLM signal was actually produced */
  llm_used: boolean;
}

export interface LlmConfig {
  /** "openai" (OpenAI-compatible chat completions) or "anthropic" */
  provider: "openai" | "anthropic";
  base_url: string;
  api_key: string;
  model: string;
}
