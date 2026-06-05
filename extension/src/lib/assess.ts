// Orchestrates a full credibility assessment for one page by combining the
// available signals. In Phase 1 only reputation + LLM are live; corroboration
// and community are placeholders that the Nostr layer will fill in later.

import { runLlmCheck, LlmError } from "./llm";
import { lookupReputation } from "./reputation";
import { combineSignals } from "./scoring";
import { extractDomain, normalizeUrl } from "./url";
import type { Assessment, CommunitySignal, LlmConfig, LlmSignal, SignalSet } from "./types";
import type { PageInfo } from "./messages";

function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

const EMPTY_COMMUNITY: CommunitySignal = { count: 0, weighted_score: null };

export async function assessPage(
  page: PageInfo,
  llmConfig: LlmConfig | null,
  community: CommunitySignal = EMPTY_COMMUNITY,
): Promise<Assessment> {
  const url = normalizeUrl(page.url);
  const domain = extractDomain(url) ?? "";
  const reputation = lookupReputation(domain);

  let llm: LlmSignal = {
    score: null,
    consistency: "unknown",
    summary: llmConfig ? "" : "未配置 LLM key，仅依据来源信誉先验",
    model: llmConfig?.model ?? null,
  };
  let llm_used = false;

  if (llmConfig) {
    try {
      const r = await runLlmCheck(llmConfig, {
        title: page.title,
        text: page.text,
        domain,
        reputationLabel: reputation.label,
      });
      llm = { score: r.score, consistency: r.consistency, summary: r.summary, model: llmConfig.model };
      llm_used = true;
    } catch (e) {
      llm = {
        score: null,
        consistency: "unknown",
        summary: e instanceof LlmError ? e.message : "LLM 调用失败",
        model: llmConfig.model,
      };
    }
  }

  const signals: SignalSet = {
    reputation,
    llm,
    corroboration: { count: 0, sources: [] },
    community,
  };
  const breakdown = combineSignals(signals);

  return {
    schema: "assessment.v1",
    url,
    domain,
    title: page.title,
    score: breakdown.total,
    breakdown,
    signals,
    generated_at: isoSeconds(new Date()),
    llm_used,
  };
}
