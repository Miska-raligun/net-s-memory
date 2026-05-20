"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Loading from "@/components/Loading";
import type { MergeProposalDetail } from "@/lib/api";
import { getUser } from "@/lib/identity";
import { fetchProposal, voteOnProposal } from "@/lib/proposals";
import { formatDateTime, relativeTime } from "@/lib/time";

const STATUS_LABEL: Record<string, string> = {
  voting: "表决中",
  passed: "已通过",
  rejected: "已驳回",
};

const STATUS_COLOR: Record<string, string> = {
  voting: "var(--amber)",
  passed: "var(--green)",
  rejected: "var(--red-dim)",
};

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
  const up = p.aggregate.score_breakdown["1"] ?? 0;
  const neu = p.aggregate.score_breakdown["0"] ?? 0;
  const down = p.aggregate.score_breakdown["-1"] ?? 0;
  const meta = p.aggregate.vote_count;

  return (
    <main>
      <h1>合入提案</h1>
      <div className="detail-meta">
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 8px",
            borderRadius: 4,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            color: STATUS_COLOR[p.status] ?? "var(--text-dim)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {STATUS_LABEL[p.status] ?? p.status}
        </span>
        <span>事件：<Link href={`/events/${p.event_id}`}>查看时间线</Link></span>
        <span className="sep">·</span>
        <span title={formatDateTime(p.proposed_at)}>发起 {relativeTime(p.proposed_at)}</span>
        {p.decided_at && (
          <>
            <span className="sep">·</span>
            <span title={formatDateTime(p.decided_at)}>决定 {relativeTime(p.decided_at)}</span>
          </>
        )}
      </div>

      <h2>选中合入的进展</h2>
      <div className="info-card">
        <ul style={{ display: "grid", gap: 14 }}>
          {p.selected_developments.map((d, i) => (
            <li key={i} style={{ borderLeft: "2px solid var(--accent)", paddingLeft: 12 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {d.date} · {d.source_count} 个独立来源
              </div>
              <div style={{ fontSize: 14, color: "var(--text)", marginTop: 4, lineHeight: 1.7 }}>
                {d.summary}
              </div>
              <div style={{ fontSize: 12, marginTop: 6 }}>
                {d.citations.map((c, j) => (
                  <a key={j} href={c} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>
                    [{j + 1}]
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <h2>社区表决</h2>
      <div className="info-card">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
              {p.aggregate.weighted_score.toFixed(2)}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>
              加权倾向（≥ 0.5 且 ≥ 3 票自动通过）
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>共 {meta} 票</div>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 13, color: "var(--text-dim)" }}>
          <span><span style={{ color: "var(--green)" }}>支持</span> {up}</span>
          <span><span style={{ color: "var(--text-muted)" }}>中立</span> {neu}</span>
          <span><span style={{ color: "var(--red-dim)" }}>反对</span> {down}</span>
        </div>

        {p.status === "voting" && user && (
          <div className="vote-group" style={{ marginTop: 14 }}>
            <button className="vote-pill vote-up" onClick={() => onVote(1)} disabled={voting}>
              👍 支持
            </button>
            <button className="vote-pill" onClick={() => onVote(0)} disabled={voting}>
              😐 中立
            </button>
            <button className="vote-pill vote-down" onClick={() => onVote(-1)} disabled={voting}>
              👎 反对
            </button>
          </div>
        )}
        {p.status === "voting" && !user && (
          <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--text-muted)" }}>
            登录后可对该提案投票，投票将由你的浏览器密钥签名后入链。
          </p>
        )}
        {voteError && <div className="fail">{voteError}</div>}
      </div>
    </main>
  );
}
