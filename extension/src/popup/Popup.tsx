import { useEffect, useState } from "react";
import { CredibilityCard } from "../ui/CredibilityCard";
import { sendMessage } from "../lib/messages";
import { STATE_LABEL } from "../lib/archive/detect";
import type { WatchEntry } from "../lib/archive/recheck";
import type { Assessment } from "../lib/types";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

export function Popup() {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [watches, setWatches] = useState<WatchEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadWatches() {
    const res = await sendMessage({ type: "LIST_WATCHES" });
    if (res.ok && "watches" in res) setWatches(res.watches);
  }

  useEffect(() => {
    void (async () => {
      await loadWatches();
      await sendMessage({ type: "ACK_GONE" }); // opening the popup = seen
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? "";
      if (/^https?:/.test(url)) {
        const res = await sendMessage({ type: "GET_CACHED", url });
        if (res.ok && "assessment" in res && res.assessment) setAssessment(res.assessment);
      }
    })();
  }, []);

  async function recheckNow() {
    setBusy(true);
    setMsg("");
    try {
      const res = await sendMessage({ type: "RECHECK_NOW" });
      if (res.ok && "recheck" in res) {
        const r = res.recheck;
        setMsg(
          `回访 ${r.checked} 条${r.inconclusive ? `，${r.inconclusive} 条无法判断` : ""}` +
            (r.newly_gone.length ? `，新发现 ${r.newly_gone.length} 条已被删除` : "，没有新的删除"),
        );
        await loadWatches();
      } else if (!res.ok) setMsg(res.error);
    } finally {
      setBusy(false);
    }
  }

  const gone = watches
    .filter((w) => w.state !== "live")
    .sort((a, b) => ((a.gone_since ?? "") < (b.gone_since ?? "") ? 1 : -1));
  const live = watches.length - gone.length;

  return (
    <div className="nsm-root" style={{ width: 340, padding: 14, background: "var(--bg-surface)" }}>
      <div className="nsm-panel-head">
        <span className="nsm-panel-title">互联网记忆</span>
      </div>

      <div className="arc-dim" style={{ marginBottom: 8 }}>
        监测中 {watches.length} 个链接 · 在线 {live} · 已消失 {gone.length}
      </div>

      {gone.length > 0 ? (
        <div className="arc" style={{ marginBottom: 10 }}>
          <div className="arc-section-title">你存过、现在已经消失的内容</div>
          {gone.slice(0, 8).map((w) => (
            <div key={w.url} className="arc-version">
              <a href={w.url} target="_blank" rel="noreferrer" className="arc-mono" style={{ fontSize: 11, wordBreak: "break-all" }}>
                {w.url}
              </a>
              <div className="arc-dim">
                {STATE_LABEL[w.state]} · 发现于 {fmt(w.gone_since)}
                {w.evidence ? ` · ${w.evidence}` : ""}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {assessment ? (
        <details className="arc-cred">
          <summary>当前页信源参考信号</summary>
          <CredibilityCard assessment={assessment} />
        </details>
      ) : null}

      {msg ? <div className="arc-dim">{msg}</div> : null}
      <div className="nsm-actions">
        <button className="nsm-btn" onClick={recheckNow} disabled={busy || watches.length === 0}>
          {busy ? "回访中…" : "立即回访"}
        </button>
        <button className="nsm-btn" onClick={() => sendMessage({ type: "OPEN_ARCHIVE" })}>
          我的存档
        </button>
        <button className="nsm-btn" onClick={() => chrome.runtime.openOptionsPage()}>
          设置
        </button>
      </div>
    </div>
  );
}
