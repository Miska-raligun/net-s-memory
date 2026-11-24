// "网络见证": what other people have archived / observed for this URL.
//
// Querying relays tells them which URL you are looking at, so it only runs
// when the user asks. Every event is re-verified in the background worker
// (signature + text hash) before it is counted here.

import { useState } from "react";
import { STATE_LABEL, type Detection } from "../lib/archive/detect";
import type { WitnessSummary } from "../lib/archive/witness";
import { sendMessage, type PageInfo } from "../lib/messages";

interface Props {
  page: PageInfo;
  detection: Detection;
  gone: boolean;
  onImported: () => void;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

export function WitnessSection({ page, detection, gone, onImported }: Props) {
  const [summary, setSummary] = useState<(WitnessSummary & { relays: number }) | null>(null);
  const [busy, setBusy] = useState<"" | "query" | "import" | "observe">("");
  const [msg, setMsg] = useState("");
  const [imported, setImported] = useState<Set<string>>(new Set());

  async function query() {
    setBusy("query");
    setMsg("");
    try {
      const res = await sendMessage({ type: "QUERY_WITNESSES", url: page.url });
      if (res.ok && "witnesses" in res) setSummary(res.witnesses);
      else if (!res.ok) setMsg(res.error);
    } finally {
      setBusy("");
    }
  }

  async function importCopy(eventId: string) {
    setBusy("import");
    setMsg("");
    try {
      const res = await sendMessage({ type: "IMPORT_WITNESS", event_id: eventId });
      if (res.ok && "capture" in res) {
        setImported((s) => new Set(s).add(eventId));
        setMsg("已保存到本机（标记为他人见证的副本）");
        onImported();
      } else if (!res.ok) setMsg(res.error);
    } finally {
      setBusy("");
    }
  }

  async function observe() {
    setBusy("observe");
    setMsg("");
    try {
      const res = await sendMessage({
        type: "PUBLISH_OBSERVATION",
        url: page.url,
        state: detection.state,
        evidence: detection.evidence,
        http_status: null,
      });
      if (res.ok && "published" in res && res.published) {
        setMsg(`删除观察已发布到 ${res.published.relays_ok} 个中继`);
        if (summary) void query();
      } else if (!res.ok) setMsg(res.error);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="arc-witness">
      <div className="arc-section-title">网络见证</div>
      <div className="nsm-actions">
        <button className="nsm-btn" onClick={query} disabled={busy !== ""}>
          {busy === "query" ? "查询中…" : summary ? "刷新" : "查询其他人的存档与观察"}
        </button>
        {gone ? (
          <button className="nsm-btn" onClick={observe} disabled={busy !== ""}>
            {busy === "observe" ? "发布中…" : "发布删除观察"}
          </button>
        ) : null}
      </div>
      {!summary ? (
        <div className="arc-dim">查询会让中继知道你在看这个链接，所以只在你点击时进行。</div>
      ) : (
        <>
          {summary.gone ? (
            <div className="arc-warn">
              {summary.gone.observers.length} 人报告
              {summary.gone.states.map((s) => STATE_LABEL[s]).join(" / ")}
              {summary.gone.trusted ? `（其中 ${summary.gone.trusted} 人是你关注的）` : ""} · 最早 {fmt(summary.gone.earliest)}
            </div>
          ) : null}
          {summary.versions.length === 0 ? (
            <div className="arc-dim">在 {summary.relays} 个中继上没有找到这页的存档见证。</div>
          ) : (
            <div className="arc-dim">
              {summary.total_witnesses} 人存过这页，共 {summary.versions.length} 个正文版本
              {summary.versions.length > 1 ? "。版本不一致：可能是原文被编辑过，或有人发布了改动过的正文，请对照比较。" : "。"}
            </div>
          )}
          {summary.versions.map((v) => (
            <div key={v.text_sha256} className={`arc-version${v.matches_local ? " arc-version-local" : ""}`}>
              <div className="arc-row">
                <span className="arc-mono">{v.text_sha256.slice(0, 12)}…</span>
                <span>
                  {v.witnesses.length} 人见证{v.trusted ? ` · ${v.trusted} 人你关注` : ""}
                </span>
              </div>
              <div className="arc-dim">
                {fmt(v.first_captured_at)}
                {v.last_captured_at !== v.first_captured_at ? ` – ${fmt(v.last_captured_at)}` : ""}
                {v.matches_local ? " · 与本机副本一致" : ""}
                {v.has_ots ? " · 有比特币时间戳" : ""}
                {v.wayback_url ? (
                  <>
                    {" · "}
                    <a href={v.wayback_url} target="_blank" rel="noreferrer">
                      archive.org
                    </a>
                  </>
                ) : null}
              </div>
              {v.best.content.text ? <div className="arc-excerpt">{v.best.content.text.slice(0, 120)}…</div> : null}
              {!v.matches_local && v.has_text ? (
                <button
                  className="nsm-link"
                  disabled={busy !== "" || imported.has(v.best.event_id)}
                  onClick={() => importCopy(v.best.event_id)}
                >
                  {imported.has(v.best.event_id) ? "已保存" : "保存这份副本到本机"}
                </button>
              ) : null}
            </div>
          ))}
          <div className="arc-dim">人数是不同密钥的数量，密钥可以随意生成。更可信的是你关注的人，以及与你自己副本一致的版本。</div>
        </>
      )}
      {msg ? <div className="arc-dim">{msg}</div> : null}
    </div>
  );
}
