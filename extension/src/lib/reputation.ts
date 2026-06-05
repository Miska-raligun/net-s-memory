// Seed source-reputation lookup, mirroring the Python `lookup()` in
// backend/app/analyze/source_reputation.py but keyed by domain.

import seed from "./seed-reputation.json";
import { domainCandidates } from "./url";
import type { ReputationLabel, ReputationSignal } from "./types";

const DEFAULT_WEIGHT: number = seed.default_weight;
const TABLE: Record<string, number> = seed.domains;

function labelFor(weight: number): ReputationLabel {
  if (weight >= 0.8) return "high";
  if (weight >= 0.5) return "medium";
  return "low";
}

/**
 * Look up reputation for a domain. Tries the exact host then progressively
 * shorter registrable-domain suffixes. Unknown domains fall back to a
 * neutral weight + "unknown" label so they neither boost nor punish.
 */
export function lookupReputation(domain: string | null): ReputationSignal {
  if (!domain) {
    return { label: "unknown", weight: DEFAULT_WEIGHT, matched_domain: null };
  }
  for (const candidate of domainCandidates(domain)) {
    const weight = TABLE[candidate];
    if (weight !== undefined) {
      return { label: labelFor(weight), weight, matched_domain: candidate };
    }
  }
  return { label: "unknown", weight: DEFAULT_WEIGHT, matched_domain: null };
}
