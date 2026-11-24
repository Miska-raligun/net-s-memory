import { describe, expect, it } from "vitest";
import { combineSignals, NEUTRAL_COMMUNITY } from "./scoring";
import type { SignalSet } from "./types";

function signals(over: Partial<SignalSet> = {}): SignalSet {
  return {
    reputation: { label: "high", weight: 0.9, matched_domain: "people.com.cn" },
    llm: { score: 80, consistency: "high", summary: "", model: "m" },
    corroboration: { count: 0, sources: [] },
    community: { count: 0, weighted_score: null },
    ...over,
  };
}

describe("combineSignals", () => {
  it("matches the server's bucket maxima", () => {
    const b = combineSignals(
      signals({
        reputation: { label: "high", weight: 1, matched_domain: "x" },
        llm: { score: 100, consistency: "high", summary: "", model: "m" },
        corroboration: { count: 10, sources: [] },
        community: { count: 3, weighted_score: 100 },
      }),
    );
    expect(b.reputation_score).toBe(30);
    expect(b.llm_score).toBe(30);
    expect(b.corroboration_score).toBe(30);
    expect(b.community_score).toBe(10);
    expect(b.total).toBe(100);
  });

  it("uses neutral LLM (50) when score is null", () => {
    const b = combineSignals(
      signals({ llm: { score: null, consistency: "unknown", summary: "", model: null } }),
    );
    expect(b.llm_score).toBe(15); // round(50/100 * 30)
  });

  it("uses neutral community placeholder when none present", () => {
    const b = combineSignals(signals());
    expect(b.community_score).toBe(NEUTRAL_COMMUNITY);
  });

  it("caps corroboration at 30 (count*8)", () => {
    expect(combineSignals(signals({ corroboration: { count: 2, sources: [] } })).corroboration_score).toBe(16);
    expect(combineSignals(signals({ corroboration: { count: 5, sources: [] } })).corroboration_score).toBe(30);
  });

  it("clamps out-of-range inputs", () => {
    const b = combineSignals(
      signals({
        reputation: { label: "high", weight: 5, matched_domain: "x" },
        llm: { score: 999, consistency: "high", summary: "", model: "m" },
      }),
    );
    expect(b.reputation_score).toBe(30);
    expect(b.llm_score).toBe(30);
  });
});
