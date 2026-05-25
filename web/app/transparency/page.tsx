import { API_BASE, type Transparency } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/time";

async function fetchTransparency(): Promise<Transparency> {
  const r = await fetch(`${API_BASE}/api/transparency`, { cache: "no-store" });
  if (!r.ok) throw new Error(`failed: ${r.status}`);
  return r.json();
}

function short(hex: string): string {
  return hex.length > 18 ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : hex;
}

export default async function TransparencyPage() {
  let t: Transparency | null = null;
  let error: string | null = null;
  try {
    t = await fetchTransparency();
  } catch (e) {
    error = (e as Error).message;
  }

  if (error) return <main><div className="fail">无法连接后端：{error}</div></main>;
  if (!t) return <main><p>加载中…</p></main>;

  return (
    <main>
      <h1>透明度日志</h1>
      <p className="desc-block">
        所有 NewsItem / 分析 / 投票 / 提案都作为叶子追加进同一棵 Merkle 树，
        每日把树根锚定到比特币（OpenTimestamps）并可选锚定到 Polygon。
        本页公开当前状态以及全部历史锚定记录，任何人都可以独立校验。
      </p>

      <div className="stats-bar" style={{ marginTop: 0 }}>
        <div className="stat">
          <span className="stat-value">{t.tree_size}</span>
          <span className="stat-label">Merkle 叶子总数</span>
        </div>
        <div className="stat">
          <span className="stat-value">{t.anchors.length}</span>
          <span className="stat-label">公链锚定次数</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {t.anchors[0] ? short(t.anchors[0].root_hash) : "—"}
          </span>
          <span className="stat-label">最新根哈希</span>
          {t.anchors[0] && (
            <span className="stat-sub">{relativeTime(t.anchors[0].anchored_at)}</span>
          )}
        </div>
      </div>

      <h2>当前树根</h2>
      <div className="anchor-card" style={{ marginTop: 4 }}>
        <div className="root">{t.root_hash ?? "(尚无叶子)"}</div>
        <div className="meta">
          <div className="meta-row">
            <span className="k">叶子数</span>
            <span>{t.tree_size}</span>
          </div>
        </div>
      </div>

      <h2>历史锚定</h2>
      {t.anchors.length === 0 ? (
        <div className="empty-state">
          <p>尚无锚定记录</p>
          <p style={{ marginTop: 6, fontSize: 12 }}>
            运行 <code>python -m app.crypto.anchor_run</code> 以将当前根锚定至比特币
          </p>
        </div>
      ) : (
        <div className="anchor-grid">
          {t.anchors.map((a) => (
            <div key={`${a.anchored_at}-${a.root_hash}`} className="anchor-card">
              <h4>{formatDateTime(a.anchored_at)}</h4>
              <div className="root">{short(a.root_hash)}</div>
              <div className="meta">
                <div className="meta-row">
                  <span className="k">叶子数</span>
                  <span>{a.leaf_count}</span>
                </div>
                <div className="meta-row">
                  <span className="k">BTC 区块</span>
                  <span>{a.btc_block_height ?? "待确认"}</span>
                </div>
                <div className="meta-row">
                  <span className="k">Polygon Tx</span>
                  <span>{a.polygon_tx_hash ? short(a.polygon_tx_hash) : "—"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
