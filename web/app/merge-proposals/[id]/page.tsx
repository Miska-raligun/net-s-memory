"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { MergeProposalDetail } from "@/lib/api";
import { getUser } from "@/lib/identity";
import { fetchProposal, voteOnProposal } from "@/lib/proposals";

export default function ProposalPage({ params }: { params: { id: string } }) {
  const [p, setP] = useState<MergeProposalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  async function load() {
    try {
      setP(await fetchProposal(params.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function onVote(score: number) {
    setVoting(true);
    setVoteError(null);
    try {
      await voteOnProposal(params.id, score);
      await load();
    } catch (e) {
      setVoteError((e as Error).message);
    } finally {
      setVoting(false);
    }
  }

  if (error) return <main><div className="fail">加载失败：{error}</div></main>;
  if (!p) return <main><p>加载中…</p></main>;

  const user = getUser();

  return (
    <main>
      <h1>合入提案</h1>
      <div style={{ fontSize: 13, color: "#666" }}>
        事件：<Link href={`/events/${p.event_id}`}>{p.event_id}</Link> ·
        发起时间 {new Date(p.proposed_at).toLocaleString("zh-CN")} ·
        状态 <strong>{p.status}</strong>
        {p.decided_at && (
          <> · 决定于 {new Date(p.decided_at).toLocaleString("zh-CN")}</>
        )}
      </div>

      <h2 style={{ marginTop: 16 }}>选中合入的进展</h2>
      <ul>
        {p.selected_developments.map((d, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            <div>
              [{d.date}] {d.summary}
            </div>
            <div style={{ fontSize: 12 }}>
              {d.citations.map((c, j) => (
                <span key={j} style={{ marginRight: 8 }}>
                  <a href={c} target="_blank" rel="noreferrer">[{j + 1}]</a>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <h2 style={{ marginTop: 24 }}>社区表决</h2>
      <div style={{ fontSize: 14 }}>
        共 {p.aggregate.vote_count} 票，加权倾向{" "}
        {p.aggregate.weighted_score.toFixed(2)}（≥ 0.5 且 ≥3 票自动通过）
      </div>
      <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
        支持 {p.aggregate.score_breakdown["1"] ?? 0} · 中立{" "}
        {p.aggregate.score_breakdown["0"] ?? 0} · 反对{" "}
        {p.aggregate.score_breakdown["-1"] ?? 0}
      </div>

      {p.status === "voting" && user && (
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button onClick={() => onVote(1)} disabled={voting}>
            👍 支持
          </button>
          <button onClick={() => onVote(0)} disabled={voting}>
            😐 中立
          </button>
          <button onClick={() => onVote(-1)} disabled={voting}>
            👎 反对
          </button>
        </div>
      )}
      {p.status === "voting" && !user && (
        <p style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
          登录后可对该提案投票，投票将由你的浏览器密钥签名后入链。
        </p>
      )}
      {voteError && <div className="fail" style={{ marginTop: 8 }}>{voteError}</div>}
    </main>
  );
}
