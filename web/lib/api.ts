export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export interface NewsListItem {
  id: string;
  title: string;
  source: string;
  source_url: string;
  fetched_at: string;
  hot_rank: number | null;
  lang: string;
}

export interface NewsDetail extends NewsListItem {
  raw_text: string;
  source_id: string | null;
}

export interface Anchor {
  root_hash: string;
  leaf_count: number;
  anchored_at: string;
  ots_proof_uri: string | null;
  btc_block_height: number | null;
  polygon_tx_hash: string | null;
}

export interface Transparency {
  tree_size: number;
  root_hash: string | null;
  anchors: Anchor[];
}

export interface Analysis {
  id: string;
  news_id: string;
  score: number;
  corroboration_count: number;
  corroboration_sources: string[];
  reputation_label: string;
  reputation_weight: number;
  llm_score: number | null;
  llm_consistency: string | null;
  llm_summary: string | null;
  llm_model: string | null;
  generated_at: string;
  signer: string;
  alg: string;
}

export interface EventListItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: string;
  news_count: number;
  created_at: string;
  updated_at: string;
}

export interface EventTimelineEntry {
  kind: string;
  position: number;
  added_at: string;
  news: {
    id: string;
    source: string;
    source_url: string;
    title: string;
    raw_text: string;
    fetched_at: string;
  };
}

export interface EventDetail {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: string;
  created_at: string;
  updated_at: string;
  timeline: EventTimelineEntry[];
}

export interface FollowupDevelopment {
  date: string;
  summary: string;
  citations: string[];
  source_count: number;
}

export interface FollowupPayload {
  event_id: string;
  since: string;
  developments: FollowupDevelopment[];
  leads: string[];
  still_unanswered: string[];
  status_suggestion: string;
  search_results: {
    title: string;
    url: string;
    snippet: string;
    source: string;
    published_at: string | null;
  }[];
}

export interface FollowupRecord {
  id: string;
  event_id: string;
  requested_by: string | null;
  model: string;
  search_provider: string;
  status: string;
  generated_at: string;
  payload: FollowupPayload;
}

export interface MergeProposal {
  id: string;
  event_id: string;
  followup_id: string;
  proposed_by: string;
  selected_developments: FollowupDevelopment[];
  proposed_at: string;
  status: string;
  decided_at: string | null;
  pubkey: string;
  sig: string;
}

export interface MergeProposalDetail extends MergeProposal {
  aggregate: {
    vote_count: number;
    score_breakdown: Record<string, number>;
    weighted_score: number;
  };
}
