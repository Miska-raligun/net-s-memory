import { useEffect, useState } from "react";
import { getLlmConfig, setLlmConfig } from "../lib/storage";
import type { LlmConfig } from "../lib/types";

interface Preset {
  name: string;
  config: Omit<LlmConfig, "api_key">;
}

const PRESETS: Preset[] = [
  { name: "DeepSeek", config: { provider: "openai", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" } },
  { name: "SiliconFlow", config: { provider: "openai", base_url: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" } },
  { name: "OpenAI", config: { provider: "openai", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" } },
  { name: "Anthropic", config: { provider: "anthropic", base_url: "https://api.anthropic.com", model: "claude-haiku-4-5-20251001" } },
];

const EMPTY: LlmConfig = { provider: "openai", base_url: "", api_key: "", model: "" };

export function Options() {
  const [cfg, setCfg] = useState<LlmConfig>(EMPTY);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getLlmConfig().then((c) => {
      if (c) setCfg(c);
    });
  }, []);

  function applyPreset(p: Preset) {
    setCfg((prev) => ({ ...prev, ...p.config }));
    setStatus("");
  }

  function update<K extends keyof LlmConfig>(key: K, value: LlmConfig[K]) {
    setCfg((prev) => ({ ...prev, [key]: value }));
    setStatus("");
  }

  async function save() {
    await setLlmConfig(cfg);
    setStatus("已保存 ✓");
  }

  async function clearAll() {
    await setLlmConfig(null);
    setCfg(EMPTY);
    setStatus("已清除");
  }

  return (
    <div className="nsm-root nsm-options">
      <h1>互联网记忆 · 信源可信度</h1>
      <div className="sub">
        去中心化、零自建服务器。可信度评估调用<strong>你自己的 LLM key</strong>，在本地完成；
        正文只会发给你填写的端点，不经过任何第三方服务器。
      </div>

      <div className="nsm-presets">
        {PRESETS.map((p) => (
          <button key={p.name} className="nsm-preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="nsm-field">
        <label>协议</label>
        <select
          value={cfg.provider}
          onChange={(e) => update("provider", e.target.value as LlmConfig["provider"])}
        >
          <option value="openai">OpenAI 兼容（DeepSeek / SiliconFlow / OpenAI 等）</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </div>

      <div className="nsm-field">
        <label>API Base URL</label>
        <input
          value={cfg.base_url}
          placeholder="https://api.deepseek.com/v1"
          onChange={(e) => update("base_url", e.target.value)}
        />
      </div>

      <div className="nsm-field">
        <label>模型</label>
        <input
          value={cfg.model}
          placeholder="deepseek-chat"
          onChange={(e) => update("model", e.target.value)}
        />
      </div>

      <div className="nsm-field">
        <label>API Key</label>
        <input
          type="password"
          value={cfg.api_key}
          placeholder="sk-..."
          onChange={(e) => update("api_key", e.target.value)}
        />
      </div>

      <button className="nsm-save" onClick={save}>
        保存
      </button>
      <button className="nsm-clear" onClick={clearAll}>
        清除
      </button>
      {status ? <div className="nsm-status">{status}</div> : null}

      <div className="nsm-note">
        Key 仅保存在浏览器本地（chrome.storage.local），不上传、不同步。
        后续版本将加入 Nostr 身份与 P2P 社区存证（去中心化协同），届时密钥会用口令派生加密存储。
      </div>
    </div>
  );
}
