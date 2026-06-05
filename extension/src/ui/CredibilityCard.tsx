import type { Assessment } from "../lib/types";
import { consistencyLabel, reputationLabel, scoreColor } from "./score";

interface Props {
  assessment: Assessment;
  /** optional footer actions (e.g. Nostr endorse button, Phase 3) */
  children?: React.ReactNode;
}

/** Mirrors the server's CredibilityCard (web/app/news/[id]/page.tsx). */
export function CredibilityCard({ assessment, children }: Props) {
  const { signals, breakdown } = assessment;
  const llm = signals.llm;
  return (
    <div className="cred-card">
      <div>
        <span className="cred-score" style={{ color: scoreColor(assessment.score) }}>
          {assessment.score}
        </span>
        <span className="cred-score-suffix"> / 100 可信度信号</span>
      </div>
      <div className="cred-bar">
        <div
          className="cred-bar-fill"
          style={{ width: `${Math.max(0, Math.min(100, assessment.score))}%` }}
        />
      </div>
      <div className="cred-rows">
        <div className="cred-row">
          <span className="cred-row-key">来源信誉</span>
          <span className="cred-row-val">
            {reputationLabel(signals.reputation.label)} · 权重{" "}
            {signals.reputation.weight.toFixed(2)}
            {signals.reputation.matched_domain ? ` (${signals.reputation.matched_domain})` : ""}
          </span>
        </div>
        <div className="cred-row">
          <span className="cred-row-key">LLM 一致性</span>
          <span className="cred-row-val">
            {assessment.llm_used
              ? `${consistencyLabel(llm.consistency)} · ${llm.score}/100`
              : "未评估"}
          </span>
        </div>
        <div className="cred-row">
          <span className="cred-row-key">多源印证</span>
          <span className="cred-row-val">
            {signals.corroboration.count > 0
              ? `${signals.corroboration.count} 家`
              : "—"}
          </span>
        </div>
        <div className="cred-row">
          <span className="cred-row-key">社区存证</span>
          <span className="cred-row-val">
            {signals.community.count > 0
              ? `${signals.community.count} 人 · ${signals.community.weighted_score}/100`
              : "—"}
          </span>
        </div>
      </div>
      {llm.summary ? (
        <div className="cred-disclaim" style={{ borderTop: "none", paddingTop: 8 }}>
          {llm.summary}
        </div>
      ) : null}
      <div className="cred-disclaim">
        信号加权：信誉 {breakdown.reputation_score} · LLM {breakdown.llm_score} · 印证{" "}
        {breakdown.corroboration_score} · 社区 {breakdown.community_score}。此评分为可信度信号的加权汇总，不构成对事件真伪的最终判定。
      </div>
      {children}
    </div>
  );
}
