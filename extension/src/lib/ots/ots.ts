// OpenTimestamps anchoring — fully self-contained (no library at runtime).
// Builds/parses `.ots` proofs via ./serialize, hashes with Web Crypto, and
// talks to calendar servers with fetch. Runs in the background worker.
//
// Trustless Bitcoin-header verification (matching the merkle path to a real
// block header) is out of scope; `inspect` reports the height the proof
// claims, and the UI links to the official verifier for a full check.

import {
  allAttestations,
  deserializeProof,
  serializeProof,
  timestampFromBytes,
  OP_SHA256,
  type Attestation,
  type Op,
  type Proof,
  type TsNode,
} from "./serialize";

const OP_APPEND = 0xf0;

export const DEFAULT_CALENDARS = [
  "https://alice.btc.calendar.opentimestamps.org",
  "https://bob.btc.calendar.opentimestamps.org",
  "https://finney.calendar.eternitywall.com",
];

export interface OtsStatus {
  pending: string[];
  bitcoinHeight: number | null;
  complete: boolean;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(d);
}

function concat(a: number[], b: number[]): Uint8Array {
  return Uint8Array.from([...a, ...b]);
}

function serializedKey(thing: Attestation | Op): string {
  // cheap structural identity for dedup
  return JSON.stringify(thing);
}

function mergeNodes(into: TsNode, from: TsNode): void {
  const haveAtt = new Set(into.attestations.map(serializedKey));
  for (const att of from.attestations) {
    if (!haveAtt.has(serializedKey(att))) into.attestations.push(att);
  }
  const haveOp = new Set(into.ops.map((o) => serializedKey(o.op)));
  for (const o of from.ops) {
    if (!haveOp.has(serializedKey(o.op))) into.ops.push(o);
  }
}

async function postDigest(calendar: string, tip: Uint8Array): Promise<TsNode | null> {
  try {
    const res = await fetch(calendar + "/digest", {
      method: "POST",
      headers: {
        Accept: "application/vnd.opentimestamps.v1",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tip as BodyInit,
    });
    if (!res.ok) return null;
    return timestampFromBytes(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Submit a 32-byte digest to the calendars and return a serialized `.ots`
 * proof (pending), or null if no calendar accepted it.
 */
export async function stamp(
  digest: Uint8Array,
  calendars: string[] = DEFAULT_CALENDARS,
): Promise<Uint8Array | null> {
  const fileDigest = Array.from(digest);
  // Per-stamp nonce so the calendar never sees the original digest.
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)));
  const tip = await sha256(concat(fileDigest, nonce));

  const tipNode: TsNode = { attestations: [], ops: [] };
  let merged = 0;
  for (const cal of calendars) {
    const node = await postDigest(cal, tip);
    if (node) {
      mergeNodes(tipNode, node);
      merged++;
    }
  }
  if (merged === 0) return null;

  // fileDigest --append(nonce)--> --sha256--> tip --[calendar edges]
  const proof: Proof = {
    fileOpTag: OP_SHA256,
    fileDigest,
    timestamp: {
      attestations: [],
      ops: [
        {
          op: { tag: OP_APPEND, arg: nonce },
          child: { attestations: [], ops: [{ op: { tag: OP_SHA256 }, child: tipNode }] },
        },
      ],
    },
  };
  return serializeProof(proof);
}

function statusOf(proof: Proof): OtsStatus {
  const pending: string[] = [];
  let bitcoinHeight: number | null = null;
  for (const att of allAttestations(proof.timestamp)) {
    if (att.kind === "pending") pending.push(att.uri);
    else if (att.kind === "bitcoin") bitcoinHeight = att.height;
  }
  return { pending, bitcoinHeight, complete: bitcoinHeight !== null };
}

export function inspect(proofBytes: Uint8Array): OtsStatus {
  return statusOf(deserializeProof(proofBytes));
}

/** The node carrying the pending attestation, plus its append-nonce. */
function findTipNode(proof: Proof): { node: TsNode; nonce: number[] } | null {
  const appendOp = proof.timestamp.ops.find((o) => o.op.tag === OP_APPEND);
  if (!appendOp?.op.arg) return null;
  // our structure: append → sha256 → tipNode
  const shaOp = appendOp.child.ops.find((o) => o.op.tag === OP_SHA256);
  if (!shaOp) return null;
  return { node: shaOp.child, nonce: appendOp.op.arg };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Best-effort upgrade: ask each pending calendar whether the commitment has
 * been anchored in Bitcoin yet, and splice the result in. Returns new proof
 * bytes if anything changed, else null.
 */
export async function upgrade(proofBytes: Uint8Array): Promise<Uint8Array | null> {
  const proof = deserializeProof(proofBytes);
  if (statusOf(proof).complete) return null;
  const tip = findTipNode(proof);
  if (!tip) return null;

  const commitment = await sha256(concat(proof.fileDigest, tip.nonce));
  const pendingUris = tip.node.attestations
    .filter((a): a is { kind: "pending"; uri: string } => a.kind === "pending")
    .map((a) => a.uri);

  let changed = false;
  for (const uri of pendingUris) {
    try {
      const res = await fetch(uri + "/timestamp/" + toHex(commitment), {
        headers: { Accept: "application/vnd.opentimestamps.v1" },
      });
      if (!res.ok) continue;
      const upgraded = timestampFromBytes(new Uint8Array(await res.arrayBuffer()));
      mergeNodes(tip.node, upgraded);
      changed = true;
    } catch {
      /* try next */
    }
  }
  return changed ? serializeProof(proof) : null;
}
