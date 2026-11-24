// Background handlers for the archive: local capture, OTS + Wayback extras,
// and explicit publication of a witness event (+ optional Blossom blobs).

import { buildCapture, hexDigestToBytes, isoSeconds, type BlobRef, type Capture, type CaptureInput } from "../lib/archive/capture";
import { buildCaptureEvent, canInlineText } from "../lib/archive/event";
import { uploadToAll } from "../lib/archive/blossom";
import { saveToWayback } from "../lib/archive/wayback";
import { isGone } from "../lib/archive/detect";
import { sha256Hex } from "../lib/canonical";
import { createIdentity, identityFromSk } from "../lib/nostr/keys";
import { publishEvent } from "../lib/nostr/relay";
import { inspect, stamp, upgrade } from "../lib/ots/ots";
import {
  getArchiveSettings,
  getCapture,
  getLocalBlob,
  getNostrSk,
  getRelays,
  putCapture,
  putLocalBlob,
  setNostrSk,
} from "../lib/storage";
import type { AnchorOutcome, PublishOutcome } from "../lib/messages";

export function b64encode(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function keepBlob(kind: BlobRef["kind"], bytes: Uint8Array, mime: string): Promise<BlobRef> {
  const sha256 = await sha256Hex(bytes);
  await putLocalBlob(sha256, mime, b64encode(bytes));
  return { kind, sha256, size: bytes.length, mime, urls: [] };
}

async function screenshot(windowId: number | undefined): Promise<Uint8Array | null> {
  if (windowId === undefined) return null;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 70 });
    return b64decode(dataUrl.slice(dataUrl.indexOf(",") + 1));
  } catch {
    return null; // e.g. the tab is not visible any more
  }
}

export async function captureLocal(
  input: CaptureInput,
  html: string | null,
  windowId: number | undefined,
): Promise<{ capture: Capture; warnings: string[] }> {
  const settings = await getArchiveSettings();
  const capture = await buildCapture(input);
  const warnings: string[] = [];

  if (settings.screenshot) {
    const shot = await screenshot(windowId);
    if (shot) capture.blobs.push(await keepBlob("screenshot", shot, "image/jpeg"));
    else warnings.push("截图失败（页面不在前台？），只保存了正文");
  }
  if (settings.html && html) {
    capture.blobs.push(await keepBlob("html", new TextEncoder().encode(html), "text/html; charset=utf-8"));
  }
  await putCapture(capture);
  return { capture, warnings };
}

function anchorOf(otsB64: string | undefined): AnchorOutcome {
  if (!otsB64) return { has_proof: false, pending: [], bitcoin_height: null, complete: false };
  const s = inspect(b64decode(otsB64));
  return { has_proof: true, pending: s.pending, bitcoin_height: s.bitcoinHeight, complete: s.complete };
}

/** OTS stamp of the text hash + Internet Archive snapshot, in parallel. */
export async function captureExtras(id: string): Promise<{ capture: Capture; anchor: AnchorOutcome; warnings: string[] }> {
  const capture = await getCapture(id);
  if (!capture) throw new Error("找不到这份存档");
  const settings = await getArchiveSettings();
  const warnings: string[] = [];

  const otsTask =
    settings.ots && !capture.ots_b64
      ? stamp(hexDigestToBytes(capture.text_sha256)).then((p) => {
          if (p) capture.ots_b64 = b64encode(p);
          else warnings.push("OpenTimestamps 日历服务器无响应，稍后可在存档页重试");
        })
      : Promise.resolve();

  const waybackTask =
    settings.wayback && capture.wayback_url === undefined && !isGone(capture.page_state)
      ? saveToWayback(capture.url).then((u) => {
          capture.wayback_url = u;
          if (!u) warnings.push("Internet Archive 暂未返回快照（可能限流）");
        })
      : Promise.resolve();

  await Promise.all([otsTask, waybackTask]);
  await putCapture(capture);
  return { capture, anchor: anchorOf(capture.ots_b64), warnings };
}

export async function refreshCaptureAnchor(id: string): Promise<{ capture: Capture; anchor: AnchorOutcome }> {
  const capture = await getCapture(id);
  if (!capture) throw new Error("找不到这份存档");
  if (!capture.ots_b64) {
    const p = await stamp(hexDigestToBytes(capture.text_sha256));
    if (!p) throw new Error("OpenTimestamps 日历服务器无响应");
    capture.ots_b64 = b64encode(p);
  } else {
    const upgraded = await upgrade(b64decode(capture.ots_b64));
    if (upgraded) capture.ots_b64 = b64encode(upgraded);
  }
  await putCapture(capture);
  return { capture, anchor: anchorOf(capture.ots_b64) };
}

async function ensureSk(): Promise<string> {
  let sk = await getNostrSk();
  if (!sk) {
    sk = createIdentity().skHex;
    await setNostrSk(sk);
  }
  return sk;
}

async function uploadLocalBlob(
  ref: BlobRef,
  servers: string[],
  sk: string,
  warnings: string[],
): Promise<void> {
  const stored = await getLocalBlob(ref.sha256);
  if (!stored) {
    warnings.push(`本地找不到 ${ref.kind} 文件，跳过上传`);
    return;
  }
  const { urls, errors } = await uploadToAll(servers, b64decode(stored.b64), stored.mime, sk);
  ref.urls = Array.from(new Set([...ref.urls, ...urls]));
  warnings.push(...errors);
}

export async function publishCapture(
  id: string,
): Promise<{ capture: Capture; published: PublishOutcome; warnings: string[] }> {
  const capture = await getCapture(id);
  if (!capture) throw new Error("找不到这份存档");
  if (capture.witness_of) {
    throw new Error("这是从别人的见证导入的副本，你没有亲眼见到原页面，不能以自己的名义再发布见证");
  }
  const settings = await getArchiveSettings();
  const sk = await ensureSk();
  const warnings: string[] = [];
  const servers = settings.blossom_servers;

  if (servers.length > 0) {
    if (!canInlineText(capture.text)) {
      let textRef = capture.blobs.find((b) => b.kind === "text");
      if (!textRef) {
        textRef = await keepBlob("text", new TextEncoder().encode(capture.text), "text/plain; charset=utf-8");
        capture.blobs.push(textRef);
      }
      await uploadLocalBlob(textRef, servers, sk, warnings);
    }
    for (const ref of capture.blobs) {
      if (ref.kind === "screenshot" && settings.publish_screenshot) await uploadLocalBlob(ref, servers, sk, warnings);
      if (ref.kind === "html" && settings.publish_html) await uploadLocalBlob(ref, servers, sk, warnings);
    }
  }

  const event = buildCaptureEvent(capture, sk); // throws if text can be neither inlined nor referenced
  const relays = await getRelays();
  const result = await publishEvent(relays, event);
  const id_ = identityFromSk(sk);
  if (result.ok === 0) {
    await putCapture(capture); // keep any blob URLs we did get
    throw new Error(`所有中继都发布失败（${result.failed} 个），请检查网络或中继设置`);
  }
  capture.published = [
    ...(capture.published ?? []),
    {
      event_id: event.id,
      npub: id_.npub,
      at: isoSeconds(new Date()),
      relays_ok: result.ok,
      relays_failed: result.failed,
    },
  ];
  await putCapture(capture);
  return {
    capture,
    published: { npub: id_.npub, relays_ok: result.ok, relays_failed: result.failed },
    warnings,
  };
}
