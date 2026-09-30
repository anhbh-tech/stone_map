'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UiIcon } from '@/components/nav/icons';
import { postJson } from './fields';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy}
      onClick={async () => { setBusy(true); await postJson('/api/account/logout', {}); router.push('/'); router.refresh(); }}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-60">
      <UiIcon name="logOut" size={18} />Sign out
    </button>
  );
}
