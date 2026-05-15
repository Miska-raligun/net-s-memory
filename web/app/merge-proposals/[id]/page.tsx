"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Loading from "@/components/Loading";
import type { MergeProposalDetail } from "@/lib/api";
import { getUser } from "@/lib/identity";
import { fetchProposal, voteOnProposal } from "@/lib/proposals";
import { formatDateTime } from "@/lib/time";

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
  if (!p) return <main><Loading /></main>;

  const user = getUser();

  return (
    <main>
      <h1>合入提案</h1>
      <div className="detail-meta">
        事件：<Link href={`/events/${p.event_id}`}>{p.event_id}</Link> ·
        发起时间 {formatDateTime(p.proposed_at)} ·
        状态 <strong style={{ color: "var(--text)" }}>{p.status}</strong>
        {p.decided_at && (
          <> · 决定于 {formatDateTime(p.decided_at)}</>
        )}
      </div>

      <h2>选中合入的进展</h2>
      <ul>
        {p.selected_developments.map((d, i) => (
          <li key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 14, color: "var(--text-dim)" }}>
              [{d.date}] {d.summary}
            </div>
            <div style={{ fontSize: 12, marginTop: 2 }}>
              {d.citations.map((c, j) => (
                <span key={j} style={{ marginRight: 8 }}>
                  <a href={c} target="_blank" rel="noreferrer">[{j + 1}]</a>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <h2>社区表决</h2>
      <div className="info-card">
        <div style={{ fontSize: 14, color: "var(--text-dim)" }}>
          共 {p.aggregate.vote_count} 票，加权倾向{" "}
          {p.aggregate.weighted_score.toFixed(2)}（≥ 0.5 且 ≥3 票自动通过）
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          支持 {p.aggregate.score_breakdown["1"] ?? 0} · 中立{" "}
          {p.aggregate.score_breakdown["0"] ?? 0} · 反对{" "}
          {p.aggregate.score_breakdown["-1"] ?? 0}
        </div>

        {p.status === "voting" && user && (
          <div className="btn-group" style={{ marginTop: 12 }}>
            <button onClick={() => onVote(1)} disabled={voting}>支持</button>
            <button onClick={() => onVote(0)} disabled={voting}>中立</button>
            <button onClick={() => onVote(-1)} disabled={voting}>反对</button>
          </div>
        )}
        {p.status === "voting" && !user && (
          <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-muted)" }}>
            登录后可对该提案投票，投票将由你的浏览器密钥签名后入链。
          </p>
        )}
        {voteError && <div className="fail">{voteError}</div>}
      </div>
    </main>
  );
}
