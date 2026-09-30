'use client';
// Chọn sản phẩm cho collection: tick/bỏ tick rồi Save (PUT thay toàn bộ, thứ tự = thứ tự trong danh sách).
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './form';
import { Icon } from './icons';
import { StatusBadge, btn } from './ui';

type Row = { id: number; title: string; handle: string; status: string; member: 0 | 1 };

export function MembershipForm({ collectionId, products }: { collectionId: number; products: Row[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState(() => new Set(products.filter((p) => p.member).map((p) => p.id)));
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function save() {
    setPending(true); setMsg(null);
    const r = await callApi(`/api/admin/collections/${collectionId}/products`, 'PUT', { product_ids: products.filter((p) => picked.has(p.id)).map((p) => p.id) });
    setPending(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error.message }); return; }
    setMsg({ ok: true, text: 'Products saved' });
    router.refresh();
  }
  if (products.length === 0) return <p className="text-sm text-muted-foreground">No products exist yet.</p>;
  return (
    <fieldset>
      <legend className="sr-only">Products in this collection</legend>
      <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
        {products.map((p) => (
          <li key={p.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} className="size-5 shrink-0" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.title}</span><span className="block truncate text-xs text-muted-foreground">/{p.handle}</span></span>
              <StatusBadge status={p.status} />
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={pending} aria-busy={pending} className={`${btn.base} ${btn.primary}`}>
          {pending && <Icon name="loader" className="animate-spin" />}{pending ? 'Saving…' : `Save ${picked.size} product${picked.size === 1 ? '' : 's'}`}
        </button>
        <span role={msg && !msg.ok ? 'alert' : 'status'} className={`text-sm ${msg?.ok ? 'text-success' : 'text-destructive'}`}>{msg?.text}</span>
      </div>
    </fieldset>
  );
}
