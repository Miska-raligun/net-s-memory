// RFC 8785-style canonical JSON, ASCII-escaped.
//
// Ported verbatim from net-s-memory's web/lib/canonical.ts, which itself
// mirrors the Python encoder in backend/app/crypto/canonical.py byte-for-byte:
//   - object keys sorted lexicographically by code point
//   - strings JSON-escaped, all non-ASCII as \uXXXX (lowercase hex)
//   - separators ":" and ",", no whitespace
//   - integers only; floats and NaN/Infinity are rejected
//
// We keep it identical so that, should the extension ever bridge an
// attestation into the existing Merkle log, the bytes (and signatures)
// remain interoperable.

export type Canonical =
  | string
  | number
  | boolean
  | null
  | Canonical[]
  | { [key: string]: Canonical };

export function canonicalEncode(value: Canonical): Uint8Array {
  return new TextEncoder().encode(stringify(value));
}

function stringify(value: Canonical): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error("canonical: only finite integers are allowed");
    }
    return value.toString();
  }
  if (typeof value === "string") return stringifyString(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as { [key: string]: Canonical };
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => stringifyString(k) + ":" + stringify(obj[k]));
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`canonical: unsupported type ${typeof value}`);
}

function stringifyString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20 || c > 0x7e) {
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else {
      out += s[i];
    }
  }
  return out + '"';
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex must have even length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** SHA-256 → hex, used to address attestations by normalized URL. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}
