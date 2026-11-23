// Blossom (BUD-01/02) blob upload: content-addressed file storage for the
// Nostr ecosystem. Anyone can run a server; blobs are addressed by sha256 so
// any server's copy can be checked against the hash in the witness event.
//
// Upload = PUT <server>/upload with an `Authorization: Nostr <base64 event>`
// header, where the event is kind 24242 with tags t=upload, x=<sha256> and an
// expiration. The server replies with a blob descriptor { url, sha256, size }.

import { finalizeEvent, type Event } from "nostr-tools";
import { hexToBytes, sha256Hex } from "../canonical";

export const BLOSSOM_AUTH_KIND = 24242;

export interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
}

export function buildUploadAuth(skHex: string, sha256: string, now: Date = new Date()): Event {
  const created = Math.floor(now.getTime() / 1000);
  return finalizeEvent(
    {
      kind: BLOSSOM_AUTH_KIND,
      created_at: created,
      tags: [
        ["t", "upload"],
        ["x", sha256],
        ["expiration", String(created + 300)],
      ],
      content: "互联网记忆存档上传",
    },
    hexToBytes(skHex),
  );
}

export function authHeader(ev: Event): string {
  const json = JSON.stringify(ev);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Nostr ${btoa(bin)}`;
}

export async function uploadBlob(
  server: string,
  bytes: Uint8Array,
  mime: string,
  skHex: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BlobDescriptor> {
  const sha256 = await sha256Hex(bytes);
  const auth = buildUploadAuth(skHex, sha256);
  const res = await fetchImpl(`${server.replace(/\/+$/, "")}/upload`, {
    method: "PUT",
    headers: { Authorization: authHeader(auth), "Content-Type": mime },
    body: bytes as BodyInit,
  });
  if (!res.ok) {
    const reason = res.headers.get("x-reason") ?? (await res.text()).slice(0, 160);
    throw new Error(`Blossom ${server} HTTP ${res.status}: ${reason}`);
  }
  const desc = (await res.json()) as Partial<BlobDescriptor>;
  if (desc.sha256 !== sha256 || typeof desc.url !== "string") {
    throw new Error(`Blossom ${server} 返回的哈希与上传内容不一致`);
  }
  return { url: desc.url, sha256, size: typeof desc.size === "number" ? desc.size : bytes.length };
}

/** Upload to every configured server; return the URLs that succeeded. */
export async function uploadToAll(
  servers: string[],
  bytes: Uint8Array,
  mime: string,
  skHex: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ urls: string[]; errors: string[] }> {
  const settled = await Promise.allSettled(
    servers.map((s) => uploadBlob(s, bytes, mime, skHex, fetchImpl)),
  );
  const urls: string[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") urls.push(r.value.url);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  return { urls, errors };
}
