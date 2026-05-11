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
  curated: "已纳入记录",
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
      <p style={{ fontSize: 14, color: "#555" }}>
        采集器把热榜原始条目作为<strong>候选</strong>写入，
        LLM 策展人决定哪些值得纳入长期记录、哪些应当排除。
        排除的条目带有 LLM 的理由说明，永久可查（虽然不签名上链）。
      </p>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{
              fontWeight: status === s ? 600 : 400,
              background: status === s ? "#eef2ff" : "white",
              border: "1px solid #ddd",
              borderRadius: 4,
              padding: "4px 10px",
            }}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {err && <div className="fail" style={{ marginTop: 12 }}>{err}</div>}
      {rows.length === 0 && !err && (
        <p style={{ marginTop: 16, color: "#888" }}>暂无{STATUS_LABEL[status]}的候选。</p>
      )}

      <ul style={{ listStyle: "none", paddingLeft: 0, marginTop: 16 }}>
        {rows.map((c) => (
          <li
            key={c.id}
            style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}
          >
            <div style={{ fontSize: 14 }}>
              [<span style={{ color: "#888" }}>{c.source}</span>]{" "}
              <a href={c.source_url} target="_blank" rel="noreferrer">
                {c.title}
              </a>
            </div>
            {c.rejected_reason && (
              <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 2 }}>
                排除理由: {c.rejected_reason}
              </div>
            )}
            {c.news_item_id && (
              <div style={{ fontSize: 12, marginTop: 2 }}>
                已纳入 →{" "}
                <Link href={`/news/${c.news_item_id}`}>查看正式记录</Link>
              </div>
            )}
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
              {new Date(c.fetched_at).toLocaleString("zh-CN")}
              {c.decided_at && (
                <> · 决定于 {new Date(c.decided_at).toLocaleString("zh-CN")}</>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
