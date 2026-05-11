"use client";

import { useEffect, useState } from "react";

import { API_BASE, type Analysis, type NewsDetail } from "@/lib/api";
import { getUser } from "@/lib/identity";
import { type ProofResponse, type VerificationStatus, verifyProof } from "@/lib/verify";
import {
  type MyVote,
  type VoteAggregate,
  castVote,
  fetchAggregate,
  fetchMyVote,
} from "@/lib/vote";

export default function NewsPage({ params }: { params: { id: string } }) {
  const [news, setNews] = useState<NewsDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aggregate, setAggregate] = useState<VoteAggregate | null>(null);
  const [myVote, setMyVote] = useState<MyVote | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/news/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        return r.json();
      })
      .then((d: NewsDetail) => {
        if (!cancelled) setNews(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      });

    fetch(`${API_BASE}/api/news/${params.id}/analysis`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Analysis | null) => {
        if (!cancelled && d) setAnalysis(d);
      })
      .catch(() => {
        /* analysis is optional */
      });

    fetchAggregate(params.id)
      .then((a) => {
        if (!cancelled) setAggregate(a);
      })
      .catch(() => {
        /* ignore */
      });
    fetchMyVote(params.id)
      .then((v) => {
        if (!cancelled) setMyVote(v);
      })
      .catch(() => {
        /* ignore */
      });

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function onVote(score: number) {
    setVoting(true);
    setVoteError(null);
    try {
      await castVote(params.id, score, "");
      const [agg, me] = await Promise.all([
        fetchAggregate(params.id),
        fetchMyVote(params.id),
      ]);
      setAggregate(agg);
      setMyVote(me);
    } catch (e) {
      setVoteError((e as Error).message);
    } finally {
      setVoting(false);
    }
  }

  async function onAnalyze() {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const r = await fetch(`${API_BASE}/api/news/${params.id}/analysis`, {
        method: "POST",
      });
      if (!r.ok) {
        setAnalysisError(`分析失败：${r.status}`);
        return;
      }
      setAnalysis(await r.json());
    } catch (e) {
      setAnalysisError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function onVerify() {
    setVerifying(true);
    setStatus(null);
    try {
      const r = await fetch(`${API_BASE}/api/news/${params.id}/proof`);
      if (!r.ok) {
        setStatus({ ok: false, reason: `proof fetch failed: ${r.status}` });
        return;
      }
      const proof: ProofResponse = await r.json();
      const expected = news ? { title: news.title, raw_text: news.raw_text } : undefined;
      setStatus(await verifyProof(proof, expected));
    } catch (e) {
      setStatus({ ok: false, reason: (e as Error).message });
    } finally {
      setVerifying(false);
    }
  }

  if (loadError) return <main><div className="fail">加载失败：{loadError}</div></main>;
  if (!news) return <main><p>加载中…</p></main>;

  return (
    <main>
      <h1>{news.title}</h1>
      {news.classification && (
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
          分类: <strong>{news.classification}</strong>
          {news.curator && <span> · 策展: {news.curator}</span>}
        </div>
      )}
      {news.summary && (
        <p style={{ fontSize: 15, color: "#1f2937" }}>{news.summary}</p>
      )}
      {news.why_matters && (
        <p
          style={{
            fontSize: 13,
            color: "#374151",
            background: "#f9fafb",
            padding: 8,
            borderRadius: 4,
            borderLeft: "3px solid #6366f1",
          }}
        >
          <strong>为何记录:</strong> {news.why_matters}
        </p>
      )}
      <p style={{ fontSize: 13, color: "#6b7280" }}>
        主要来源：
        <a href={news.source_url} target="_blank" rel="noreferrer">
          {news.source}
        </a>
        {" · "}采集时间 {new Date(news.fetched_at).toLocaleString("zh-CN")}
      </p>
      {news.citations && news.citations.length > 1 && (
        <details style={{ fontSize: 13, marginTop: 8 }}>
          <summary>共 {news.citations.length} 个来源</summary>
          <ul style={{ marginTop: 4 }}>
            {news.citations.map((c, i) => (
              <li key={i}>
                <a href={c.source_url} target="_blank" rel="noreferrer">
                  [{c.source}] {c.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!news.summary && (
        <article style={{ marginTop: 12 }}>
          {news.raw_text || "(无正文摘要)"}
        </article>
      )}

      <button onClick={onVerify} disabled={verifying}>
        {verifying ? "验证中…" : "验证不可篡改"}
      </button>

      {status?.ok && (
        <div className="ok">
          ✅ 验证通过 — 该条记录的哈希与 Merkle 树根一致。
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <div>叶哈希: <code>{status.recomputedLeafHash}</code></div>
            <div>当前根: <code>{status.root}</code></div>
            <div>树规模: {status.treeSize}</div>
          </div>
        </div>
      )}
      {status && !status.ok && (
        <div className="fail">❌ 验证失败 — {status.reason}</div>
      )}

      <section style={{ marginTop: 24 }}>
        <h2>社区投票</h2>
        <VoteCard
          aggregate={aggregate}
          myVote={myVote}
          onVote={onVote}
          voting={voting}
          error={voteError}
        />
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>可信度评估</h2>
        {!analysis && (
          <p style={{ fontSize: 14, color: "#666" }}>
            尚未生成分析。这只是可信度信号，不代表真假判定。
          </p>
        )}
        {analysis && <CredibilityCard analysis={analysis} />}
        <button onClick={onAnalyze} disabled={analyzing} style={{ marginTop: 8 }}>
          {analyzing ? "分析中…" : analysis ? "重新分析" : "生成分析"}
        </button>
        {analysisError && (
          <div className="fail" style={{ marginTop: 8 }}>
            {analysisError}
          </div>
        )}
      </section>
    </main>
  );
}

function VoteCard({
  aggregate,
  myVote,
  onVote,
  voting,
  error,
}: {
  aggregate: VoteAggregate | null;
  myVote: MyVote | null;
  onVote: (score: number) => void;
  voting: boolean;
  error: string | null;
}) {
  const user = getUser();
  const hasVoted = myVote !== null;
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: 12,
        marginTop: 8,
      }}
    >
      <div style={{ fontSize: 14, color: "#444" }}>
        {aggregate
          ? `共 ${aggregate.vote_count} 票，加权倾向 ${aggregate.weighted_score.toFixed(2)}（-1 到 +1）`
          : "尚无投票"}
      </div>
      {aggregate && aggregate.vote_count > 0 && (
        <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
          支持 {aggregate.score_breakdown["1"] ?? 0} · 中立{" "}
          {aggregate.score_breakdown["0"] ?? 0} · 质疑{" "}
          {aggregate.score_breakdown["-1"] ?? 0}
        </div>
      )}
      {!user ? (
        <p style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
          登录后可对该记录投票，投票将由你的浏览器密钥签名后写入 Merkle 日志。
        </p>
      ) : hasVoted ? (
        <p style={{ marginTop: 8, fontSize: 13, color: "#444" }}>
          你已投票：{labelForScore(myVote!.score)}
        </p>
      ) : (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button onClick={() => onVote(1)} disabled={voting}>
            👍 支持
          </button>
          <button onClick={() => onVote(0)} disabled={voting}>
            😐 中立
          </button>
          <button onClick={() => onVote(-1)} disabled={voting}>
            👎 质疑
          </button>
        </div>
      )}
      {error && <div className="fail" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function labelForScore(s: number): string {
  if (s > 0) return "支持";
  if (s < 0) return "质疑";
  return "中立";
}

function CredibilityCard({ analysis }: { analysis: Analysis }) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: 12,
        marginTop: 8,
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 600 }}>
        可信度信号: {analysis.score}/100
      </div>
      <ul style={{ marginTop: 8, fontSize: 14 }}>
        <li>
          多源印证: {analysis.corroboration_count} 家其他来源
          {analysis.corroboration_sources.length > 0 && (
            <span> ({analysis.corroboration_sources.join("、")})</span>
          )}
        </li>
        <li>
          来源信誉: {analysis.reputation_label}
          （权重 {analysis.reputation_weight.toFixed(2)}）
        </li>
        <li>
          LLM 一致性:{" "}
          {analysis.llm_consistency ?? "未运行"}
          {analysis.llm_score !== null && (
            <span> · 模型评分 {analysis.llm_score}/100</span>
          )}
          {analysis.llm_model && (
            <span style={{ color: "#888" }}> · {analysis.llm_model}</span>
          )}
        </li>
        {analysis.llm_summary && (
          <li style={{ color: "#444" }}>{analysis.llm_summary}</li>
        )}
      </ul>
      <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
        此评分为可信度信号的加权汇总，不构成对事件真伪的最终判定。
      </p>
    </div>
  );
}
