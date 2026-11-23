import { useEffect, useState } from "react";
import { CredibilityCard } from "../ui/CredibilityCard";
import { scoreColor } from "../ui/score";
import { assessPage } from "../lib/assess";
import { getLlmConfig } from "../lib/storage";
import { sendMessage, type PageInfo, type Response } from "../lib/messages";
import { STATE_LABEL, isGone, type Detection } from "../lib/archive/detect";
import type { Assessment } from "../lib/types";
import { ArchivePanel } from "./ArchivePanel";

interface Props {
  page: PageInfo;
  detection: Detection;
  /** Whether the page has enough article text for a credibility assessment. */
  articleLike: boolean;
  capture: () => Promise<Response>;
}

export function Widget({ page, detection, articleLike, capture }: Props) {
  const gone = isGone(detection.state);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [open, setOpen] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasRunFull, setHasRunFull] = useState(false);
  const [archived, setArchived] = useState(0);

  // Instant, network-free preview from cache or reputation-only scoring.
  useEffect(() => {
    if (gone || !articleLike) return;
    let alive = true;
    (async () => {
      setLlmConfigured((await getLlmConfig()) !== null);
      const cached = await sendMessage({ type: "GET_CACHED", url: page.url });
      if (!alive) return;
      if (cached.ok && "assessment" in cached && cached.assessment) {
        setAssessment(cached.assessment);
        setHasRunFull(true);
      } else {
        setAssessment(await assessPage(page, null));
      }
    })();
    return () => {
      alive = false;
    };
  }, [page, gone, articleLike]);

  // Count local captures for the badge even before the panel is opened.
  useEffect(() => {
    void sendMessage({ type: "LIST_CAPTURES", url: page.url }).then((res) => {
      if (res.ok && "captures" in res) setArchived(res.captures.length);
    });
  }, [page.url]);

  async function runFullAssessment(force = false) {
    setLoading(true);
    try {
      const res = await sendMessage({ type: "ASSESS", page, force });
      if (res.ok && "assessment" in res && res.assessment) {
        setAssessment(res.assessment);
        setHasRunFull(true);
      }
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && assessment && !hasRunFull && !loading && llmConfigured) void runFullAssessment(false);
  }

  return (
    <div className="nsm-root">
      {open ? (
        <div className="nsm-panel">
          <div className="nsm-panel-head">
            <span className="nsm-panel-title">互联网记忆</span>
            <button className="nsm-close" onClick={() => setOpen(false)} aria-label="关闭">
              ×
            </button>
          </div>

          <ArchivePanel page={page} detection={detection} capture={capture} onArchived={setArchived} />

          {assessment ? (
            <details className="arc-cred">
              <summary>信源参考信号{loading ? " · 评估中…" : ""}</summary>
              <CredibilityCard assessment={assessment}>
                <div className="nsm-actions">
                  <button className="nsm-btn" onClick={() => runFullAssessment(true)} disabled={loading}>
                    {loading ? "评估中…" : hasRunFull ? "重新评估" : "用我的 LLM 评估"}
                  </button>
                </div>
                {!llmConfigured ? (
                  <div className="cred-disclaim" style={{ borderTop: "none", paddingTop: 8 }}>
                    未配置 LLM key，仅显示来源先验。这只是参考信号，不是真假判定。
                  </div>
                ) : null}
              </CredibilityCard>
            </details>
          ) : null}

          <div className="nsm-actions">
            <button className="nsm-btn" onClick={() => sendMessage({ type: "OPEN_ARCHIVE" })}>
              我的存档
            </button>
            <button className="nsm-btn" onClick={() => chrome.runtime.openOptionsPage()}>
              设置
            </button>
          </div>
        </div>
      ) : null}

      <div className={`nsm-badge${gone ? " nsm-badge-gone" : ""}`} onClick={toggle} title="互联网记忆">
        {gone ? (
          <>
            <span className="nsm-badge-dot" style={{ background: "#ef4444" }} />
            <span className="nsm-badge-label">原文{STATE_LABEL[detection.state]}{archived ? ` · 本机有 ${archived} 份` : ""}</span>
          </>
        ) : (
          <>
            <span
              className="nsm-badge-dot"
              style={{ background: archived ? "#22c55e" : assessment ? scoreColor(assessment.score) : "#94a3b8" }}
            />
            <span className="nsm-badge-label">{archived ? `已存档 ${archived} 份` : "存档"}</span>
          </>
        )}
      </div>
    </div>
  );
}
