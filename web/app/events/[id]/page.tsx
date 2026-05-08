"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE, type EventDetail, type FollowupRecord } from "@/lib/api";
import { authHeader } from "@/lib/auth";
import { getUser } from "@/lib/identity";

export default function EventPage({ params }: { params: { id: string } }) {
  const [evt, setEvt] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [followup, setFollowup] = useState<FollowupRecord | null>(null);
  const [tracking, setTracking] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/events/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        return r.json();
      })
      .then(setEvt)
      .catch((e: Error) => setError(e.message));

    fetch(`${API_BASE}/api/events/${params.id}/followup/latest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FollowupRecord | null) => {
        if (d) setFollowup(d);
      })
      .catch(() => {
        /* optional */
      });
  }, [params.id]);

  async function onTrack() {
    setTracking(true);
    setFollowupError(null);
    try {
      const r = await fetch(`${API_BASE}/api/events/${params.id}/followup`, {
        method: "POST",
        headers: { ...authHeader() },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setFollowupError(`追踪失败 (${r.status}): ${body.detail ?? r.statusText}`);
        return;
      }
      setFollowup(await r.json());
    } catch (e) {
      setFollowupError((e as Error).message);
    } finally {
      setTracking(false);
    }
  }

  if (error) return <main><div className="fail">加载失败：{error}</div></main>;
  if (!evt) return <main><p>加载中…</p></main>;

  const user = getUser();

  return (
    <main>
      <h1>{evt.title}</h1>
      <div style={{ fontSize: 13, color: "#666" }}>
        状态：{evt.status} · 起点 {new Date(evt.created_at).toLocaleString("zh-CN")}
      </div>
      {evt.summary && <p style={{ marginTop: 12 }}>{evt.summary}</p>}

      <h2 style={{ marginTop: 24 }}>时间线</h2>
      <ol style={{ marginTop: 8, paddingLeft: 24 }}>
        {evt.timeline.map((entry) => (
          <li key={entry.news.id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#888" }}>
              [{entry.kind}] {new Date(entry.news.fetched_at).toLocaleString("zh-CN")}
              {" · "}
              {entry.news.source}
            </div>
            <Link href={`/news/${entry.news.id}`} style={{ fontSize: 15 }}>
              {entry.news.title}
            </Link>
            {entry.news.raw_text && (
              <div style={{ fontSize: 13, color: "#444", marginTop: 4 }}>
                {entry.news.raw_text.slice(0, 200)}
                {entry.news.raw_text.length > 200 ? "…" : ""}
              </div>
            )}
          </li>
        ))}
      </ol>

      <section style={{ marginTop: 32 }}>
        <h2>追踪后续</h2>
        <p style={{ fontSize: 14, color: "#555" }}>
          点击按钮让 AI 通过网络搜索整理事件后续。
          结果**仅展示给你本人**，未写入时间线、未上链；
          如你认为某条进展可信，可以在下一步发起合入提案，由社区表决后再进入公开时间线并上链。
        </p>
        {!user && (
          <p style={{ fontSize: 13, color: "#888" }}>
            登录后可发起追踪。
          </p>
        )}
        <button onClick={onTrack} disabled={!user || tracking} style={{ marginTop: 8 }}>
          {tracking ? "搜索中…" : followup ? "重新追踪" : "追踪后续"}
        </button>
        {followupError && (
          <div className="fail" style={{ marginTop: 8 }}>{followupError}</div>
        )}
        {followup && <FollowupCard record={followup} />}
      </section>
    </main>
  );
}

function FollowupCard({ record }: { record: FollowupRecord }) {
  const p = record.payload;
  return (
    <div
      style={{
        marginTop: 12,
        border: "1px dashed #aaa",
        borderRadius: 6,
        padding: 12,
        background: "#fafafa",
      }}
    >
      <div style={{ fontSize: 12, color: "#888" }}>
        草稿 · {new Date(record.generated_at).toLocaleString("zh-CN")} ·
        来源 {record.search_provider} · 模型 {record.model} ·
        建议状态 {p.status_suggestion}
      </div>

      <h3 style={{ marginTop: 12 }}>检索到的进展</h3>
      {p.developments.length === 0 ? (
        <p style={{ fontSize: 13, color: "#888" }}>未发现满足 ≥2 来源的进展。</p>
      ) : (
        <ul>
          {p.developments.map((d, i) => (
            <li key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 14 }}>
                [{d.date}] {d.summary}
                <span style={{ marginLeft: 6, color: "#888", fontSize: 12 }}>
                  ({d.source_count} 来源)
                </span>
              </div>
              <div style={{ fontSize: 12 }}>
                {d.citations.map((c, j) => (
                  <span key={j} style={{ marginRight: 8 }}>
                    <a href={c} target="_blank" rel="noreferrer">
                      [{j + 1}]
                    </a>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {p.leads.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>线索（孤证 / 未达 2 来源）</h3>
          <ul style={{ fontSize: 13, color: "#666" }}>
            {p.leads.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </>
      )}

      {p.still_unanswered.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>仍未回答的问题</h3>
          <ul style={{ fontSize: 13 }}>
            {p.still_unanswered.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
