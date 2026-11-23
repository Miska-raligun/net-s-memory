import { useEffect, useState } from "react";
import {
  DEFAULT_ARCHIVE_SETTINGS,
  getArchiveSettings,
  setArchiveSettings,
  type ArchiveSettings as Settings,
} from "../lib/storage";

type BoolKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

const TOGGLES: { key: BoolKey; label: string; hint: string }[] = [
  { key: "ots", label: "比特币时间戳（OpenTimestamps）", hint: "只把正文哈希（加随机盐）发给公共日历服务器，不发送正文。" },
  { key: "wayback", label: "同时提交到 Internet Archive", hint: "让 archive.org 自己抓一份第三方快照。会让 archive.org 看到这个链接和你的 IP。" },
  { key: "screenshot", label: "本地保存截图", hint: "保存可视区域截图，仅存本机。" },
  { key: "html", label: "本地保存原始 HTML", hint: "仅存本机。" },
  { key: "publish_screenshot", label: "发布见证时上传截图", hint: "截图可能包含你的登录头像/昵称，默认关闭。" },
  { key: "publish_html", label: "发布见证时上传 HTML", hint: "登录状态下的 HTML 常含你的账号信息，默认关闭。" },
  { key: "hide_domestic", label: "查找其他报道时隐藏境内来源", hint: "只显示境外站点的报道，作为不受同一删帖压力影响的独立印证。" },
];

export function ArchiveSettings() {
  const [s, setS] = useState<Settings>(DEFAULT_ARCHIVE_SETTINGS);
  const [servers, setServers] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    void getArchiveSettings().then((v) => {
      setS(v);
      setServers(v.blossom_servers.join("\n"));
    });
  }, []);

  async function save() {
    const list = servers
      .split("\n")
      .map((x) => x.trim())
      .filter((x) => /^https:\/\//.test(x));
    const next = { ...s, blossom_servers: list };
    await setArchiveSettings(next);
    setS(next);
    setServers(list.join("\n"));
    setStatus("已保存");
  }

  return (
    <>
      <h1 style={{ marginTop: 32 }}>存档与搜索</h1>
      <div className="sub">
        存档默认只保存在本机。正文的 SHA-256 是大家可以比对的证据；「发布见证」是显式操作，
        会用你的 Nostr 身份签名后发到中继。
      </div>

      {TOGGLES.map((t) => (
        <label key={t.key} className="nsm-check">
          <input type="checkbox" checked={s[t.key]} onChange={(e) => setS({ ...s, [t.key]: e.target.checked })} />
          <span>
            {t.label}
            <span className="nsm-check-hint">{t.hint}</span>
          </span>
        </label>
      ))}

      <div className="nsm-field" style={{ marginTop: 12 }}>
        <label>「查找其他报道」使用的搜索引擎（在你自己的浏览器里打开，不调用任何搜索 API）</label>
        <select value={s.search_engine} onChange={(e) => setS({ ...s, search_engine: e.target.value as Settings["search_engine"] })}>
          <option value="google">Google</option>
          <option value="bing">必应国际版（www.bing.com，ensearch=1）</option>
        </select>
      </div>

      <div className="nsm-field">
        <label>Blossom 服务器（每行一个 https:// 地址；留空则不上传任何文件，超长正文无法发布）</label>
        <textarea
          rows={3}
          value={servers}
          placeholder="https://blossom.example.com"
          onChange={(e) => setServers(e.target.value)}
          className="nsm-textarea"
        />
      </div>

      <button className="nsm-save" onClick={save}>
        保存存档设置
      </button>
      {status ? <div className="nsm-status">{status}</div> : null}
    </>
  );
}
