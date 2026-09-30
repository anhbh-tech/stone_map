import Image from 'next/image';
import { fmt } from '@/lib/money';
import { Icon } from '@/components/shell/Icon';

type Item = { key: string | number; title: string; size: string; qty: number; cents: number; thumbnail_url: string | null; properties: Record<string, string>; design_id?: string | null };

/** Danh sách dòng chỉ-đọc (checkout, trang cảm ơn): thumbnail + visibleProps(), không URL dạng chữ (#5). */
export function LineList({ items, showDesign }: { items: Item[]; showDesign?: boolean }) {
  return (
    <ul data-testid="line-list" className="mt-4 divide-y divide-border">
      {items.map((l) => {
        const pet = l.properties['Pet name'];
        return (
          <li key={l.key} className="flex gap-3 py-3">
            {l.thumbnail_url ? (
              <Image src={l.thumbnail_url} alt={pet ? `Preview of ${pet}'s portrait` : 'Preview of your portrait'} width={64} height={64} unoptimized
                className="size-16 shrink-0 rounded-md border border-border bg-muted object-cover" />
            ) : (
              <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon name="sparkles" size={18} /></span>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex justify-between gap-2 font-medium"><span>{l.title} · {l.size} in{l.qty > 1 && ` × ${l.qty}`}</span><span>{fmt(l.cents)}</span></p>
              <p className="text-muted-foreground">{Object.entries(l.properties).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
              {showDesign && l.design_id && <p className="text-xs text-muted-foreground">Design {l.design_id}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
