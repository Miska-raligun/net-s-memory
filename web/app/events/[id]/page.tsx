import { redirect } from "next/navigation";

import { API_BASE, type EventDetail } from "@/lib/api";

// The dedicated event page is gone: news detail is now the unified
// timeline view (news content + event timeline + 追踪后续 + 合入提案).
// Anything that still links to /events/[id] is forwarded to the origin
// news so old URLs / bookmarks keep working.
export default async function EventRedirect({
  params,
}: {
  params: { id: string };
}) {
  const r = await fetch(`${API_BASE}/api/events/${params.id}`, {
    cache: "no-store",
  });
  if (!r.ok) {
    return (
      <main>
        <div className="fail">事件不存在</div>
      </main>
    );
  }
  const detail = (await r.json()) as EventDetail;
  const originId = detail.timeline?.[0]?.news?.id;
  if (originId) {
    redirect(`/news/${originId}`);
  }
  return (
    <main>
      <p>该事件暂无可跳转的源新闻。</p>
    </main>
  );
}
