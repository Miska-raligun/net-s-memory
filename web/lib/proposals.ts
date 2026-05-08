import { API_BASE, type FollowupDevelopment, type MergeProposal, type MergeProposalDetail } from "./api";
import { authHeader } from "./auth";
import { bytesToHex } from "./canonical";
import { getUser } from "./identity";
import { getSeed, signCanonical } from "./identity";

function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function uuidv4(): string {
  // crypto.randomUUID is available in modern browsers + Node 19+
  return crypto.randomUUID();
}

export async function submitProposal(
  event_id: string,
  followup_id: string,
  developments: FollowupDevelopment[],
): Promise<MergeProposal> {
  const user = getUser();
  const seed = getSeed();
  if (!user) throw new Error("未登录");
  if (!seed) throw new Error("未在本会话解锁私钥，请重新登录");

  const proposal_id = uuidv4();
  const proposed_at = isoNoMillis(new Date());
  const payload = {
    schema: "merge_proposal.v1",
    id: proposal_id,
    event_id,
    followup_id,
    proposer_id: user.id,
    selected_developments: developments,
    proposed_at,
  };
  const { sig } = await signCanonical(seed, payload);

  const r = await fetch(`${API_BASE}/api/events/${event_id}/merge-proposals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({
      proposal_id,
      followup_id,
      selected_developments: developments,
      proposed_at,
      sig: bytesToHex(sig),
    }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`提交合入提案失败 (${r.status}): ${body.detail ?? r.statusText}`);
  }
  return (await r.json()) as MergeProposal;
}

export async function fetchProposal(proposal_id: string): Promise<MergeProposalDetail> {
  const r = await fetch(`${API_BASE}/api/merge-proposals/${proposal_id}`);
  if (!r.ok) throw new Error(`load failed: ${r.status}`);
  return (await r.json()) as MergeProposalDetail;
}

export async function listEventProposals(event_id: string): Promise<MergeProposal[]> {
  const r = await fetch(`${API_BASE}/api/events/${event_id}/merge-proposals`);
  if (!r.ok) throw new Error(`load failed: ${r.status}`);
  return (await r.json()) as MergeProposal[];
}

export async function voteOnProposal(
  proposal_id: string,
  score: number,
): Promise<{ vote_id: string; proposal_status: string }> {
  const user = getUser();
  const seed = getSeed();
  if (!user) throw new Error("未登录");
  if (!seed) throw new Error("未在本会话解锁私钥");

  const voted_at = isoNoMillis(new Date());
  const canonical = {
    schema: "merge_proposal_vote.v1",
    proposal_id,
    user_id: user.id,
    score,
    voted_at,
  };
  const { sig } = await signCanonical(seed, canonical);

  const r = await fetch(`${API_BASE}/api/merge-proposals/${proposal_id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ score, voted_at, sig: bytesToHex(sig) }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`投票失败 (${r.status}): ${body.detail ?? r.statusText}`);
  }
  return (await r.json()) as { vote_id: string; proposal_status: string };
}
