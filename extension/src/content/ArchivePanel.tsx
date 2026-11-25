import { useEffect, useState } from "react";
import { STATE_LABEL, isGone, type Detection } from "../lib/archive/detect";
import type { Capture } from "../lib/archive/capture";
import { WitnessSection } from "./WitnessSection";
import { JudgmentSection } from "./JudgmentSection";
import { sendMessage, type AnchorOutcome, type PageInfo, type Response, type SearchOutcome } from "../lib/messages";
import type { CaptureSummary } from "../lib/storage";

interface Props {
  page: PageInfo;
  detection: Detection;
  /** Runs the capture with the widget hidden so it is not in the screenshot. */
  capture: () => Promise<Response>;
  onArchived?: (count: number) => void;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

export function describeAnchor(a: AnchorOutcome): string {
  if (a.complete) return `已锚定到比特币区块 #${a.bitcoin_height}`;
  if (a.has_proof) return `已提交到 ${a.pending.length} 个 OpenTimestamps 日历，等待比特币确认（约数小时）`;
  return "尚未锚定";
}

export function ArchivePanel({ page, detection, capture, onArchived }: Props) {
  const gone = isGone(detection.state);
  const [local, setLocal] = useState<CaptureSummary[]>([]);
  const [evidenceTick, setEvidenceTick] = useState(0);
  const [savingHit, setSavingHit] = useState<string | null>(null);
  const [savedHits, setSavedHits] = useState<Set<string>>(new Set());
  const [hitErr, setHitErr] = useState("");
  const [current, setCurrent] = useState<Capture | null>(null);
  const [busy, setBusy] = useState<"" | "capture" | "extras" | "publish" | "search">("");
  const [notes, setNotes] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<AnchorOutcome | null>(null);
  const [publishMsg, setPublishMsg] = useState("");
  const [search, setSearch] = useState<SearchOutcome | null>(null);
  const [searchErr, setSearchErr] = useState("");

  // The text version being judged: the most recent copy you hold of this page.
  const target = local[0] ?? null;

  async function saveAsEvidence(url: string) {
    if (!target) return;
    setSavingHit(url);
    setHitErr("");
    try {
      const res = await sendMessage({ type: "OPEN_AND_CAPTURE", url, target: target.text_sha256 });
      if (res.ok && "capture" in res) {
        setSavedHits((s) => new Set(s).add(url));
        setEvidenceTick((t) => t + 1);
      } else if (!res.ok) setHitErr(res.error);
    } finally {
      setSavingHit(null);
    }
  }

  async function refreshLocal() {
    const res = await sendMessage({ type: "LIST_CAPTURES", url: page.url });
    if (res.ok && "captures" in res) {
      setLocal(res.captures);
      onArchived?.(res.captures.length);
    }
  }

  useEffect(() => {
    void refreshLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.url]);

  async function onCapture() {
    setBusy("capture");
    setNotes([]);
    setPublishMsg("");
    try {
      const res = await capture();
      if (!res.ok) {
        setNotes([res.error]);
        return;
      }
      if (!("capture" in res)) return;
      setCurrent(res.capture);
      setNotes(res.warnings ?? []);
      await refreshLocal();

      setBusy("extras");
      const extras = await sendMessage({ type: "CAPTURE_EXTRAS", id: res.capture.id });
      if (extras.ok && "capture" in extras) {
        setCurrent(extras.capture);
        if (extras.anchor) setAnchor(extras.anchor);
        setNotes((n) => [...n, ...(extras.warnings ?? [])]);
      } else if (!extras.ok) {
        setNotes((n) => [...n, extras.error]);
      }
    } finally {
      setBusy("");
    }
  }

  async function onPublish() {
    if (!current) return;
    setBusy("publish");
    setPublishMsg("");
    try {
      const res = await sendMessage({ type: "PUBLISH_CAPTURE", id: current.id });
      if (res.ok && "capture" in res && res.published) {
        setCurrent(res.capture);
        const p = res.published;
        setPublishMsg(
          `见证已发布到 ${p.relays_ok} 个中继${p.relays_failed ? `（${p.relays_failed} 个失败）` : ""} · ${p.npub.slice(0, 14)}…`,
        );
        if (res.warnings?.length) setNotes((n) => [...n, ...res.warnings!]);
      } else if (!res.ok) {
        setPublishMsg(res.error);
      }
    } finally {
      setBusy("");
    }
  }

  // On a deletion page the live title is gone; fall back to what we archived.
  const searchQuery = (gone ? local[0]?.title ?? "" : page.title).trim();

  async function onSearch() {
    setBusy("search");
    setSearchErr("");
    try {
      const res = await sendMessage({ type: "SEARCH", query: searchQuery, excludeUrl: page.url });
      if (res.ok && "search" in res) setSearch(res.search);
      else if (!res.ok) setSearchErr(res.error);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="arc">
      {gone ? (
        <div className="arc-gone">
          <div className="arc-gone-title">原文{STATE_LABEL[detection.state]}</div>
          <div className="arc-dim">依据：{detection.evidence ?? "—"}</div>
        </div>
      ) : null}

      {local.length > 0 ? (
        <div className="arc-row">
          <span>
            本机存有 {local.length} 份 · 最近 {fmt(local[0].captured_at)}
          </span>
          <button className="nsm-link" onClick={() => sendMessage({ type: "OPEN_ARCHIVE", id: local[0].id })}>
            查看
          </button>
        </div>
      ) : gone ? (
        <div className="arc-dim">本机没有这页的存档，可以在下面查询其他人的见证。</div>
      ) : null}

      {!gone ? (
        <div className="nsm-actions">
          <button className="nsm-btn nsm-btn-primary" onClick={onCapture} disabled={busy !== ""}>
            {busy === "capture" ? "存档中…" : busy === "extras" ? "锚定与快照中…" : local.length ? "再存一份" : "存档本页"}
          </button>
          {current ? (
            <button className="nsm-btn" onClick={onPublish} disabled={busy !== ""}>
              {busy === "publish" ? "发布中…" : "发布见证（Nostr）"}
            </button>
          ) : null}
        </div>
      ) : null}

      {current ? (
        <div className="cred-rows arc-detail">
          <div className="cred-row">
            <span className="cred-row-key">正文哈希</span>
            <span className="cred-row-val arc-mono" title={current.text_sha256}>
              {current.text_sha256.slice(0, 16)}…
            </span>
          </div>
          <div className="cred-row">
            <span className="cred-row-key">字数</span>
            <span className="cred-row-val">{[...current.text].length}</span>
          </div>
          <div className="cred-row">
            <span className="cred-row-key">比特币时间戳</span>
            <span className="cred-row-val">{anchor ? describeAnchor(anchor) : busy === "extras" ? "提交中…" : "未开启"}</span>
          </div>
          <div className="cred-row">
            <span className="cred-row-key">Internet Archive</span>
            <span className="cred-row-val">
              {current.wayback_url ? (
                <a href={current.wayback_url} target="_blank" rel="noreferrer">
                  第三方快照
                </a>
              ) : busy === "extras" ? (
                "提交中…"
              ) : (
                "无"
              )}
            </span>
          </div>
        </div>
      ) : null}

      {publishMsg ? <div className="arc-dim">{publishMsg}</div> : null}
      {notes.map((n, i) => (
        <div key={i} className="arc-warn">
          {n}
        </div>
      ))}

      <WitnessSection page={page} detection={detection} gone={gone} onImported={() => void refreshLocal()} />

      {target ? (
        <JudgmentSection
          url={page.url}
          target={target}
          evidenceTick={evidenceTick}
          onEvidenceChanged={() => setEvidenceTick((t) => t + 1)}
        />
      ) : null}

      {gone && !searchQuery ? null : (
      <div className="nsm-actions">
        <button className="nsm-btn" onClick={onSearch} disabled={busy !== "" || !searchQuery}>
          {busy === "search" ? "搜索中…" : "查找其他报道（Google / 必应）"}
        </button>
      </div>
      )}
      {searchErr ? <div className="arc-warn">{searchErr}</div> : null}
      {search ? (
        <div className="arc-hits">
          <div className="arc-dim">
            <span className="arc-tag">线索，未经核实</span> {search.engine === "google" ? "Google" : "必应国际版"} · {search.hits.length} 条
            {search.hidden_domestic ? ` · 已隐藏 ${search.hidden_domestic} 条境内来源` : ""} ·{" "}
            <a href={search.search_url} target="_blank" rel="noreferrer">
              打开搜索页
            </a>
          </div>
          {search.hits.map((h) => (
            <div key={h.url} className="arc-hit">
              <a href={h.url} target="_blank" rel="noreferrer">
                {h.title}
              </a>
              <div className="arc-dim arc-row">
                <span>
                  {h.domain}
                  {h.domestic ? <span className="arc-tag">境内</span> : null}
                </span>
                {target ? (
                  <button
                    className="nsm-link"
                    disabled={savingHit !== null || savedHits.has(h.url)}
                    onClick={() => saveAsEvidence(h.url)}
                    title="打开这条结果，存档后加入证据，供真实性判断引用"
                  >
                    {savedHits.has(h.url) ? "已存为证据" : savingHit === h.url ? "存档中…" : "存为证据"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {!target ? <div className="arc-dim">先存档本页，才能把搜索结果存为证据。</div> : null}
          {hitErr ? <div className="arc-warn">{hitErr}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
