import Link from "next/link";

import { API_BASE, type NewsListItem } from "@/lib/api";

async function fetchNews(): Promise<NewsListItem[]> {
  const r = await fetch(`${API_BASE}/api/news`, { cache: "no-store" });
  if (!r.ok) throw new Error(`failed to fetch news: ${r.status}`);
  return r.json();
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
  return (
    <span
      style={{
        fontSize: 12,
        padding: "2px 6px",
        borderRadius: 4,
        background: "#eef2ff",
        color: "#3730a3",
        marginRight: 6,
      }}
    >
      {label}
    </span>
  );
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
      <p style={{ fontSize: 14, color: "#555" }}>
        每条记录都由 LLM 策展人从原始热榜候选中挑选而来，
        筛掉娱乐 / 营销 / 短期情绪话题，保留值得长期记住的社会与国际事件。
        所有条目使用服务端 Ed25519 密钥签名并写入追加式 Merkle 日志。
      </p>
      <p style={{ fontSize: 13, color: "#888" }}>
        想看 LLM 排除掉哪些热搜？查看{" "}
        <Link href="/candidates">候选与排除记录</Link>。
      </p>
      {error && <div className="fail">无法连接后端 API：{error}</div>}
      {news.length === 0 && !error && (
        <p>
          暂无记录。先采集再策展：<br />
          <code>python -m app.ingest.run_once zhihu</code><br />
          <code>python -m app.curate.run</code>
        </p>
      )}
      <ol style={{ listStyle: "none", paddingLeft: 0 }}>
        {news.map((n) => (
          <li
            key={n.id}
            style={{ padding: "12px 0", borderBottom: "1px solid #eee" }}
          >
            <div>
              <ClassBadge cls={n.classification} />
              <Link href={`/news/${n.id}`} style={{ fontSize: 16 }}>
                {n.title}
              </Link>
            </div>
            {n.summary && (
              <div style={{ fontSize: 14, color: "#444", marginTop: 4 }}>
                {n.summary}
              </div>
            )}
            {n.why_matters && (
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                为何记录: {n.why_matters}
              </div>
            )}
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
              {new Date(n.fetched_at).toLocaleString("zh-CN")} ·{" "}
              {n.curator ? `策展: ${n.curator}` : `直采: ${n.source}`}
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
