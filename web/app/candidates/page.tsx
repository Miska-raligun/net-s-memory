"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE, type CandidateItem } from "@/lib/api";

const STATUSES: Array<"pending" | "curated" | "rejected"> = [
  "pending",
  "curated",
  "rejected",
];

const STATUS_LABEL: Record<string, string> = {
  pending: "待策展",
  curated: "已纳入",
  rejected: "已排除",
};

export default function CandidatesPage() {
  const [status, setStatus] = useState<"pending" | "curated" | "rejected">(
    "rejected",
  );
  const [rows, setRows] = useState<CandidateItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/candidates?status=${status}&limit=100`)
      .then((r) => {
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        return r.json();
      })
      .then((d: CandidateItem[]) => {
        if (!cancelled) setRows(d);
      })
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <main>
      <h1>候选与策展记录</h1>
      <p className="desc-block">
        采集器将热榜条目写入候选池，LLM 策展人决定哪些值得纳入长期记录。
        被排除的条目附有理由，永久可查。
      </p>

      <div className="btn-group">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={status === s ? "btn-primary" : ""}
            onClick={() => setStatus(s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {err && <div className="fail">{err}</div>}
      {rows.length === 0 && !err && (
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
              <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>
                {c.source}
              </span>
            </div>
            {c.rejected_reason && (
              <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6, paddingLeft: 10, borderLeft: "2px solid var(--red)" }}>
                {c.rejected_reason}
              </div>
            )}
            {c.news_item_id && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <Link href={`/news/${c.news_item_id}`}>查看正式记录 →</Link>
              </div>
            )}
            <div className="news-meta" style={{ marginTop: 6 }}>
              <span>{new Date(c.fetched_at).toLocaleDateString("zh-CN")}</span>
              {c.decided_at && (
                <>
                  <span>·</span>
                  <span>决定于 {new Date(c.decided_at).toLocaleDateString("zh-CN")}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
