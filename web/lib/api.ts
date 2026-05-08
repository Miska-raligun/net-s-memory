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
