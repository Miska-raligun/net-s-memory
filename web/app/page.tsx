import { API_BASE, type NewsListItem, type Transparency } from "@/lib/api";
import HomeFeed from "@/components/HomeFeed";
import { formatDateTime } from "@/lib/time";

async function fetchNews(): Promise<NewsListItem[]> {
  const r = await fetch(`${API_BASE}/api/news`, { cache: "no-store" });
  if (!r.ok) throw new Error(`failed to fetch news: ${r.status}`);
  return r.json();
}

async function fetchTransparency(): Promise<Transparency | null> {
  try {
    const r = await fetch(`${API_BASE}/api/transparency`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Transparency;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [newsResult, transparency] = await Promise.all([
    fetchNews().catch((e: Error) => e),
    fetchTransparency(),
  ]);

  const isError = newsResult instanceof Error;
  const news = isError ? [] : newsResult;
  const error = isError ? newsResult.message : null;

  const latestAnchor = transparency?.anchors?.[0] ?? null;

  return (
    <main>
      <section className="hero">
        <div className="hero-eyebrow">永久存证 · 抗篡改</div>
        <h1 className="hero-title">互联网记忆</h1>
        <p className="hero-tagline">
          每天由 LLM 主动从公开网络挑选当日<strong>可能在数月后被删除、修改或压制</strong>
          的争议性事件，签名后写入追加式 Merkle 日志，并定期锚定至比特币——
          一旦记录，无人能悄悄改写。
        </p>

        <div className="stats-bar">
          <div className="stat">
            <span className="stat-value">{news.length}</span>
            <span className="stat-label">公开记录</span>
          </div>
          <div className="stat">
            <span className="stat-value">{transparency?.tree_size ?? "—"}</span>
            <span className="stat-label">Merkle 叶子</span>
          </div>
          <div className="stat">
            <span className="stat-value">
              {latestAnchor ? latestAnchor.leaf_count : "—"}
            </span>
            <span className="stat-label">最近一次锚定</span>
            <span className="stat-sub">
              {latestAnchor ? formatDateTime(latestAnchor.anchored_at) : "暂无"}
            </span>
          </div>
        </div>
      </section>

      {error && <div className="fail">无法连接后端 API：{error}</div>}

      {news.length === 0 && !error && (
        <div className="empty-state">
          <p>暂无记录。</p>
          <p style={{ marginTop: 6, fontSize: 12 }}>
            运行 <code>python -m app.discover.run</code> 让 AI 采集当日新闻
          </p>
        </div>
      )}

      <HomeFeed news={news} />
    </main>
  );
}
