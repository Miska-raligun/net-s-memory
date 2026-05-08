import Link from "next/link";

import { API_BASE, type NewsListItem } from "@/lib/api";

async function fetchNews(): Promise<NewsListItem[]> {
  const r = await fetch(`${API_BASE}/api/news`, { cache: "no-store" });
  if (!r.ok) throw new Error(`failed to fetch news: ${r.status}`);
  return r.json();
}

export default async function HomePage() {
  let news: NewsListItem[] = [];
  let error: string | null = null;
  try {
    news = await fetchNews();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <main>
      <h1>今日记录</h1>
      <p>每条记录都已用服务端 Ed25519 密钥签名并写入追加式 Merkle 日志。</p>
      {error && <div className="fail">无法连接后端 API：{error}</div>}
      {news.length === 0 && !error && <p>暂无记录。运行采集器以填充：<code>python -m app.ingest.run_once zhihu</code></p>}
      <ol>
        {news.map((n) => (
          <li key={n.id}>
            <Link href={`/news/${n.id}`}>{n.title}</Link>
            <span style={{ color: "#6b7280" }}> · {n.source}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
