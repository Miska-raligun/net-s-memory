import { useEffect, useState } from "react";
import { CredibilityCard } from "../ui/CredibilityCard";
import { scoreColor } from "../ui/score";
import { assessPage } from "../lib/assess";
import { getLlmConfig } from "../lib/storage";
import { sendMessage, type PageInfo } from "../lib/messages";
import type { Assessment } from "../lib/types";

interface Props {
  page: PageInfo;
}

export function Widget({ page }: Props) {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [open, setOpen] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasRunFull, setHasRunFull] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  const [publishing, setPublishing] = useState(false);

  // Instant, network-free preview from cache or reputation-only scoring.
  useEffect(() => {
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
  }, [page]);

  // Full assessment = LLM (if configured) + Nostr community signal. Deferred
  // until the user shows intent by opening the panel.
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

  async function endorse() {
    setPublishing(true);
    setPublishMsg("");
    try {
      const res = await sendMessage({ type: "PUBLISH", url: page.url });
      if (res.ok && "published" in res) {
        const p = res.published;
        setPublishMsg(`已发布到 ${p.relays_ok} 个中继${p.relays_failed ? `（${p.relays_failed} 个失败）` : ""} · ${p.npub.slice(0, 12)}…`);
      } else if (!res.ok) {
        setPublishMsg(res.error);
      }
    } finally {
      setPublishing(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !hasRunFull && !loading) void runFullAssessment(false);
  }

  if (!assessment) return null;

  return (
    <div className="nsm-root">
      {open ? (
        <div className="nsm-panel">
          <div className="nsm-panel-head">
            <span className="nsm-panel-title">信源可信度{loading ? " · 评估中…" : ""}</span>
            <button className="nsm-close" onClick={() => setOpen(false)} aria-label="关闭">
              ×
            </button>
          </div>
          <CredibilityCard assessment={assessment}>
            <div className="nsm-actions">
              <button
                className="nsm-btn"
                onClick={() => runFullAssessment(true)}
                disabled={loading}
              >
                {loading ? "评估中…" : hasRunFull ? "重新评估" : "评估"}
              </button>
              <button className="nsm-btn" onClick={endorse} disabled={publishing}>
                {publishing ? "发布中…" : "背书（发布到 Nostr）"}
              </button>
              <button className="nsm-btn" onClick={() => chrome.runtime.openOptionsPage()}>
                设置
              </button>
            </div>
            {publishMsg ? (
              <div className="cred-disclaim" style={{ borderTop: "none", paddingTop: 8 }}>
                {publishMsg}
              </div>
            ) : null}
            {!llmConfigured ? (
              <div className="cred-disclaim" style={{ borderTop: "none", paddingTop: 8 }}>
                未配置 LLM key，当前仅含来源信誉与社区存证。点「设置」添加你自己的 key 启用现场评估。
              </div>
            ) : null}
          </CredibilityCard>
        </div>
      ) : null}

      <div className="nsm-badge" onClick={toggle} title="信源可信度">
        <span className="nsm-badge-dot" style={{ background: scoreColor(assessment.score) }} />
        <span className="nsm-badge-num" style={{ color: scoreColor(assessment.score) }}>
          {loading ? "…" : assessment.score}
        </span>
        <span className="nsm-badge-label">可信度</span>
      </div>
    </div>
  );
}
