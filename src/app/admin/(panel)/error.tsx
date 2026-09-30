'use client';
// Lỗi khi render trang admin: nói gì đã hỏng, cho thử lại tại chỗ (Next 16: prop `retry`).
import Link from 'next/link';
import { useEffect } from 'react';
import { Icon } from '../_components/icons';
import { btn } from '../_components/ui';

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="rounded-[var(--radius)] border border-border bg-card px-6 py-12 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-destructive"><Icon name="alert" size={22} /></span>
      <h1 className="mt-3 text-xl font-semibold">This page could not load</h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Something went wrong while reading the data. Nothing was changed. Try again, and if it keeps happening check the server log{error.digest ? <> for reference <code className="font-mono text-foreground">{error.digest}</code></> : null}.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => retry()} className={`${btn.base} ${btn.primary}`}><Icon name="refresh" /> Try again</button>
        <Link href="/admin" className={`${btn.base} ${btn.outline}`}>Go to Home</Link>
      </div>
    </div>
  );
}
