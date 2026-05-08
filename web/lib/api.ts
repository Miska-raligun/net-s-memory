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
