import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/auth';
import { currentAdmin } from '../_lib/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentAdmin()) redirect(next);
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-[var(--radius)] border border-border bg-card p-6 text-card-foreground sm:p-8">
        <p className="font-serif text-lg font-semibold text-muted-foreground">Pearl Atelier</p>
        <h1 className="mt-1 text-3xl font-semibold">Admin sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">Staff only. Orders, designs and store settings.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
