export function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  if (diff < 0) return "刚刚";

  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;

  return new Date(iso).toLocaleDateString("zh-CN");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN");
}
