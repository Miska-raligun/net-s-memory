import { useEffect, useState } from "react";
import { sendMessage } from "../lib/messages";
import { getArchiveSettings, setArchiveSettings } from "../lib/storage";
import { npubOf, shortNpub, type TrustEntry } from "../lib/trustlist";

export function TrustSettings() {
  const [list, setList] = useState<TrustEntry[]>([]);
  const [input, setInput] = useState("");
  const [label, setLabel] = useState("");
  const [importInput, setImportInput] = useState("");
  const [usePublic, setUsePublic] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void sendMessage({ type: "TRUST_LIST" }).then((res) => {
      if (res.ok && "trust" in res) setList(res.trust);
    });
    void getArchiveSettings().then((s) => setUsePublic(s.use_public_follows));
  }, []);

  async function run(fn: () => ReturnType<typeof sendMessage>, ok: (r: Awaited<ReturnType<typeof sendMessage>>) => string) {
    setBusy(true);
    setStatus("");
    try {
      const res = await fn();
      if (res.ok && "trust" in res) {
        setList(res.trust);
        setStatus(ok(res));
      } else if (!res.ok) setStatus(res.error);
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    await run(
      () => sendMessage({ type: "TRUST_ADD", input, label }),
      () => {
        setInput("");
        setLabel("");
        return "已加入";
      },
    );
  }

  async function relabel(e: TrustEntry) {
    const next = window.prompt(`修改备注：${shortNpub(e.pubkey)}`, e.label);
    if (next === null) return;
    await run(() => sendMessage({ type: "TRUST_ADD", input: e.pubkey, label: next }), () => "已更新");
  }

  async function importFrom() {
    await run(
      () => sendMessage({ type: "TRUST_IMPORT", input: importInput }),
      (r) => {
        setImportInput("");
        const x = r as { added?: number; found?: number };
        return `读到 ${x.found ?? 0} 个关注，新增 ${x.added ?? 0} 个`;
      },
    );
  }

  async function togglePublic(v: boolean) {
    setUsePublic(v);
    const s = await getArchiveSettings();
    await setArchiveSettings({ ...s, use_public_follows: v });
  }

  const sorted = [...list].sort(
    (a, b) => Number(b.source === "manual") - Number(a.source === "manual") || (a.label || "~").localeCompare(b.label || "~"),
  );

  return (
    <>
      <h1 style={{ marginTop: 32 }}>我信任的见证人</h1>
      <div className="sub">
        「N 人见证」里的人数可以靠随意生成密钥来伪造，所以你信任的人会单独标出（✓）并优先排序。
        这个列表<strong>只保存在本机，不会发布</strong>，别人看不到你信任谁。
        在网页上的「网络见证」里，也可以直接点见证人旁边的「信任」。
      </div>

      <div className="nsm-field">
        <label>对方的 npub（或 64 位十六进制公钥）</label>
        <input value={input} placeholder="npub1..." onChange={(e) => setInput(e.target.value)} />
      </div>
      <div className="nsm-field">
        <label>备注（可选，只有你看得到）</label>
        <input value={label} placeholder="例如：老王（调查记者）" onChange={(e) => setLabel(e.target.value)} />
      </div>
      <button className="nsm-save" onClick={add} disabled={busy || !input.trim()}>
        加入信任列表
      </button>

      <div className="nsm-trust-list">
        {sorted.length === 0 ? (
          <div className="nsm-check-hint">还没有信任任何人。</div>
        ) : (
          sorted.map((e) => (
            <div key={e.pubkey} className="nsm-trust-row">
              <div>
                <div>{e.label || <span className="nsm-check-hint">（无备注）</span>}</div>
                <div className="nsm-check-hint" title={npubOf(e.pubkey)}>
                  {shortNpub(e.pubkey)}
                  {e.source !== "manual" ? ` · 从 ${e.source.slice(7, 19)}… 的关注导入` : ""}
                </div>
              </div>
              <div className="nsm-trust-actions">
                <button className="nsm-preset" disabled={busy} onClick={() => relabel(e)}>
                  备注
                </button>
                <button
                  className="nsm-preset"
                  disabled={busy}
                  onClick={() => run(() => sendMessage({ type: "TRUST_REMOVE", pubkey: e.pubkey }), () => "已移除")}
                >
                  移除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="nsm-field" style={{ marginTop: 16 }}>
        <label>从某人的公开关注列表导入（只读取，不会替你关注任何人）</label>
        <input value={importInput} placeholder="你信任的人的 npub" onChange={(e) => setImportInput(e.target.value)} />
      </div>
      <button className="nsm-preset" onClick={importFrom} disabled={busy || !importInput.trim()}>
        导入他关注的人
      </button>

      <label className="nsm-check" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={usePublic} onChange={(e) => void togglePublic(e.target.checked)} />
        <span>
          同时信任我这个 Nostr 身份公开关注的人
          <span className="nsm-check-hint">
            如果你用同一个 nsec 在其他 Nostr 客户端里关注过别人，会一并计入。扩展只读取这份列表，从不修改或发布它。
          </span>
        </span>
      </label>
      {status ? <div className="nsm-status">{status}</div> : null}
    </>
  );
}
