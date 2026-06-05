// Shared score → color/label helpers.

export function scoreColor(score: number): string {
  if (score >= 70) return "var(--green)";
  if (score >= 40) return "var(--amber)";
  return "var(--red)";
}

export function consistencyLabel(c: string): string {
  switch (c) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    case "contradictory":
      return "自相矛盾";
    default:
      return "未评估";
  }
}

export function reputationLabel(label: string): string {
  switch (label) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return "未知";
  }
}
