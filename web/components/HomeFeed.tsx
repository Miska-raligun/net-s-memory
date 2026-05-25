"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { NewsListItem } from "@/lib/api";
import { relativeTime } from "@/lib/time";

import FilterChips, { type ChipOption } from "./FilterChips";

const CLASS_LABELS: Record<string, string> = {
  social: "社会",
  international: "国际",
  policy: "政策",
  judicial: "司法",
  science: "科技",
  economy: "经济",
  other: "其他",
};

const CLASS_ORDER = [
  "social",
  "international",
  "policy",
  "judicial",
  "economy",
  "science",
  "other",
];

function ClassBadge({ cls }: { cls: string | null }) {
  if (!cls) return null;
  const label = CLASS_LABELS[cls] ?? cls;
  return <span className={`badge badge-${cls}`}>{label}</span>;
}

function formatCurator(curator: string | null, source: string): string {
  if (!curator) return source;
  const cleaned = curator.replace(/^discover:/, "").replace(/^llm:/, "");
  const parts = cleaned.split("/");
  return parts.length > 1 ? parts[parts.length - 1] : cleaned;
}

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = startOfDay.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (diffMs <= 0) return "今天";
  if (diffMs <= dayMs) return "昨天";
  if (diffMs < 7 * dayMs) return "本周";
  if (diffMs < 30 * dayMs) return "本月";
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
}

export default function HomeFeed({ news }: { news: NewsListItem[] }) {
  const [filter, setFilter] = useState<string>("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: news.length };
    for (const n of news) {
      const k = n.classification ?? "other";
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [news]);

  const options: ChipOption[] = useMemo(() => {
    const base: ChipOption[] = [{ value: "all", label: "全部", count: counts.all }];
    for (const k of CLASS_ORDER) {
      if (counts[k]) base.push({ value: k, label: CLASS_LABELS[k] ?? k, count: counts[k] });
    }
    return base;
  }, [counts]);

  const filtered = useMemo(
    () => (filter === "all" ? news : news.filter((n) => n.classification === filter)),
    [news, filter],
  );

  const grouped = useMemo(() => {
    const groups: Array<{ key: string; items: NewsListItem[] }> = [];
    for (const n of filtered) {
      const k = dayBucket(n.fetched_at);
      const last = groups[groups.length - 1];
      if (last && last.key === k) last.items.push(n);
      else groups.push({ key: k, items: [n] });
    }
    return groups;
  }, [filtered]);

  if (news.length === 0) return null;

  return (
    <>
      <FilterChips options={options} value={filter} onChange={setFilter} />
      {filtered.length === 0 ? (
        <div className="empty-state">该分类暂无记录</div>
      ) : (
        grouped.map(({ key, items }) => (
          <section key={key}>
            <div className="date-divider">
              <span>{key}</span>
            </div>
            {items.map((n) => (
              <div key={n.id} className="news-item">
                <div>
                  <ClassBadge cls={n.classification} />
                  <Link href={`/news/${n.id}`} className="news-title">
                    {n.title}
                  </Link>
                </div>
                {n.summary && <div className="news-summary">{n.summary}</div>}
                {n.why_matters && <div className="news-why">{n.why_matters}</div>}
                <div className="news-meta">
                  <span title={new Date(n.fetched_at).toLocaleString("zh-CN")}>
                    {relativeTime(n.fetched_at)}
                  </span>
                  <span className="sep">·</span>
                  <span>{formatCurator(n.curator, n.source)}</span>
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </>
  );
}
