import { useEffect, useState } from "react";
import type { Capture } from "../lib/archive/capture";
import { STATE_LABEL, isGone } from "../lib/archive/detect";
import { sha256Hex } from "../lib/canonical";
import { sendMessage, type AnchorOutcome } from "../lib/messages";
import { getCapture, getLocalBlob, listCaptures, type CaptureSummary } from "../lib/storage";
import { inspect } from "../lib/ots/ots";
import { describeAnchor } from "../content/ArchivePanel";

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function download(name: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function anchorOf(c: Capture): AnchorOutcome | null {
  if (!c.ots_b64) return null;
  try {
    const s = inspect(b64ToBytes(c.ots_b64));
    return { has_proof: true, pending: s.pending, bitcoin_height: s.bitcoinHeight, complete: s.complete };
  } catch {
    return null;
  }
}

function currentId(): string | null {
  const h = decodeURIComponent(location.hash.slice(1));
  return h || null;
}

export function Archive() {
  const [list, setList] = useState<CaptureSummary[]>([]);
  const [id, setId] = useState<string | null>(currentId());

  useEffect(() => {
    void listCaptures().then(setList);
    const onHash = () => setId(currentId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [id]);

  return (
    <div className="nsm-root arch">
      <h1>我的存档</h1>
      <div className="arch-sub">
        这些存档只保存在本机浏览器里。正文哈希可以由任何人重新计算；点「发布见证」才会把签名后的见证发到 Nostr 中继。
      </div>
      {id ? (
        <Detail id={id} onBack={() => (location.hash = "")} onDeleted={() => (location.hash = "")} />
      ) : list.length === 0 ? (
        <div className="arc-dim">还没有存档。打开一篇文章，点右下角「存档」即可。</div>
      ) : (
        <div className="arch-list">
          {list.map((s) => (
            <button key={s.id} className="arch-item" onClick={() => (location.hash = encodeURIComponent(s.id))}>
              <div>
                {isGone(s.page_state) ? <span className="arch-gone">[{STATE_LABEL[s.page_state]}] </span> : null}
                {s.title || s.url}
              </div>
              <div className="arch-meta">
                {fmt(s.captured_at)} · {s.url} · {s.text_sha256.slice(0, 12)}…
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({ id, onBack, onDeleted }: { id: string; onBack: () => void; onDeleted: () => void }) {
  const [c, setC] = useState<Capture | null>(null);
  const [missing, setMissing] = useState(false);
  const [hashOk, setHashOk] = useState<boolean | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const cap = await getCapture(id);
      if (!cap) return setMissing(true);
      setC(cap);
      setHashOk((await sha256Hex(cap.text)) === cap.text_sha256);
      const shotRef = cap.blobs.find((b) => b.kind === "screenshot");
      if (shotRef) {
        const blob = await getLocalBlob(shotRef.sha256);
        if (blob) setShot(`data:${blob.mime};base64,${blob.b64}`);
      }
    })();
  }, [id]);

  if (missing) return <div className="arc-warn">找不到这份存档。<button className="nsm-link" onClick={onBack}>返回列表</button></div>;
  if (!c) return <div className="arc-dim">加载中…</div>;
  const anchor = anchorOf(c);

  async function act(type: "REFRESH_CAPTURE_ANCHOR" | "PUBLISH_CAPTURE") {
    setBusy(true);
    setMsg("");
    try {
      const res = await sendMessage({ type, id });
      if (res.ok && "capture" in res) {
        setC(res.capture);
        if (res.published) setMsg(`见证已发布到 ${res.published.relays_ok} 个中继`);
        if (res.anchor) setMsg(describeAnchor(res.anchor));
        if (res.warnings?.length) setMsg((m) => [m, ...res.warnings!].filter(Boolean).join("；"));
      } else if (!res.ok) setMsg(res.error);
    } finally {
      setBusy(false);
    }
  }

  async function downloadBlob(kind: "html" | "screenshot") {
    const ref = c!.blobs.find((b) => b.kind === kind);
    const blob = ref ? await getLocalBlob(ref.sha256) : null;
    if (!ref || !blob) return setMsg("本机没有这个文件");
    download(`${c!.id}.${kind === "html" ? "html" : "jpg"}`, b64ToBytes(blob.b64) as BlobPart, blob.mime);
  }

  async function remove() {
    if (!confirm("确定删除这份本地存档？已发布到中继的见证不会被删除。")) return;
    await sendMessage({ type: "DELETE_CAPTURE", id });
    onDeleted();
  }

  const { text: _text, ...meta } = c;
  return (
    <div>
      <button className="nsm-link" onClick={onBack}>← 全部存档</button>
      <div className="arch-card">
        <h2>{c.title || c.url}</h2>
        <div className="arch-kv">
          <span>原链接</span><span><a href={c.original_url} target="_blank" rel="noreferrer">{c.url}</a></span>
          <span>存档时间</span><span>{fmt(c.captured_at)}</span>
          <span>存档时状态</span><span>{STATE_LABEL[c.page_state]}{c.page_evidence ? `（${c.page_evidence}）` : ""}</span>
          <span>正文 SHA-256</span>
          <span className="arc-mono">
            {c.text_sha256}{" "}
            {hashOk === null ? null : hashOk ? <span className="arch-ok">✓ 本地重算一致</span> : <span className="arch-bad">✗ 与正文不符</span>}
          </span>
          <span>比特币时间戳</span><span>{anchor ? describeAnchor(anchor) : "未锚定"}</span>
          <span>Internet Archive</span>
          <span>{c.wayback_url ? <a href={c.wayback_url} target="_blank" rel="noreferrer">{c.wayback_url}</a> : "无"}</span>
          <span>已发布见证</span>
          <span>{c.published?.length ? c.published.map((p) => `${fmt(p.at)} · ${p.relays_ok} 个中继 · ${p.event_id.slice(0, 12)}…`).join("\n") : "未发布"}</span>
        </div>
        <div className="nsm-actions">
          <button className="nsm-btn nsm-btn-primary" disabled={busy} onClick={() => act("PUBLISH_CAPTURE")}>发布见证（Nostr）</button>
          <button className="nsm-btn" disabled={busy} onClick={() => act("REFRESH_CAPTURE_ANCHOR")}>{anchor ? "刷新时间戳" : "锚定到比特币"}</button>
          <button className="nsm-btn" onClick={() => download(`${c.id}.json`, JSON.stringify(c, null, 2), "application/json")}>导出 JSON</button>
          <button className="nsm-btn" disabled={!c.ots_b64} onClick={() => download(`${c.id}.txt.ots`, b64ToBytes(c.ots_b64!) as BlobPart, "application/octet-stream")}>下载 .ots</button>
          <button className="nsm-btn" onClick={() => download(`${c.id}.txt`, c.text, "text/plain;charset=utf-8")}>下载正文</button>
          <button className="nsm-btn" disabled={!c.blobs.some((b) => b.kind === "html")} onClick={() => downloadBlob("html")}>下载 HTML</button>
          <button className="nsm-btn" onClick={remove}>删除</button>
        </div>
        {msg ? <div className="arc-dim" style={{ marginTop: 8 }}>{msg}</div> : null}
        <div className="arc-dim" style={{ marginTop: 10 }}>
          独立验证：下载正文（UTF-8，已规范化），用 <code>sha256sum</code> 计算应等于上面的哈希；
          把正文和 .ots 文件一起交给 opentimestamps.org 或 <code>ots verify</code>，可证明这段正文在对应比特币区块之前就已存在。
        </div>
      </div>
      {shot ? (
        <div className="arch-card">
          <div className="arc-dim" style={{ marginBottom: 8 }}>截图（可视区域）</div>
          <img className="arch-shot" src={shot} alt="存档截图" />
        </div>
      ) : null}
      <div className="arch-card arch-text">{c.text}</div>
      <details className="arch-card">
        <summary className="arc-dim">元数据</summary>
        <pre className="arc-mono" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{JSON.stringify(meta, null, 2)}</pre>
      </details>
    </div>
  );
}
