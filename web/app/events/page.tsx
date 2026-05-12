"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE, type EventListItem } from "@/lib/api";

export default function EventsPage() {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/events`)
      .then((r) => {
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        return r.json();
      })
      .then(setEvents)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main><div className="fail">加载失败：{error}</div></main>;

  return (
    <main>
      <h1>多源印证的事件</h1>
      <p style={{ fontSize: 14, color: "#555" }}>
        当同一事件被 ≥3 个来源印证、或用户主动追踪时，
        系统会把这些记录聚合成一条事件时间线。
        点击进入的是该事件起点新闻，时间线 + 追踪后续 + 合入提案都在那一页。
      </p>
      {events.length === 0 ? (
        <p>暂无聚合的事件。</p>
      ) : (
        <ul style={{ marginTop: 16, listStyle: "none", padding: 0 }}>
          {events.map((e) => {
            const href = e.origin_news_id
              ? `/news/${e.origin_news_id}`
              : `/events/${e.id}`;
            return (
              <li
                key={e.id}
                style={{ borderBottom: "1px solid #eee", padding: "12px 0" }}
              >
                <Link href={href} style={{ fontSize: 16 }}>
                  {e.title}
                </Link>
                <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                  {e.news_count} 条记录 · 状态 {e.status} · 最新更新{" "}
                  {new Date(e.updated_at).toLocaleString("zh-CN")}
                </div>
                {e.summary && (
                  <div style={{ fontSize: 13, color: "#444", marginTop: 4 }}>
                    {e.summary}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
