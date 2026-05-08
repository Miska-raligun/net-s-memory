// Browser-side verifier for inclusion proofs from /api/news/{id}/proof.
// Mirrors the Python crypto.merkle and crypto.log implementations exactly:
//   leaf_hash  = SHA-256(0x00 || domain_tag || canonical || signature)
//   node_hash  = SHA-256(0x01 || left || right)
// A successful verify means the news item is provably in the log under
// the returned root hash.

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

const DOMAIN_TAGS: Record<string, Uint8Array> = {
  news: new TextEncoder().encode("net-s-memory:news:v1\n"),
  analysis: new TextEncoder().encode("net-s-memory:analysis:v1\n"),
  vote: new TextEncoder().encode("net-s-memory:vote:v1\n"),
  merge_proposal: new TextEncoder().encode("net-s-memory:merge_proposal:v1\n"),
  rotate: new TextEncoder().encode("net-s-memory:rotate:v1\n"),
};

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const out = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(out);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function hashLeaf(data: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(LEAF_PREFIX, data));
}

async function hashNode(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(NODE_PREFIX, left, right));
}

async function leafHashFromCanonical(
  leafType: string,
  canonical: Uint8Array,
  signature: Uint8Array,
): Promise<Uint8Array> {
  const tag = DOMAIN_TAGS[leafType];
  if (!tag) throw new Error(`unknown leaf type ${leafType}`);
  return hashLeaf(concat(tag, canonical, signature));
}

async function verifyInclusion(
  leaf: Uint8Array,
  index: number,
  treeSize: number,
  proof: Uint8Array[],
  root: Uint8Array,
): Promise<boolean> {
  if (treeSize <= 0 || index < 0 || index >= treeSize) return false;
  let fn = index;
  let sn = treeSize - 1;
  let r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if ((fn & 1) || fn === sn) {
      r = await hashNode(p, r);
      if (!(fn & 1)) {
        while (!(fn & 1) && fn !== 0) {
          fn = fn >>> 1;
          sn = sn >>> 1;
        }
      }
    } else {
      r = await hashNode(r, p);
    }
    fn = fn >>> 1;
    sn = sn >>> 1;
  }
  return sn === 0 && bytesEqual(r, root);
}

export interface ProofResponse {
  news_id: string;
  leaf_type: string;
  leaf_hash: string;
  leaf_index: number;
  tree_size: number;
  root_hash: string;
  canonical: string;
  signature: string;
  pubkey: string;
  signer: string;
  alg: string;
  audit_path: string[];
}

export type VerificationStatus =
  | { ok: true; recomputedLeafHash: string; root: string; treeSize: number }
  | { ok: false; reason: string };

export async function verifyProof(p: ProofResponse): Promise<VerificationStatus> {
  let leafHash: Uint8Array;
  try {
    const canonical = new TextEncoder().encode(p.canonical);
    const sig = hexToBytes(p.signature);
    leafHash = await leafHashFromCanonical(p.leaf_type, canonical, sig);
  } catch (e) {
    return { ok: false, reason: `leaf hash computation failed: ${(e as Error).message}` };
  }
  const claimedLeafHashHex = bytesToHex(leafHash);
  if (claimedLeafHashHex !== p.leaf_hash) {
    return {
      ok: false,
      reason: "leaf hash recomputed from canonical+signature does not match server",
    };
  }
  const root = hexToBytes(p.root_hash);
  const proofBytes = p.audit_path.map(hexToBytes);
  const ok = await verifyInclusion(leafHash, p.leaf_index, p.tree_size, proofBytes, root);
  if (!ok) return { ok: false, reason: "inclusion proof did not reproduce the root hash" };
  return {
    ok: true,
    recomputedLeafHash: claimedLeafHashHex,
    root: p.root_hash,
    treeSize: p.tree_size,
  };
}
