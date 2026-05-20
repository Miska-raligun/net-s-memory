"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import SkeletonFeed from "@/components/SkeletonFeed";
import { API_BASE, type EventListItem } from "@/lib/api";
import { relativeTime } from "@/lib/time";

const STATUS_LABEL: Record<string, string> = {
  ongoing: "进行中",
  stalled: "烂尾",
  resolved: "已结案",
  retracted: "已撤回",
};

const STATUS_COLOR: Record<string, string> = {
  ongoing: "var(--accent-bright)",
  stalled: "var(--amber)",
  resolved: "var(--green)",
  retracted: "var(--text-muted)",
};

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
      <h1>事件聚合</h1>
      <p className="desc-block">
        当同一事件被多源印证、或用户主动追踪时，相关记录会被聚合为一条事件时间线。
        点击进入的是事件起点新闻，时间线、追踪后续、合入提案都在那一页。
      </p>

      {error && <div className="fail">加载失败：{error}</div>}
      {loading && <SkeletonFeed count={5} />}
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "1px 7px",
                    borderRadius: 3,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    color: STATUS_COLOR[e.status] ?? "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
                <Link href={href} className="news-title">
                  {e.title}
                </Link>
              </div>
              {e.summary && <div className="news-summary">{e.summary}</div>}
              <div className="news-meta">
                <span>{e.news_count} 条记录</span>
                <span className="sep">·</span>
                <span title={new Date(e.updated_at).toLocaleString("zh-CN")}>
                  最近更新 {relativeTime(e.updated_at)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
