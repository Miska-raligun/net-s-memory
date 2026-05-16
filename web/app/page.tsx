import Link from "next/link";

import { API_BASE, type NewsListItem, type Transparency } from "@/lib/api";
import { relativeTime } from "@/lib/time";

async function fetchNews(): Promise<NewsListItem[]> {
  const r = await fetch(`${API_BASE}/api/news`, { cache: "no-store" });
  if (!r.ok) throw new Error(`failed to fetch news: ${r.status}`);
  return r.json();
}

async function fetchStats(): Promise<{ treeSize: number } | null> {
  try {
    const r = await fetch(`${API_BASE}/api/transparency`, { cache: "no-store" });
    if (!r.ok) return null;
    const t: Transparency = await r.json();
    return { treeSize: t.tree_size };
  } catch {
    return null;
  }
}

const CLASS_LABELS: Record<string, string> = {
  social: "社会",
  international: "国际",
  policy: "政策",
  judicial: "司法",
  science: "科技",
  economy: "经济",
  other: "其他",
};

function ClassBadge({ cls }: { cls: string | null }) {
  if (!cls) return null;
  const label = CLASS_LABELS[cls] ?? cls;
  return <span className={`badge badge-${cls}`}>{label}</span>;
}

function formatCurator(curator: string | null, source: string): string {
  if (!curator) return source;
  const cleaned = curator.replace(/^discover:/, "");
  const parts = cleaned.split("/");
  return parts.length > 1 ? parts[parts.length - 1] : cleaned;
}

export default async function HomePage() {
  const [newsResult, stats] = await Promise.all([
    fetchNews().catch((e: Error) => e),
    fetchStats(),
  ]);

  const isError = newsResult instanceof Error;
  const news = isError ? [] : newsResult;
  const error = isError ? newsResult.message : null;

  return (
    <main>
      <h1>今日记录</h1>
      <p className="desc-block">
        每条记录在入库时由服务端 Ed25519 密钥签名并写入追加式 Merkle
        日志。筛选标准：三个月后可能被删除或篡改的争议性事件。
      </p>

      {stats && (
        <div className="stats-bar">
          <div className="stat">
            <span className="stat-value">{news.length}</span>
            <span className="stat-label">条记录</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.treeSize}</span>
            <span className="stat-label">Merkle 叶子</span>
          </div>
        </div>
      )}

      {error && <div className="fail">无法连接后端 API：{error}</div>}
      {news.length === 0 && !error && (
        <div className="empty-state">
          <p>暂无记录</p>
          <p>运行 <code>python -m app.discover.run</code> 以采集当日新闻</p>
        </div>
      )}
      <div>
        {news.map((n) => (
          <div key={n.id} className="news-item">
            <div>
              <ClassBadge cls={n.classification} />
              {" "}
              <Link href={`/news/${n.id}`} className="news-title">
                {n.title}
              </Link>
            </div>
            {n.summary && <div className="news-summary">{n.summary}</div>}
            {n.why_matters && (
              <div className="news-why">{n.why_matters}</div>
            )}
            <div className="news-meta">
              <span title={new Date(n.fetched_at).toLocaleString("zh-CN")}>
                {relativeTime(n.fetched_at)}
              </span>
              <span>·</span>
              <span>{formatCurator(n.curator, n.source)}</span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
