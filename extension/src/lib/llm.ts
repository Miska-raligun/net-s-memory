// Client-side LLM credibility check. Runs in the background service worker
// and calls the *user's own* endpoint (OpenAI-compatible or Anthropic) with
// the user's own key — no third-party server is involved.
//
// Mirrors the intent of backend/app/analyze/llm_check.py: produce a 0-100
// plausibility score, a consistency bucket, and a one-line rationale.

import type { Consistency, LlmConfig } from "./types";

export interface LlmCheckInput {
  title: string;
  text: string;
  domain: string;
  reputationLabel: string;
}

export interface LlmCheckResult {
  score: number;
  consistency: Consistency;
  summary: string;
}

export class LlmError extends Error {}

const SYSTEM_PROMPT =
  "你是一个严谨的新闻可信度评估助手。基于文本的内在一致性、可核验性、是否含夸张/情绪化/未具名信源等特征，" +
  "给出一个 0-100 的可信度信号分（不是对真假的最终判定）。" +
  '只输出 JSON：{"score": <0-100整数>, "consistency": "high|medium|low|contradictory", "summary": "<不超过40字的中文理由>"}。';

function buildUserPrompt(input: LlmCheckInput): string {
  return [
    `来源域名：${input.domain}（种子信誉：${input.reputationLabel}）`,
    `标题：${input.title}`,
    "正文（可能被截断）：",
    input.text,
  ].join("\n");
}

const VALID_CONSISTENCY: Consistency[] = [
  "high",
  "medium",
  "low",
  "contradictory",
];

function coerceResult(obj: unknown): LlmCheckResult {
  if (typeof obj !== "object" || obj === null) {
    throw new LlmError("LLM 返回的不是 JSON 对象");
  }
  const rec = obj as Record<string, unknown>;
  const rawScore = Number(rec.score);
  if (!Number.isFinite(rawScore)) throw new LlmError("LLM 未返回 score");
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const consistency = VALID_CONSISTENCY.includes(rec.consistency as Consistency)
    ? (rec.consistency as Consistency)
    : "unknown";
  const summary = typeof rec.summary === "string" ? rec.summary.slice(0, 200) : "";
  return { score, consistency, summary };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new LlmError("无法从 LLM 输出解析 JSON");
  }
}

async function callOpenAi(config: LlmConfig, input: LlmCheckInput): Promise<string> {
  const url = config.base_url.replace(/\/$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new LlmError(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LlmError("LLM 响应缺少 content");
  return content;
}

async function callAnthropic(config: LlmConfig, input: LlmCheckInput): Promise<string> {
  const url = config.base_url.replace(/\/$/, "") + "/v1/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.api_key,
      "anthropic-version": "2023-06-01",
      // Required for direct browser-origin calls to the Anthropic API.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    }),
  });
  if (!res.ok) {
    throw new LlmError(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.content?.[0]?.text;
  if (typeof content !== "string") throw new LlmError("LLM 响应缺少 content");
  return content;
}

export async function runLlmCheck(
  config: LlmConfig,
  input: LlmCheckInput,
): Promise<LlmCheckResult> {
  const raw =
    config.provider === "anthropic"
      ? await callAnthropic(config, input)
      : await callOpenAi(config, input);
  return coerceResult(extractJson(raw));
}
