// "Is this really an independent source?" — near-duplicate detection.
//
// Chinese outlets very often republish the same wire copy (通稿) verbatim or
// with light edits. Ten URLs carrying the same 通稿 are one source, not ten.
// We compare normalized texts with character 5-gram shingles (MinHash would
// be faster but our inputs are a handful of articles, so exact Jaccard on
// sampled shingles is fine and deterministic).

const N = 5;
const MAX_SHINGLES = 4000;

function strip(text: string): string {
  // Ignore whitespace and punctuation so layout and re-punctuation don't matter.
  return text.replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function shingles(text: string): Set<string> {
  const t = strip(text);
  const out = new Set<string>();
  if (t.length === 0) return out;
  if (t.length <= N) {
    out.add(t);
    return out;
  }
  // Evenly sample long texts to bound the cost.
  const total = t.length - N + 1;
  const step = Math.max(1, Math.floor(total / MAX_SHINGLES));
  for (let i = 0; i < total; i += step) out.add(t.slice(i, i + N));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (big.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Share of the smaller text contained in the larger (catches excerpts of a 通稿). */
export function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const s of small) if (big.has(s)) inter++;
  return inter / small.size;
}

export const SAME_SOURCE_THRESHOLD = 0.6;

export function sameSource(a: string, b: string): boolean {
  return containment(shingles(a), shingles(b)) >= SAME_SOURCE_THRESHOLD;
}

/**
 * Group items whose texts are near-duplicates (single-link). Returns groups
 * of item ids; singletons are independent sources.
 */
export function groupSameSource<T extends { id: string; text: string }>(items: T[]): string[][] {
  const sh = items.map((it) => shingles(it.text));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (containment(sh[i], sh[j]) >= SAME_SOURCE_THRESHOLD) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, string[]>();
  items.forEach((it, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), it.id]);
  });
  return [...groups.values()];
}
