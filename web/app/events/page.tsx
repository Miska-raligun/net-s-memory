"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Loading from "@/components/Loading";
import { API_BASE, type EventListItem } from "@/lib/api";
import { relativeTime } from "@/lib/time";

export default function EventsPage() {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/events`)
      .then((r) => {
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        return r.json();
      })
      .then(setEvents)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main>
      <h1>多源印证的事件</h1>
      <p className="desc-block">
        当同一事件被多个来源印证或用户主动追踪时，系统将这些记录聚合为事件时间线。
      </p>
      {error && <div className="fail">加载失败：{error}</div>}
      {loading && <Loading />}
      {!loading && !error && events.length === 0 && (
        <div className="empty-state">暂无聚合事件</div>
      )}
      <div>
        {events.map((e) => {
          const href = e.origin_news_id
            ? `/news/${e.origin_news_id}`
            : `/events/${e.id}`;
          return (
            <div key={e.id} className="news-item">
              <Link href={href} className="news-title">
                {e.title}
              </Link>
              <div className="news-meta" style={{ marginTop: 6 }}>
                <span>{e.news_count} 条记录</span>
                <span>·</span>
                <span>{e.status}</span>
                <span>·</span>
                <span title={new Date(e.updated_at).toLocaleString("zh-CN")}>
                  {relativeTime(e.updated_at)}
                </span>
              </div>
              {e.summary && (
                <div className="news-summary">{e.summary}</div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
