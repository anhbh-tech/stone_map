// Skeleton chung cho mọi trang admin trong lúc server render (giữ khung để không nhảy layout).
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="mb-5 grid gap-2" aria-hidden="true">
        <div className="admin-skeleton h-8 w-48" />
        <div className="admin-skeleton h-4 w-80 max-w-full" />
      </div>
      <div className="rounded-[var(--radius)] border border-border bg-card" aria-hidden="true">
        <div className="flex gap-4 border-b border-border px-5 py-3">{[0, 1, 2, 3].map((i) => <div key={i} className="admin-skeleton h-5 w-20" />)}</div>
        <div className="px-5 py-3"><div className="admin-skeleton h-11 w-full" /></div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 border-t border-border px-5 py-3">
            <div className="admin-skeleton h-4 w-16" /><div className="admin-skeleton h-4 flex-1" /><div className="admin-skeleton h-4 w-20" /><div className="admin-skeleton h-5 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
