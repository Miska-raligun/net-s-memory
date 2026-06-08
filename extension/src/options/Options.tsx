import { useEffect, useState } from "react";
import {
  DEFAULT_RELAYS,
  getLlmConfig,
  getNostrSk,
  getRelays,
  setLlmConfig,
  setNostrSk,
  setRelays,
} from "../lib/storage";
import { createIdentity, identityFromSk, importNsec, nsecOf } from "../lib/nostr/keys";
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

  const [npub, setNpub] = useState<string | null>(null);
  const [relaysText, setRelaysText] = useState(DEFAULT_RELAYS.join("\n"));
  const [nostrStatus, setNostrStatus] = useState("");
  const [nsecInput, setNsecInput] = useState("");

  useEffect(() => {
    getLlmConfig().then((c) => {
      if (c) setCfg(c);
    });
    getNostrSk().then((sk) => {
      if (sk) setNpub(identityFromSk(sk).npub);
    });
    getRelays().then((r) => setRelaysText(r.join("\n")));
  }, []);

  async function generateNostr() {
    const id = createIdentity();
    await setNostrSk(id.skHex);
    setNpub(id.npub);
    setNostrStatus("已生成新身份 ✓");
  }

  async function importNostr() {
    try {
      const id = importNsec(nsecInput);
      await setNostrSk(id.skHex);
      setNpub(id.npub);
      setNsecInput("");
      setNostrStatus("已导入身份 ✓");
    } catch (e) {
      setNostrStatus(e instanceof Error ? e.message : "导入失败");
    }
  }

  async function exportNsec() {
    const sk = await getNostrSk();
    if (!sk) return;
    await navigator.clipboard.writeText(nsecOf(sk));
    setNostrStatus("nsec 私钥已复制到剪贴板（请妥善保管）");
  }

  async function saveRelays() {
    const relays = relaysText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("ws"));
    await setRelays(relays.length > 0 ? relays : DEFAULT_RELAYS);
    setNostrStatus("中继已保存 ✓");
  }

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

      <h1 style={{ marginTop: 32 }}>Nostr 身份与中继</h1>
      <div className="sub">
        去中心化协同层：你的可信度背书会用下面这把 Nostr 密钥签名后发布到公共中继，
        别人客户端验签后按「关注网络」加权计入分数。无需任何自建服务器。
      </div>

      <div className="nsm-field">
        <label>当前身份（npub）</label>
        <input readOnly value={npub ?? "尚未创建——首次背书会自动生成，或在此手动创建"} />
      </div>

      <div className="nsm-presets">
        <button className="nsm-preset" onClick={generateNostr}>
          {npub ? "重新生成" : "生成身份"}
        </button>
        <button className="nsm-preset" onClick={exportNsec} disabled={!npub}>
          导出 nsec
        </button>
      </div>

      <div className="nsm-field">
        <label>导入已有 nsec 私钥</label>
        <input
          type="password"
          value={nsecInput}
          placeholder="nsec1..."
          onChange={(e) => setNsecInput(e.target.value)}
        />
      </div>
      <button className="nsm-preset" onClick={importNostr} disabled={!nsecInput}>
        导入
      </button>

      <div className="nsm-field" style={{ marginTop: 16 }}>
        <label>中继列表（每行一个 wss:// 地址）</label>
        <textarea
          value={relaysText}
          onChange={(e) => setRelaysText(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "9px 11px",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text)",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
          }}
        />
      </div>
      <button className="nsm-save" onClick={saveRelays}>
        保存中继
      </button>
      {nostrStatus ? <div className="nsm-status">{nostrStatus}</div> : null}

      <div className="nsm-note">
        所有密钥仅保存在浏览器本地（chrome.storage.local），不上传、不同步。
        正文只发给你配置的 LLM 端点；背书是显式操作，默认不会自动广播你的浏览行为。
        ⚠️ nsec 是你的私钥，泄露等于身份被盗，请像对待助记词一样保管。
      </div>
    </div>
  );
}
