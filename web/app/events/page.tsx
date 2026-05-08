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
      <h1>事件时间线</h1>
      <p style={{ fontSize: 14, color: "#555" }}>
        当同一事件在 ≥ 3 个来源被报道时会自动归档为一个事件，后续新报道按时间顺序续接。
      </p>
      {events.length === 0 ? (
        <p>暂无聚合的事件。</p>
      ) : (
        <ul style={{ marginTop: 16, listStyle: "none", padding: 0 }}>
          {events.map((e) => (
            <li
              key={e.id}
              style={{ borderBottom: "1px solid #eee", padding: "12px 0" }}
            >
              <Link href={`/events/${e.id}`} style={{ fontSize: 16 }}>
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
          ))}
        </ul>
      )}
    </main>
  );
}
