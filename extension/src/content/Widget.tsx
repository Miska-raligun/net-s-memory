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
  const [loadingLlm, setLoadingLlm] = useState(false);

  // Instant, network-free preview from cache or reputation-only scoring.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLlmConfigured((await getLlmConfig()) !== null);
      const cached = await sendMessage({ type: "GET_CACHED", url: page.url });
      if (!alive) return;
      if (cached.ok && cached.assessment) {
        setAssessment(cached.assessment);
      } else {
        // reputation-only; passing null config means no LLM call / no fetch
        setAssessment(await assessPage(page, null));
      }
    })();
    return () => {
      alive = false;
    };
  }, [page]);

  // Run the (paid) LLM check lazily, the first time the panel is opened.
  async function runFullAssessment(force = false) {
    setLoadingLlm(true);
    try {
      const res = await sendMessage({ type: "ASSESS", page, force });
      if (res.ok && res.assessment) setAssessment(res.assessment);
    } finally {
      setLoadingLlm(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && llmConfigured && assessment && !assessment.llm_used && !loadingLlm) {
      void runFullAssessment(false);
    }
  }

  if (!assessment) return null;

  return (
    <div className="nsm-root">
      {open ? (
        <div className="nsm-panel">
          <div className="nsm-panel-head">
            <span className="nsm-panel-title">信源可信度</span>
            <button className="nsm-close" onClick={() => setOpen(false)} aria-label="关闭">
              ×
            </button>
          </div>
          <CredibilityCard assessment={assessment}>
            <div className="nsm-actions">
              <button
                className="nsm-btn"
                onClick={() => runFullAssessment(true)}
                disabled={loadingLlm || !llmConfigured}
                title={llmConfigured ? "" : "请先在设置里配置 LLM key"}
              >
                {loadingLlm ? "评估中…" : assessment.llm_used ? "重新评估" : "用 LLM 评估"}
              </button>
              <button
                className="nsm-btn"
                onClick={() => chrome.runtime.openOptionsPage()}
              >
                设置
              </button>
            </div>
            {!llmConfigured ? (
              <div className="cred-disclaim" style={{ borderTop: "none", paddingTop: 8 }}>
                未配置 LLM key，当前仅显示来源信誉先验。点击「设置」添加你自己的 key。
              </div>
            ) : null}
          </CredibilityCard>
        </div>
      ) : null}

      <div className="nsm-badge" onClick={toggle} title="信源可信度">
        <span className="nsm-badge-dot" style={{ background: scoreColor(assessment.score) }} />
        <span className="nsm-badge-num" style={{ color: scoreColor(assessment.score) }}>
          {loadingLlm ? "…" : assessment.score}
        </span>
        <span className="nsm-badge-label">可信度</span>
      </div>
    </div>
  );
}
