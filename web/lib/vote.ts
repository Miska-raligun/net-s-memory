import { API_BASE } from "./api";
import { bytesToHex } from "./canonical";
import { authHeader, getUser } from "./auth";
import { getSeed, signCanonical } from "./identity";

export interface VoteAggregate {
  news_id: string;
  vote_count: number;
  score_breakdown: Record<string, number>;
  weighted_score: number;
}

export interface MyVote {
  id: string;
  score: number;
  reason: string;
  voted_at: string;
}

export async function castVote(
  news_id: string,
  score: number,
  reason: string,
): Promise<void> {
  const user = getUser();
  const seed = getSeed();
  if (!user) throw new Error("未登录");
  if (!seed) throw new Error("未在本会话解锁私钥，请重新登录");

  const voted_at = isoNoMillis(new Date());
  const payload = {
    schema: "vote.v1",
    news_id,
    user_id: user.id,
    score,
    reason,
    voted_at,
  };
  const { sig } = await signCanonical(seed, payload);

  const r = await fetch(`${API_BASE}/api/news/${news_id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ score, reason, voted_at, sig: bytesToHex(sig) }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`投票失败 (${r.status}): ${body.detail ?? r.statusText}`);
  }
}

export async function fetchAggregate(news_id: string): Promise<VoteAggregate> {
  const r = await fetch(`${API_BASE}/api/news/${news_id}/votes`);
  if (!r.ok) throw new Error(`load votes ${r.status}`);
  return (await r.json()) as VoteAggregate;
}

export async function fetchMyVote(news_id: string): Promise<MyVote | null> {
  const headers = authHeader();
  if (!headers.Authorization) return null;
  const r = await fetch(`${API_BASE}/api/news/${news_id}/vote/me`, { headers });
  if (!r.ok) return null;
  return (await r.json()) as MyVote | null;
}

function isoNoMillis(d: Date): string {
  // Match Python's "%Y-%m-%dT%H:%M:%SZ" exactly so the canonical bytes line up.
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
