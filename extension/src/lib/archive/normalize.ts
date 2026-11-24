// Text normalization for archive hashing.
//
// Two people opening the same article never get byte-identical HTML (ads,
// login state, inline timestamps, A/B scripts). What *is* comparable is the
// article text once whitespace and invisible characters are made canonical.
// The archive's content hash — the thing witnesses agree on and that gets
// anchored to Bitcoin — is sha256(normalizeText(extractedText)).
//
// Rules (deterministic, and deliberately conservative so they never change
// meaning):
//   1. Unicode NFC.
//   2. Remove zero-width / BOM / soft-hyphen characters.
//   3. Map every Unicode space separator (NBSP, ideographic space, …) and tab
//      to a plain space; map CR / CRLF / U+2028 / U+2029 to "\n".
//   4. Collapse runs of spaces inside a line, trim each line.
//   5. Drop empty lines; join with a single "\n".

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const SPACES = /[\t\v\f \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g;
const NEWLINES = /\r\n?|[\u2028\u2029\u0085]/g;

export const NORMALIZATION_ID = "nsm-text-norm.v1";

export function normalizeText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(NEWLINES, "\n")
    .split("\n")
    .map((line) => line.replace(SPACES, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** UTF-8 byte length, used to decide whether text fits inline in an event. */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}
