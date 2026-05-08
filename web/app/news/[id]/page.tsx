"use client";

import { useEffect, useState } from "react";

import { API_BASE, type NewsDetail } from "@/lib/api";
import { type ProofResponse, type VerificationStatus, verifyProof } from "@/lib/verify";

export default function NewsPage({ params }: { params: { id: string } }) {
  const [news, setNews] = useState<NewsDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/news/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        return r.json();
      })
      .then((d: NewsDetail) => {
        if (!cancelled) setNews(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function onVerify() {
    setVerifying(true);
    setStatus(null);
    try {
      const r = await fetch(`${API_BASE}/api/news/${params.id}/proof`);
      if (!r.ok) {
        setStatus({ ok: false, reason: `proof fetch failed: ${r.status}` });
        return;
      }
      const proof: ProofResponse = await r.json();
      setStatus(await verifyProof(proof));
    } catch (e) {
      setStatus({ ok: false, reason: (e as Error).message });
    } finally {
      setVerifying(false);
    }
  }

  if (loadError) return <main><div className="fail">加载失败：{loadError}</div></main>;
  if (!news) return <main><p>加载中…</p></main>;

  return (
    <main>
      <h1>{news.title}</h1>
      <p>
        来源：
        <a href={news.source_url} target="_blank" rel="noreferrer">
          {news.source}
        </a>
      </p>
      <p>采集时间：{news.fetched_at}</p>
      <article>{news.raw_text || "(无正文摘要)"}</article>

      <button onClick={onVerify} disabled={verifying}>
        {verifying ? "验证中…" : "验证不可篡改"}
      </button>

      {status?.ok && (
        <div className="ok">
          ✅ 验证通过 — 该条记录的哈希与 Merkle 树根一致。
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <div>叶哈希: <code>{status.recomputedLeafHash}</code></div>
            <div>当前根: <code>{status.root}</code></div>
            <div>树规模: {status.treeSize}</div>
          </div>
        </div>
      )}
      {status && !status.ok && (
        <div className="fail">❌ 验证失败 — {status.reason}</div>
      )}
    </main>
  );
}
