"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import FilterChips, { type ChipOption } from "@/components/FilterChips";
import SkeletonFeed from "@/components/SkeletonFeed";
import { API_BASE, type CandidateItem } from "@/lib/api";
import { relativeTime } from "@/lib/time";

type Status = "pending" | "curated" | "rejected";

const STATUS_LABEL: Record<Status, string> = {
  pending: "待策展",
  curated: "已纳入",
  rejected: "已排除",
};

const STATUS_TABS: ChipOption[] = [
  { value: "rejected", label: "已排除" },
  { value: "curated", label: "已纳入" },
  { value: "pending", label: "待策展" },
];

export default function CandidatesPage() {
  const [status, setStatus] = useState<Status>("rejected");
  const [rows, setRows] = useState<CandidateItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`${API_BASE}/api/candidates?status=${status}&limit=100`)
      .then((r) => {
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        return r.json();
      })
      .then((d: CandidateItem[]) => {
        if (!cancelled) setRows(d);
      })
      .catch((e: Error) => !cancelled && setErr(e.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <main>
      <h1>候选与策展记录</h1>
      <p className="desc-block">
        采集器把热榜原始条目写入<strong>候选池</strong>，LLM 策展人决定是否纳入长期记录。
        被排除的条目附有理由，永久可查（不签名上链）。
        这一页就是策展决策的<strong>公开审计入口</strong>。
      </p>

      <FilterChips
        options={STATUS_TABS}
        value={status}
        onChange={(v) => setStatus(v as Status)}
      />

      {err && <div className="fail">{err}</div>}
      {loading && <SkeletonFeed count={6} />}
      {!loading && rows.length === 0 && !err && (
        <div className="empty-state">暂无{STATUS_LABEL[status]}的候选</div>
      )}

      <div>
        {rows.map((c) => (
          <div key={c.id} className="news-item">
            <div>
              <a
                href={c.source_url}
                target="_blank"
                rel="noreferrer"
                className="news-title"
              >
                {c.title}
              </a>
            </div>
            {c.rejected_reason && (
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--red-dim)",
                  marginTop: 8,
                  paddingLeft: 10,
                  borderLeft: "2px solid var(--red)",
                  lineHeight: 1.6,
                }}
              >
                {c.rejected_reason}
              </div>
            )}
            {c.news_item_id && (
              <div style={{ fontSize: 12, marginTop: 6 }}>
                <Link href={`/news/${c.news_item_id}`}>查看正式记录 →</Link>
              </div>
            )}
            <div className="news-meta">
              <span>{c.source}</span>
              <span className="sep">·</span>
              <span title={new Date(c.fetched_at).toLocaleString("zh-CN")}>
                {relativeTime(c.fetched_at)}
              </span>
              {c.decided_at && (
                <>
                  <span className="sep">·</span>
                  <span>决定于 {relativeTime(c.decided_at)}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
