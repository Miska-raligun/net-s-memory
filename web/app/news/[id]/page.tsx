"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Loading from "@/components/Loading";
import {
  API_BASE,
  type Analysis,
  type EventDetail,
  type FollowupDevelopment,
  type FollowupRecord,
  type MergeProposal,
  type NewsDetail,
} from "@/lib/api";
import { authHeader } from "@/lib/auth";
import { getUser } from "@/lib/identity";
import { listEventProposals, submitProposal } from "@/lib/proposals";
import { formatDateTime } from "@/lib/time";
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
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [followup, setFollowup] = useState<FollowupRecord | null>(null);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [proposals, setProposals] = useState<MergeProposal[]>([]);

  async function loadEventChain(eventId: string) {
    const [evtR, fuR] = await Promise.all([
      fetch(`${API_BASE}/api/events/${eventId}`),
      fetch(`${API_BASE}/api/events/${eventId}/followup/latest`),
    ]);
    if (evtR.ok) setEvent(await evtR.json());
    if (fuR.ok) {
      const d = await fuR.json();
      if (d) setFollowup(d);
    }
    listEventProposals(eventId)
      .then(setProposals)
      .catch(() => {});
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/news/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        return r.json();
      })
      .then((d: NewsDetail) => {
        if (cancelled) return;
        setNews(d);
        if (d.event_id) loadEventChain(d.event_id);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));

    fetch(`${API_BASE}/api/news/${params.id}/analysis`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Analysis | null) => {
        if (!cancelled && d) setAnalysis(d);
      })
      .catch(() => undefined);

    fetchAggregate(params.id)
      .then((a) => !cancelled && setAggregate(a))
      .catch(() => undefined);
    fetchMyVote(params.id)
      .then((v) => !cancelled && setMyVote(v))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function onTrackFollowup() {
    if (!news) return;
    setTracking(true);
    setFollowupError(null);
    try {
      let eid = news.event_id;
      if (!eid) {
        const r = await fetch(`${API_BASE}/api/news/${params.id}/ensure-event`, {
          method: "POST",
          headers: authHeader(),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setFollowupError(`建立时间线失败 (${r.status}): ${body.detail ?? r.statusText}`);
          return;
        }
        eid = (await r.json()).event_id as string;
        setNews({ ...news, event_id: eid });
      }
      const fu = await fetch(`${API_BASE}/api/events/${eid}/followup`, {
        method: "POST",
        headers: authHeader(),
      });
      if (!fu.ok) {
        const body = await fu.json().catch(() => ({}));
        setFollowupError(`追踪失败 (${fu.status}): ${body.detail ?? fu.statusText}`);
        return;
      }
      setFollowup(await fu.json());
      await loadEventChain(eid);
    } catch (e) {
      setFollowupError((e as Error).message);
    } finally {
      setTracking(false);
    }
  }

  useEffect(() => {
    if (news) document.title = `${news.title} · 互联网记忆`;
  }, [news]);

  if (loadError) return <main><div className="fail">加载失败：{loadError}</div></main>;
  if (!news) return <main><Loading /></main>;

  const user = getUser();

  return (
    <main>
      <h1>{news.title}</h1>
      {news.classification && (
        <div className="detail-meta">
          分类: <strong style={{ color: "var(--text)" }}>{news.classification}</strong>
          {news.curator && <span> · 策展: {news.curator}</span>}
        </div>
      )}
      {news.summary && (
        <p style={{ fontSize: 15, color: "var(--text-dim)" }}>{news.summary}</p>
      )}
      {news.why_matters && (
        <div className="detail-why">
          <strong>为何记录:</strong> {news.why_matters}
        </div>
      )}
      <p className="detail-source">
        主要来源：
        <a href={news.source_url} target="_blank" rel="noreferrer">
          {news.source}
        </a>
        {" · "}采集时间 {formatDateTime(news.fetched_at)}
      </p>
      {news.citations && news.citations.length > 1 && (
        <details>
          <summary>共 {news.citations.length} 个来源</summary>
          <ul style={{ marginTop: 4 }}>
            {news.citations.map((c, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <a href={c.source_url} target="_blank" rel="noreferrer">
                  [{c.source}] {c.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!news.summary && (
        <article>{news.raw_text || "(无正文摘要)"}</article>
      )}

      <div style={{ marginTop: 16 }}>
        <button onClick={onVerify} disabled={verifying}>
          {verifying ? "验证中…" : "验证不可篡改"}
        </button>
      </div>

      {status?.ok && (
        <div className="ok">
          验证通过 — 该条记录的哈希与 Merkle 树根一致。
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
            <div>叶哈希: <code>{status.recomputedLeafHash}</code></div>
            <div>当前根: <code>{status.root}</code></div>
            <div>树规模: {status.treeSize}</div>
          </div>
        </div>
      )}
      {status && !status.ok && (
        <div className="fail">验证失败 — {status.reason}</div>
      )}

      <section style={{ marginTop: 28 }}>
        <h2>社区投票</h2>
        <VoteCard
          aggregate={aggregate}
          myVote={myVote}
          onVote={onVote}
          voting={voting}
          error={voteError}
        />
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>可信度评估</h2>
        {!analysis && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            尚未生成分析。这只是可信度信号，不代表真假判定。
          </p>
        )}
        {analysis && <CredibilityCard analysis={analysis} />}
        <button onClick={onAnalyze} disabled={analyzing} style={{ marginTop: 10 }}>
          {analyzing ? "分析中…" : analysis ? "重新分析" : "生成分析"}
        </button>
        {analysisError && <div className="fail">{analysisError}</div>}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>事件时间线</h2>
        {!event && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            目前还没有其他来源印证这条记录。
            点击下方"追踪后续"会为它建立独立时间线，
            未来再有同事件报道会被自动接续上来。
          </p>
        )}
        {event && (
          <ol className="timeline-list">
            {event.timeline.map((entry) => {
              const isSelf = entry.news.id === news.id;
              return (
                <li
                  key={entry.news.id}
                  className={`timeline-entry${isSelf ? " timeline-entry-active" : ""}`}
                >
                  <div className="timeline-kind">
                    [{entry.kind}]{" "}
                    {formatDateTime(entry.news.fetched_at)}
                    {" · "}
                    {entry.news.source}
                  </div>
                  {isSelf ? (
                    <span className="timeline-title">
                      {entry.news.title}{" "}
                      <span className="timeline-self">(本条)</span>
                    </span>
                  ) : (
                    <Link href={`/news/${entry.news.id}`} className="timeline-title">
                      {entry.news.title}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>追踪后续</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          让 AI 通过网络搜索整理本事件的后续发展。结果仅展示给你，
          不会写入公开时间线、也不会上链；你可以勾选可信的进展发起合入提案，
          通过社区表决后才会作为新条目加入时间线并签名上链。
        </p>
        {!user && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>登录后可发起追踪。</p>
        )}
        <button
          onClick={onTrackFollowup}
          disabled={!user || tracking}
          style={{ marginTop: 10 }}
        >
          {tracking
            ? "搜索中…"
            : followup
            ? "重新追踪后续"
            : news.event_id
            ? "追踪后续"
            : "建立时间线并追踪后续"}
        </button>
        {followupError && <div className="fail">{followupError}</div>}
        {followup && (
          <FollowupCard
            record={followup}
            onProposed={(p) => setProposals((prev) => [p, ...prev])}
          />
        )}

        {proposals.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3>已发起的合入提案</h3>
            <ul>
              {proposals.map((p) => (
                <li key={p.id} style={{ marginBottom: 6 }}>
                  <Link href={`/merge-proposals/${p.id}`}>
                    [{p.status}]{" "}
                    {p.selected_developments.map((d) => d.summary).join("; ")}
                  </Link>
                </li>
              ))}
            </ul>
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
    <div className="info-card">
      <div style={{ fontSize: 14, color: "var(--text-dim)" }}>
        {aggregate
          ? `共 ${aggregate.vote_count} 票，加权倾向 ${aggregate.weighted_score.toFixed(2)}（-1 到 +1）`
          : "尚无投票"}
      </div>
      {aggregate && aggregate.vote_count > 0 && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          支持 {aggregate.score_breakdown["1"] ?? 0} · 中立{" "}
          {aggregate.score_breakdown["0"] ?? 0} · 质疑{" "}
          {aggregate.score_breakdown["-1"] ?? 0}
        </div>
      )}
      {!user ? (
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}>
          登录后可对该记录投票，投票将由你的浏览器密钥签名后写入 Merkle 日志。
        </p>
      ) : hasVoted ? (
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-dim)" }}>
          你已投票：{labelForScore(myVote!.score)}
        </p>
      ) : (
        <div className="btn-group" style={{ marginTop: 8 }}>
          <button onClick={() => onVote(1)} disabled={voting}>支持</button>
          <button onClick={() => onVote(0)} disabled={voting}>中立</button>
          <button onClick={() => onVote(-1)} disabled={voting}>质疑</button>
        </div>
      )}
      {error && <div className="fail">{error}</div>}
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
    <div className="info-card">
      <div className="cred-score">
        可信度信号: {analysis.score}/100
      </div>
      <ul style={{ marginTop: 10, fontSize: 13, color: "var(--text-dim)" }}>
        <li style={{ marginBottom: 4 }}>
          多源印证: {analysis.corroboration_count} 家其他来源
          {analysis.corroboration_sources.length > 0 && (
            <span> ({analysis.corroboration_sources.join("、")})</span>
          )}
        </li>
        <li style={{ marginBottom: 4 }}>
          来源信誉: {analysis.reputation_label}
          （权重 {analysis.reputation_weight.toFixed(2)}）
        </li>
        <li style={{ marginBottom: 4 }}>
          LLM 一致性:{" "}
          {analysis.llm_consistency ?? "未运行"}
          {analysis.llm_score !== null && (
            <span> · 模型评分 {analysis.llm_score}/100</span>
          )}
          {analysis.llm_model && (
            <span style={{ color: "var(--text-muted)" }}> · {analysis.llm_model}</span>
          )}
        </li>
        {analysis.llm_summary && (
          <li style={{ color: "var(--text-dim)" }}>{analysis.llm_summary}</li>
        )}
      </ul>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
        此评分为可信度信号的加权汇总，不构成对事件真伪的最终判定。
      </p>
    </div>
  );
}

function FollowupCard({
  record,
  onProposed,
}: {
  record: FollowupRecord;
  onProposed: (p: MergeProposal) => void;
}) {
  const p = record.payload;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const user = getUser();

  function toggle(i: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function onPropose() {
    setSubmitting(true);
    setProposeError(null);
    try {
      const devs: FollowupDevelopment[] = Array.from(selected)
        .sort((a, b) => a - b)
        .map((i) => p.developments[i]);
      const result = await submitProposal(record.event_id, record.id, devs);
      onProposed(result);
      setSelected(new Set());
    } catch (e) {
      setProposeError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="info-card-dashed">
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        草稿 · {formatDateTime(record.generated_at)} ·
        来源 {record.search_provider} · 模型 {record.model} ·
        建议状态 {p.status_suggestion}
      </div>

      <h3>检索到的进展</h3>
      {p.developments.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>未发现满足 ≥2 来源的进展。</p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            勾选你认为可信的进展，发起合入提案后由社区表决，通过后写入时间线并上链。
          </p>
          <ul>
            {p.developments.map((d, i) => (
              <li key={i} style={{ marginBottom: 10 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                    disabled={!user}
                  />
                  <div>
                    <div style={{ fontSize: 14, color: "var(--text-dim)" }}>
                      [{d.date}] {d.summary}
                      <span style={{ marginLeft: 6, color: "var(--text-muted)", fontSize: 12 }}>
                        ({d.source_count} 来源)
                      </span>
                    </div>
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      {d.citations.map((c, j) => (
                        <span key={j} style={{ marginRight: 8 }}>
                          <a href={c} target="_blank" rel="noreferrer">[{j + 1}]</a>
                        </span>
                      ))}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          {user && (
            <button
              onClick={onPropose}
              disabled={submitting || selected.size === 0}
              style={{ marginTop: 8 }}
            >
              {submitting ? "提交中…" : `发起合入提案（${selected.size} 项）`}
            </button>
          )}
          {proposeError && <div className="fail">{proposeError}</div>}
        </>
      )}

      {p.leads.length > 0 && (
        <>
          <h3>线索（孤证 / 未达 2 来源）</h3>
          <ul style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {p.leads.map((l, i) => (
              <li key={i} style={{ marginBottom: 2 }}>{l}</li>
            ))}
          </ul>
        </>
      )}

      {p.still_unanswered.length > 0 && (
        <>
          <h3>仍未回答的问题</h3>
          <ul style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {p.still_unanswered.map((q, i) => (
              <li key={i} style={{ marginBottom: 2 }}>{q}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
