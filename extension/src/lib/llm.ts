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

// The archive keeps the full text; only the LLM prompt is capped.
const MAX_LLM_TEXT_CHARS = 8000;

function buildUserPrompt(input: LlmCheckInput): string {
  return [
    `来源域名：${input.domain}（种子信誉：${input.reputationLabel}）`,
    `标题：${input.title}`,
    "正文（可能被截断）：",
    input.text.slice(0, MAX_LLM_TEXT_CHARS),
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

async function callOpenAi(config: LlmConfig, system: string, user: string, maxTokens = 400): Promise<string> {
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
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
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

async function callAnthropic(config: LlmConfig, system: string, user: string, maxTokens = 400): Promise<string> {
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
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
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
      ? await callAnthropic(config, SYSTEM_PROMPT, buildUserPrompt(input))
      : await callOpenAi(config, SYSTEM_PROMPT, buildUserPrompt(input));
  return coerceResult(extractJson(raw));
}

// --- Verification checklist (assistant only; never counted as a judgment) ---

const CHECKLIST_PROMPT =
  "你是事实核查助手。不要判断真假，只把文章里可以被核实的具体事实断言列出来（谁、何时、何地、数字、引语、因果），" +
  "并为每条给出一个具体的核实途径（例如：查某机构的公告、对照另一家独立媒体的报道、查原始文件）。最多 8 条，按重要性排序。" +
  '只输出 JSON：{"claims": [{"claim": "<不超过60字>", "how_to_verify": "<不超过60字>"}]}。';

export interface ChecklistItem {
  claim: string;
  how_to_verify: string;
}

export async function runClaimChecklist(
  config: LlmConfig,
  input: { title: string; text: string },
): Promise<ChecklistItem[]> {
  const user = `标题：${input.title}\n正文（可能被截断）：\n${input.text.slice(0, MAX_LLM_TEXT_CHARS)}`;
  const raw =
    config.provider === "anthropic"
      ? await callAnthropic(config, CHECKLIST_PROMPT, user, 900)
      : await callOpenAi(config, CHECKLIST_PROMPT, user, 900);
  const parsed = extractJson(raw) as { claims?: unknown };
  if (!Array.isArray(parsed?.claims)) throw new LlmError("LLM 没有返回要点列表");
  return parsed.claims
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      claim: String(c.claim ?? "").slice(0, 120),
      how_to_verify: String(c.how_to_verify ?? "").slice(0, 120),
    }))
    .filter((c) => c.claim)
    .slice(0, 8);
}
