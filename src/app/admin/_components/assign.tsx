'use client';
// Giao design cho một designer: đổi select là lưu ngay (PATCH assignee_id), báo kết quả qua role=status.
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { callApi } from './form';
import { Icon } from './icons';

export function AssignSelect({ designId, value, staff }: { designId: string; value: number | null; staff: { id: number; name: string; role: string }[] }) {
  const router = useRouter();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function change(v: string) {
    setPending(true); setMsg(null);
    const r = await callApi(`/api/admin/designs/${designId}`, 'PATCH', { assignee_id: v ? Number(v) : null });
    setPending(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error.message }); return; }
    setMsg({ ok: true, text: v ? 'Assigned' : 'Unassigned' });
    router.refresh();
  }
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">Designer</label>
      <div className="flex items-center gap-2">
        <select id={id} defaultValue={value ?? ''} disabled={pending} aria-busy={pending} onChange={(e) => change(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-[var(--radius)] border border-input bg-background px-3 text-sm text-foreground focus-visible:border-foreground disabled:opacity-60">
          <option value="">Unassigned</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.role === 'owner' ? ' (owner)' : ''}</option>)}
        </select>
        {pending && <Icon name="loader" className="animate-spin text-muted-foreground" />}
      </div>
      <span role={msg && !msg.ok ? 'alert' : 'status'} className={`text-xs ${msg?.ok ? 'text-success' : 'text-destructive'}`}>{msg?.text}</span>
    </div>
  );
}
