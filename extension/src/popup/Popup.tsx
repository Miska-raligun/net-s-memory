import { useEffect, useState } from "react";
import { CredibilityCard } from "../ui/CredibilityCard";
import { sendMessage } from "../lib/messages";
import { getLlmConfig } from "../lib/storage";
import type { Assessment } from "../lib/types";

type State =
  | { kind: "loading" }
  | { kind: "none"; url: string }
  | { kind: "ready"; assessment: Assessment };

export function Popup() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [llmConfigured, setLlmConfigured] = useState(false);

  useEffect(() => {
    (async () => {
      setLlmConfigured((await getLlmConfig()) !== null);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? "";
      if (!url || !/^https?:/.test(url)) {
        setState({ kind: "none", url });
        return;
      }
      const res = await sendMessage({ type: "GET_CACHED", url });
      if (res.ok && res.assessment) {
        setState({ kind: "ready", assessment: res.assessment });
      } else {
        setState({ kind: "none", url });
      }
    })();
  }, []);

  return (
    <div className="nsm-root" style={{ width: 320, padding: 14, background: "var(--bg-surface)" }}>
      <div className="nsm-panel-head">
        <span className="nsm-panel-title">互联网记忆 · 信源可信度</span>
      </div>

      {state.kind === "loading" ? <div className="nsm-muted">加载中…</div> : null}

      {state.kind === "none" ? (
        <div className="nsm-muted" style={{ lineHeight: 1.6 }}>
          当前页面还没有可信度评估。打开一篇新闻正文页，页面右下角会出现可信度徽章；点开徽章即可用你自己的 LLM 评估。
        </div>
      ) : null}

      {state.kind === "ready" ? <CredibilityCard assessment={state.assessment} /> : null}

      <div className="nsm-actions">
        <button className="nsm-btn" onClick={() => chrome.runtime.openOptionsPage()}>
          设置 {llmConfigured ? "" : "（未配置 LLM key）"}
        </button>
      </div>
    </div>
  );
}
