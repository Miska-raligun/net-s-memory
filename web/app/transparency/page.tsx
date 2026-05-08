import { API_BASE, type Transparency } from "@/lib/api";

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
      <h1>公开透明日志</h1>
      <p>追加式 Merkle 日志当前规模：<strong>{t.tree_size}</strong> 条叶子。</p>
      <p>
        当前根哈希：
        <code>{t.root_hash ?? "(尚无叶子)"}</code>
      </p>

      <h2>历史锚定</h2>
      {t.anchors.length === 0 ? (
        <p>尚无公链锚定记录。锚定脚本会每日把当前根写入比特币（OpenTimestamps）和可选的 Polygon 合约。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>锚定时间</th>
              <th>根哈希</th>
              <th>叶子数</th>
              <th>BTC 区块</th>
              <th>Polygon Tx</th>
            </tr>
          </thead>
          <tbody>
            {t.anchors.map((a) => (
              <tr key={`${a.anchored_at}-${a.root_hash}`}>
                <td>{a.anchored_at}</td>
                <td><code>{short(a.root_hash)}</code></td>
                <td>{a.leaf_count}</td>
                <td>{a.btc_block_height ?? "-"}</td>
                <td>{a.polygon_tx_hash ? short(a.polygon_tx_hash) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
