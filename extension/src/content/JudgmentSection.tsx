// 真实性判断: what people think about whether this text version is true,
// with reasons and archived evidence — and your own judgment.
//
// Design rules (see README): judgments attach to a text hash, evidence must be
// archived, search results are only leads, reposts of the same wire copy do
// not count as independent sources, and there is no single "truth score":
// only the distribution among people you trust, with strangers shown apart.

import { useEffect, useState } from "react";
import {
  RELATIONS,
  RELATION_LABEL,
  VERDICTS,
  VERDICT_LABEL,
  REASON_MIN,
  type ParsedJudgment,
  type Relation,
  type Verdict,
} from "../lib/archive/judgment";
import type { EvidenceReport, JudgmentView } from "../background/judgment";
import type { ChecklistItem } from "../lib/llm";
import { sendMessage } from "../lib/messages";
import type { CaptureSummary } from "../lib/storage";
import { shortNpub } from "../lib/trustlist";

interface Props {
  url: string;
  target: CaptureSummary;
  evidenceTick: number;
  onEvidenceChanged: () => void;
}

const VERDICT_CLASS: Record<Verdict, string> = {
  true: "arc-v-true",
  mostly_true: "arc-v-true",
  disputed: "arc-v-disputed",
  false: "arc-v-false",
  unverifiable: "arc-v-unknown",
};

function Counts({ counts }: { counts: Record<Verdict, number> }) {
  const parts = VERDICTS.filter((v) => counts[v] > 0);
  if (parts.length === 0) return <span className="arc-dim">无</span>;
  return (
    <span className="arc-counts">
      {parts.map((v) => (
        <span key={v} className={`arc-verdict ${VERDICT_CLASS[v]}`}>
          {VERDICT_LABEL[v]} {counts[v]}
        </span>
      ))}
    </span>
  );
}

export function JudgmentSection({ url, target, evidenceTick, onEvidenceChanged }: Props) {
  const [view, setView] = useState<JudgmentView | null>(null);
  const [evidence, setEvidence] = useState<EvidenceReport | null>(null);
  const [candidates, setCandidates] = useState<CaptureSummary[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [reason, setReason] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [busy, setBusy] = useState<"" | "query" | "publish" | "checklist" | "fetch">("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);

  async function loadEvidence() {
    const res = await sendMessage({ type: "EVIDENCE_REPORT", target: target.text_sha256 });
    if (res.ok && "evidence" in res) setEvidence(res.evidence);
    const all = await sendMessage({ type: "LIST_CAPTURES" });
    if (all.ok && "captures" in all) {
      setCandidates(all.captures.filter((c) => c.text_sha256 !== target.text_sha256));
    }
  }

  useEffect(() => {
    void loadEvidence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.text_sha256, evidenceTick]);

  async function query(keepMsg = false) {
    setBusy("query");
    if (!keepMsg) setMsg("");
    try {
      const res = await sendMessage({ type: "QUERY_JUDGMENTS", text_sha256: target.text_sha256 });
      if (res.ok && "judgments" in res) {
        setView(res.judgments);
        const mine = res.judgments.mine;
        if (mine && !verdict && !reason) {
          setVerdict(mine.content.verdict);
          setReason(mine.content.reason);
        }
      } else if (!res.ok) setMsg(res.error);
    } finally {
      setBusy("");
    }
  }

  async function setRelation(captureId: string, relation: Relation | null) {
    const res = await sendMessage({ type: "EVIDENCE_UPDATE", target: target.text_sha256, capture_id: captureId, relation });
    if (res.ok && "evidence" in res) setEvidence(res.evidence);
    onEvidenceChanged();
  }

  async function addLocal(captureId: string) {
    if (!captureId) return;
    const res = await sendMessage({ type: "EVIDENCE_ADD", target: target.text_sha256, capture_id: captureId });
    if (res.ok && "evidence" in res) setEvidence(res.evidence);
    else if (!res.ok) setMsg(res.error);
  }

  async function fetchEvidence(sha: string) {
    setBusy("fetch");
    setMsg("");
    try {
      const res = await sendMessage({ type: "FETCH_EVIDENCE", text_sha256: sha });
      if (res.ok && "capture" in res) {
        setMsg(`已取回证据：${res.capture.title}`);
        await sendMessage({ type: "OPEN_ARCHIVE", id: res.capture.id });
      } else if (!res.ok) setMsg(res.error);
    } finally {
      setBusy("");
    }
  }

  async function checklistNow() {
    setBusy("checklist");
    setMsg("");
    try {
      const res = await sendMessage({ type: "CLAIM_CHECKLIST", text_sha256: target.text_sha256 });
      if (res.ok && "checklist" in res) setChecklist(res.checklist);
      else if (!res.ok) setMsg(res.error);
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    if (!verdict) return;
    const unpublished = evidence?.items.filter((e) => !e.published).length ?? 0;
    const ok = window.confirm(
      `将用你的 Nostr 身份公开发布这条判断「${VERDICT_LABEL[verdict]}」。` +
        (unpublished ? `\n另外会为 ${unpublished} 份证据一并发布存档见证，方便别人取回核对。` : "") +
        "\n这是你个人的公开观点，请确认理由与证据属实。",
    );
    if (!ok) return;
    setBusy("publish");
    setMsg("");
    try {
      const res = await sendMessage({ type: "PUBLISH_JUDGMENT", url, text_sha256: target.text_sha256, verdict, reason });
      if (res.ok && "judged" in res) {
        const j = res.judged;
        setMsg(
          `判断已发布到 ${j.published.relays_ok} 个中继` +
            (j.witnessed ? `，并为 ${j.witnessed} 份证据发布了见证` : "") +
            `（共引用 ${j.evidence} 份证据）`,
        );
        await loadEvidence();
        await query(true); // refresh without wiping the success message
      } else if (!res.ok) setMsg(res.error);
    } finally {
      setBusy("");
    }
  }

  const who = (pk: string) => (view?.self === pk ? "你" : view?.labels[pk] || shortNpub(pk));
  const reasonLen = [...reason.trim()].length;
  const evIds = new Set(evidence?.items.map((e) => e.capture_id));

  const renderItem = (j: ParsedJudgment) => (
    <div key={j.event_id} className="arc-judgment">
      <div className="arc-row">
        <span>
          <span className={`arc-verdict ${VERDICT_CLASS[j.content.verdict]}`}>{VERDICT_LABEL[j.content.verdict]}</span>{" "}
          {who(j.pubkey)}
        </span>
        <span className="arc-dim">{new Date(j.created_at * 1000).toLocaleDateString("zh-CN")}</span>
      </div>
      <div className="arc-reason">{j.content.reason}</div>
      {j.content.evidence.map((e) => (
        <div key={e.text_sha256} className="arc-dim arc-row">
          <span>
            [{RELATION_LABEL[e.relation]}] {e.title || e.url}
          </span>
          <button className="nsm-link" disabled={busy !== ""} onClick={() => fetchEvidence(e.text_sha256)}>
            取回
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="arc-witness">
      <div className="arc-row">
        <span className="arc-section-title">真实性判断</span>
        <button className="nsm-link" onClick={() => setOpen(!open)}>
          {open ? "收起" : "展开"}
        </button>
      </div>
      <div className="arc-dim">
        判断针对的是这一版正文（{target.text_sha256.slice(0, 10)}…）。每条都是某个公钥的个人观点，不是平台结论。
      </div>
      {!open ? null : (
        <>
          <div className="nsm-actions">
            <button className="nsm-btn" onClick={() => query()} disabled={busy !== ""}>
              {busy === "query" ? "查询中…" : view ? "刷新判断" : "查询其他人的判断"}
            </button>
          </div>

          {view ? (
            <div className="arc-judgments">
              <div className="arc-row">
                <span>你信任的人</span>
                <Counts counts={view.trusted.counts} />
              </div>
              {view.trusted.items.map(renderItem)}
              {view.others.items.length > 0 ? (
                <details>
                  <summary className="arc-dim">
                    陌生人 {view.others.items.length} 条（密钥可随意生成，仅供参考）{" "}
                    <Counts counts={view.others.counts} />
                  </summary>
                  {view.others.items.map(renderItem)}
                </details>
              ) : null}
              {view.trusted.items.length === 0 && view.others.items.length === 0 ? (
                <div className="arc-dim">在 {view.relays} 个中继上还没有人判断过这一版正文。</div>
              ) : null}
            </div>
          ) : null}

          <div className="arc-section-title" style={{ marginTop: 6 }}>
            我的判断{view?.mine ? "（已发布过，再次发布会覆盖）" : ""}
          </div>
          <div className="arc-verdict-pick">
            {VERDICTS.map((v) => (
              <button
                key={v}
                className={`nsm-btn arc-pick ${verdict === v ? `arc-pick-on ${VERDICT_CLASS[v]}` : ""}`}
                onClick={() => setVerdict(v)}
              >
                {VERDICT_LABEL[v]}
              </button>
            ))}
          </div>
          <textarea
            className="arc-textarea"
            rows={3}
            value={reason}
            placeholder={`理由（至少 ${REASON_MIN} 个字）：依据什么判断？哪些说法得到了证实或被反驳？`}
            onChange={(e) => setReason(e.target.value)}
          />

          <div className="arc-section-title">
            证据{evidence ? `（${evidence.items.length} 份，独立来源 ${evidence.independent_sources} 个）` : ""}
          </div>
          {evidence?.items.length ? null : (
            <div className="arc-dim">
              证据必须是已存档的网页：在下方「查找其他报道」的结果里点「存为证据」，或从我的存档里选。
            </div>
          )}
          {evidence?.items.map((e) => (
            <div key={e.capture_id} className="arc-evidence">
              <div className="arc-row">
                <span className="arc-ev-title">{e.title || e.url}</span>
                <button className="nsm-link" onClick={() => setRelation(e.capture_id, null)}>
                  移除
                </button>
              </div>
              <div className="arc-dim arc-row">
                <span>
                  {e.domain}
                  {e.same_as_target ? <span className="arc-tag">与原文同源（转载），不算独立</span> : null}
                  {!e.same_as_target && e.group_size > 1 ? (
                    <span className="arc-tag">同一篇通稿 ×{e.group_size}</span>
                  ) : null}
                </span>
                <select
                  className="arc-select"
                  value={e.relation}
                  onChange={(ev) => setRelation(e.capture_id, ev.target.value as Relation)}
                >
                  {RELATIONS.map((r) => (
                    <option key={r} value={r}>
                      {RELATION_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {candidates.filter((c) => !evIds.has(c.id)).length > 0 ? (
            <select className="arc-select" value="" onChange={(e) => void addLocal(e.target.value)}>
              <option value="">从我的存档添加证据…</option>
              {candidates
                .filter((c) => !evIds.has(c.id))
                .slice(0, 50)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title.slice(0, 40) || c.url}
                  </option>
                ))}
            </select>
          ) : null}

          <div className="nsm-actions">
            <button
              className="nsm-btn nsm-btn-primary"
              disabled={busy !== "" || !verdict || reasonLen < REASON_MIN}
              onClick={publish}
            >
              {busy === "publish" ? "发布中…" : "发布我的判断"}
            </button>
            <button className="nsm-btn" disabled={busy !== ""} onClick={checklistNow} title="用你自己的 LLM 列出值得核实的具体说法；只作参考，不算一票">
              {busy === "checklist" ? "分析中…" : "列出待核实要点"}
            </button>
          </div>
          {checklist ? (
            <ol className="arc-checklist">
              {checklist.map((c, i) => (
                <li key={i}>
                  {c.claim}
                  <div className="arc-dim">核实途径：{c.how_to_verify}</div>
                </li>
              ))}
              <div className="arc-dim">以上由你配置的 LLM 生成，只是帮你理清要核实什么，不是结论。</div>
            </ol>
          ) : null}
        </>
      )}
      {msg ? <div className="arc-dim">{msg}</div> : null}
    </div>
  );
}
