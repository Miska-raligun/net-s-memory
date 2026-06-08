// Self-contained OpenTimestamps `.ots` reader/writer.
//
// We implement just the binary format (https://github.com/opentimestamps/
// python-opentimestamps) instead of pulling the `opentimestamps` npm package,
// which needs node's `crypto`/`fs` and `bitcore-lib` and won't run in a
// service worker. Serialization is purely structural — we shuttle the
// operation tree + attestations through without executing any hash ops — so
// no hashing is needed here. The one hash we do need (deriving the calendar
// "tip") is done with Web Crypto in ots.ts.
//
// Cross-validated byte-for-byte against the real library in serialize.test.ts.

export const HEADER_MAGIC = [
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
];

export const OP_SHA256 = 0x08;
const OP_APPEND = 0xf0;
const OP_PREPEND = 0xf1;
const ARG_OPS = new Set([OP_APPEND, OP_PREPEND]);

const TAG_PENDING = [0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e];
const TAG_BITCOIN = [0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01];

export type Attestation =
  | { kind: "pending"; uri: string }
  | { kind: "bitcoin"; height: number }
  | { kind: "unknown"; tag: number[]; payload: number[] };

export interface Op {
  tag: number;
  arg?: number[];
}

export interface TsNode {
  attestations: Attestation[];
  ops: { op: Op; child: TsNode }[];
}

export interface Proof {
  fileOpTag: number;
  fileDigest: number[];
  timestamp: TsNode;
}

// --- varint / varbytes --------------------------------------------------
function writeVaruint(out: number[], n: number): void {
  for (;;) {
    if (n < 0x80) {
      out.push(n);
      return;
    }
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
}

function writeVarbytes(out: number[], bytes: number[]): void {
  writeVaruint(out, bytes.length);
  for (const b of bytes) out.push(b);
}

class Reader {
  pos = 0;
  constructor(private buf: number[]) {}
  u8(): number {
    if (this.pos >= this.buf.length) throw new Error("ots: unexpected end of stream");
    return this.buf[this.pos++];
  }
  take(n: number): number[] {
    const out = this.buf.slice(this.pos, this.pos + n);
    if (out.length !== n) throw new Error("ots: unexpected end of stream");
    this.pos += n;
    return out;
  }
  varuint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.u8();
      result += (b & 0x7f) * Math.pow(2, shift);
      if ((b & 0x80) === 0) return result;
      shift += 7;
    }
  }
  varbytes(): number[] {
    return this.take(this.varuint());
  }
  done(): boolean {
    return this.pos >= this.buf.length;
  }
}

// --- attestations -------------------------------------------------------
function serializeAttestation(att: Attestation, out: number[]): void {
  if (att.kind === "pending") {
    for (const b of TAG_PENDING) out.push(b);
    const uriBytes = Array.from(new TextEncoder().encode(att.uri));
    const payload: number[] = [];
    writeVarbytes(payload, uriBytes);
    writeVarbytes(out, payload);
  } else if (att.kind === "bitcoin") {
    for (const b of TAG_BITCOIN) out.push(b);
    const payload: number[] = [];
    writeVaruint(payload, att.height);
    writeVarbytes(out, payload);
  } else {
    for (const b of att.tag) out.push(b);
    writeVarbytes(out, att.payload);
  }
}

function eq(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function readAttestation(r: Reader): Attestation {
  const tag = r.take(8);
  const payload = r.varbytes();
  const pr = new Reader(payload);
  if (eq(tag, TAG_PENDING)) {
    return { kind: "pending", uri: new TextDecoder().decode(Uint8Array.from(pr.varbytes())) };
  }
  if (eq(tag, TAG_BITCOIN)) {
    return { kind: "bitcoin", height: pr.varuint() };
  }
  return { kind: "unknown", tag, payload };
}

// --- ops ----------------------------------------------------------------
function serializeOp(op: Op, out: number[]): void {
  out.push(op.tag);
  if (ARG_OPS.has(op.tag)) writeVarbytes(out, op.arg ?? []);
}

function opSortKey(op: Op): number[] {
  const out: number[] = [];
  serializeOp(op, out);
  return out;
}

function attSortKey(att: Attestation): number[] {
  const out: number[] = [];
  serializeAttestation(att, out);
  return out;
}

function compareBytes(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// --- timestamp tree -----------------------------------------------------
export function serializeTimestamp(node: TsNode, out: number[]): void {
  const atts = [...node.attestations].sort((a, b) => compareBytes(attSortKey(a), attSortKey(b)));
  const ops = [...node.ops].sort((a, b) => compareBytes(opSortKey(a.op), opSortKey(b.op)));
  const total = atts.length + ops.length;
  let i = 0;
  for (const att of atts) {
    if (i < total - 1) out.push(0xff);
    out.push(0x00);
    serializeAttestation(att, out);
    i++;
  }
  for (const { op, child } of ops) {
    if (i < total - 1) out.push(0xff);
    serializeOp(op, out);
    serializeTimestamp(child, out);
    i++;
  }
}

function readOp(r: Reader, tag: number): Op {
  if (ARG_OPS.has(tag)) return { tag, arg: r.varbytes() };
  return { tag };
}

export function readTimestamp(r: Reader): TsNode {
  const node: TsNode = { attestations: [], ops: [] };
  const readEdge = (tag: number) => {
    if (tag === 0x00) {
      node.attestations.push(readAttestation(r));
    } else {
      const op = readOp(r, tag);
      node.ops.push({ op, child: readTimestamp(r) });
    }
  };
  let tag = r.u8();
  while (tag === 0xff) {
    readEdge(r.u8());
    tag = r.u8();
  }
  readEdge(tag);
  return node;
}

// --- detached file ------------------------------------------------------
export function serializeProof(proof: Proof): Uint8Array {
  const out: number[] = [...HEADER_MAGIC];
  writeVaruint(out, 1); // major version
  out.push(proof.fileOpTag);
  for (const b of proof.fileDigest) out.push(b);
  serializeTimestamp(proof.timestamp, out);
  return Uint8Array.from(out);
}

export function deserializeProof(bytes: Uint8Array): Proof {
  const r = new Reader(Array.from(bytes));
  const magic = r.take(HEADER_MAGIC.length);
  if (!eq(magic, HEADER_MAGIC)) throw new Error("ots: bad magic header");
  r.varuint(); // version
  const fileOpTag = r.u8();
  // File hash op is a crypto op; digest length depends on the algorithm.
  const len = fileOpTag === OP_SHA256 ? 32 : fileOpTag === 0x03 ? 20 : 32;
  const fileDigest = r.take(len);
  const timestamp = readTimestamp(r);
  return { fileOpTag, fileDigest, timestamp };
}

/** Walk all attestations in the tree. */
export function allAttestations(node: TsNode): Attestation[] {
  const out: Attestation[] = [...node.attestations];
  for (const { child } of node.ops) out.push(...allAttestations(child));
  return out;
}

/** Reader factory for parsing a calendar's serialized sub-timestamp. */
export function timestampFromBytes(bytes: Uint8Array): TsNode {
  return readTimestamp(new Reader(Array.from(bytes)));
}
