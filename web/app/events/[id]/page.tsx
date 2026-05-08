"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE, type EventDetail } from "@/lib/api";

export default function EventPage({ params }: { params: { id: string } }) {
  const [evt, setEvt] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/events/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        return r.json();
      })
      .then(setEvt)
      .catch((e: Error) => setError(e.message));
  }, [params.id]);

  if (error) return <main><div className="fail">加载失败：{error}</div></main>;
  if (!evt) return <main><p>加载中…</p></main>;

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
    </main>
  );
}
