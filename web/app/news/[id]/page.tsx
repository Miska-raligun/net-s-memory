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
import { formatDateTime, relativeTime } from "@/lib/time";
import { type ProofResponse, type VerificationStatus, verifyProof } from "@/lib/verify";
import {
  type MyVote,
  type VoteAggregate,
  castVote,
  fetchAggregate,
  fetchMyVote,
} from "@/lib/vote";

const CLASS_LABELS: Record<string, string> = {
  social: "社会",
  international: "国际",
  policy: "政策",
  judicial: "司法",
  science: "科技",
  economy: "经济",
  other: "其他",
};

function shortHash(h: string | undefined | null): string {
  if (!h) return "—";
  return h.length > 18 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h;
}

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
  const cls = news.classification;
  const sourceCount = news.citations?.length ?? 1;

  let verifyKind: "idle" | "busy" | "ok" | "fail" = "idle";
  if (verifying) verifyKind = "busy";
  else if (status?.ok) verifyKind = "ok";
  else if (status && !status.ok) verifyKind = "fail";

  return (
    <main className="main-wide">
      <div className="detail-layout">
        <div>
          {cls && (
            <div className="detail-meta">
              <span className={`badge badge-${cls}`}>{CLASS_LABELS[cls] ?? cls}</span>
              <span>{formatDateTime(news.fetched_at)}</span>
              {news.curator && (
                <>
                  <span className="sep">·</span>
                  <span>策展 {news.curator.replace(/^discover:|^llm:/, "")}</span>
                </>
              )}
            </div>
          )}
          <h1>{news.title}</h1>

          {news.summary && <p className="detail-summary">{news.summary}</p>}

          {news.why_matters && (
            <div className="detail-why">
              <span className="label">为何记录</span>
              {news.why_matters}
            </div>
          )}

          {!news.summary && news.raw_text && (
            <article>{news.raw_text}</article>
          )}

          <p className="detail-source">
            主要来源：
            <a href={news.source_url} target="_blank" rel="noreferrer">
              {news.source}
            </a>
          </p>
          {news.citations && news.citations.length > 1 && (
            <details>
              <summary>共 {news.citations.length} 个来源</summary>
              <ul>
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

          <section>
            <h2>不可篡改性验证</h2>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 }}>
              在浏览器内重算本条目的叶哈希，并核对 Merkle 树根是否匹配。
              一旦后端任何字段被偷偷改写，验证就会失败。
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button onClick={onVerify} disabled={verifying} className={verifyKind === "ok" ? "" : "btn-primary"}>
                {verifying ? "验证中…" : status?.ok ? "重新验证" : "验证不可篡改"}
              </button>
              {verifyKind !== "idle" && (
                <span className={`verify-pill is-${verifyKind}`}>
                  <span className="dot" />
                  {verifyKind === "busy" && "正在重算哈希…"}
                  {verifyKind === "ok" && "已验证 · 叶哈希与树根一致"}
                  {verifyKind === "fail" && "验证失败"}
                </span>
              )}
            </div>
            {status?.ok && (
              <div className="ok" style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", display: "grid", gap: 4 }}>
                  <div>叶哈希: <code>{status.recomputedLeafHash}</code></div>
                  <div>当前根: <code>{status.root}</code></div>
                  <div>树规模: {status.treeSize}</div>
                </div>
              </div>
            )}
            {status && !status.ok && (
              <div className="fail" style={{ marginTop: 10 }}>验证失败 — {status.reason}</div>
            )}
          </section>

          <section>
            <h2>社区投票</h2>
            <VoteCard
              aggregate={aggregate}
              myVote={myVote}
              onVote={onVote}
              voting={voting}
              error={voteError}
            />
          </section>

          <section>
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

          <section>
            <h2>事件时间线</h2>
            {!event && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                目前还没有其他来源印证这条记录。
                点击下方"追踪后续"会为它建立独立时间线，
                未来同事件的报道会被自动接续。
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
                        {entry.kind.toUpperCase()} · {formatDateTime(entry.news.fetched_at)} · {entry.news.source}
                      </div>
                      {isSelf ? (
                        <span className="timeline-title">
                          {entry.news.title}
                          <span className="timeline-self">本条</span>
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

          <section>
            <h2>追踪后续</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              让 AI 通过网络搜索整理本事件的后续发展。结果**仅展示给你**，
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
              className={user && !tracking ? "btn-primary" : ""}
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
        </div>

        <aside className="detail-rail">
          <div className="rail-card">
            <h3>存证状态</h3>
            <div className="rail-row">
              <span className="k">验证</span>
              <span className="v">
                {verifyKind === "ok" && <span style={{ color: "var(--green)" }}>已通过</span>}
                {verifyKind === "fail" && <span style={{ color: "var(--red-dim)" }}>失败</span>}
                {verifyKind === "busy" && <span style={{ color: "var(--accent-bright)" }}>验证中</span>}
                {verifyKind === "idle" && <span style={{ color: "var(--text-muted)" }}>未运行</span>}
              </span>
            </div>
            <div className="rail-row">
              <span className="k">分类</span>
              <span className="v">{cls ? (CLASS_LABELS[cls] ?? cls) : "—"}</span>
            </div>
            <div className="rail-row">
              <span className="k">来源数</span>
              <span className="v">{sourceCount}</span>
            </div>
            <div className="rail-row">
              <span className="k">采集时间</span>
              <span className="v" title={formatDateTime(news.fetched_at)}>
                {relativeTime(news.fetched_at)}
              </span>
            </div>
            {status?.ok && (
              <>
                <div className="rail-row">
                  <span className="k">叶哈希</span>
                  <span className="v">{shortHash(status.recomputedLeafHash)}</span>
                </div>
                <div className="rail-row">
                  <span className="k">树规模</span>
                  <span className="v">{status.treeSize}</span>
                </div>
              </>
            )}
            <div style={{ marginTop: 10 }}>
              <Link href="/transparency" style={{ fontSize: 12 }}>
                查看公链锚定 →
              </Link>
            </div>
          </div>

          {aggregate && aggregate.vote_count > 0 && (
            <div className="rail-card">
              <h3>社区投票</h3>
              <div className="rail-row">
                <span className="k">总票数</span>
                <span className="v">{aggregate.vote_count}</span>
              </div>
              <div className="rail-row">
                <span className="k">加权倾向</span>
                <span className="v">{aggregate.weighted_score.toFixed(2)}</span>
              </div>
            </div>
          )}

          {analysis && (
            <div className="rail-card">
              <h3>可信度信号</h3>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
                {analysis.score}
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 4 }}>/ 100</span>
              </div>
              <div className="cred-bar" style={{ marginTop: 8 }}>
                <div className="cred-bar-fill" style={{ width: `${analysis.score}%` }} />
              </div>
            </div>
          )}
        </aside>
      </div>
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
  const up = aggregate?.score_breakdown["1"] ?? 0;
  const neu = aggregate?.score_breakdown["0"] ?? 0;
  const down = aggregate?.score_breakdown["-1"] ?? 0;

  return (
    <div className="info-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div className="vote-group" role="group" aria-label="投票">
          <button
            className="vote-pill vote-up"
            onClick={() => onVote(1)}
            disabled={!user || voting || hasVoted}
            title="支持"
          >
            👍 支持 <span className="vote-pill-count">{up}</span>
          </button>
          <button
            className="vote-pill"
            onClick={() => onVote(0)}
            disabled={!user || voting || hasVoted}
            title="中立"
          >
            😐 中立 <span className="vote-pill-count">{neu}</span>
          </button>
          <button
            className="vote-pill vote-down"
            onClick={() => onVote(-1)}
            disabled={!user || voting || hasVoted}
            title="质疑"
          >
            👎 质疑 <span className="vote-pill-count">{down}</span>
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right" }}>
          {aggregate
            ? <>共 {aggregate.vote_count} 票 · 加权倾向 <code>{aggregate.weighted_score.toFixed(2)}</code></>
            : "尚无投票"}
        </div>
      </div>

      {!user ? (
        <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)" }}>
          登录后可投票。投票将由你浏览器内的 Ed25519 密钥签名并写入 Merkle 日志，
          服务器无法伪造你的投票。
        </p>
      ) : hasVoted ? (
        <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>
          你已投：<strong style={{ color: "var(--text)" }}>{labelForScore(myVote!.score)}</strong>
        </p>
      ) : null}
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
    <div className="cred-card">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="cred-score">{analysis.score}</span>
        <span className="cred-score-suffix">/ 100 可信度信号</span>
      </div>
      <div className="cred-bar">
        <div className="cred-bar-fill" style={{ width: `${analysis.score}%` }} />
      </div>
      <div className="cred-rows">
        <div className="cred-row">
          <span className="cred-row-key">多源印证</span>
          <span className="cred-row-val">
            {analysis.corroboration_count} 家
            {analysis.corroboration_sources.length > 0 && (
              <span className="cred-row-meta"> {analysis.corroboration_sources.join("、")}</span>
            )}
          </span>
        </div>
        <div className="cred-row">
          <span className="cred-row-key">来源信誉</span>
          <span className="cred-row-val">
            {analysis.reputation_label}{" "}
            <span className="cred-row-meta">权重 {analysis.reputation_weight.toFixed(2)}</span>
          </span>
        </div>
        <div className="cred-row">
          <span className="cred-row-key">LLM 一致性</span>
          <span className="cred-row-val">
            {analysis.llm_consistency ?? "未运行"}
            {analysis.llm_score !== null && (
              <span className="cred-row-meta"> · {analysis.llm_score}/100</span>
            )}
          </span>
        </div>
        {analysis.llm_model && (
          <div className="cred-row">
            <span className="cred-row-key">模型</span>
            <span className="cred-row-meta">{analysis.llm_model}</span>
          </div>
        )}
        {analysis.llm_summary && (
          <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "4px 0 0" }}>
            {analysis.llm_summary}
          </p>
        )}
      </div>
      <div className="cred-disclaim">
        此评分为可信度信号的加权汇总，不构成对事件真伪的最终判定。
      </div>
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
      <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
        DRAFT · {formatDateTime(record.generated_at)} · {record.search_provider} ·{" "}
        {record.model} · 建议状态 {p.status_suggestion}
      </div>

      <h3>检索到的进展</h3>
      {p.developments.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>未发现满足 ≥2 来源的进展。</p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            勾选你认为可信的进展，发起合入提案后由社区表决，通过后写入时间线并上链。
          </p>
          <ul style={{ marginTop: 10 }}>
            {p.developments.map((d, i) => (
              <li key={i} style={{ marginBottom: 12 }}>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                    disabled={!user}
                  />
                  <div>
                    <div style={{ fontSize: 14, color: "var(--text)" }}>
                      {d.summary}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, fontFamily: "var(--font-mono)" }}>
                      {d.date} · {d.source_count} 个独立来源
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      {d.citations.map((c, j) => (
                        <a key={j} href={c} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>
                          [{j + 1}]
                        </a>
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
              className={selected.size > 0 ? "btn-primary" : ""}
            >
              {submitting ? "提交中…" : `发起合入提案（${selected.size} 项）`}
            </button>
          )}
          {proposeError && <div className="fail">{proposeError}</div>}
        </>
      )}

      {p.leads.length > 0 && (
        <>
          <h3>线索 · 孤证或未达 2 来源</h3>
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
