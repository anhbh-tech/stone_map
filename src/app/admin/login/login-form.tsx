'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Icon } from '../_components/icons';
import { btn } from '../_components/ui';
import { callApi } from '../_components/form';

const input = 'min-h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-base text-foreground focus-visible:border-foreground aria-[invalid=true]:border-destructive';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true); setError(null);
    const r = await callApi('/api/admin/login', 'POST', { username: fd.get('username'), password: fd.get('password') });
    if (!r.ok) {
      setPending(false);
      setError(r.error.message);
      pwRef.current?.select();
      pwRef.current?.focus();
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4" aria-describedby={error ? 'login-error' : undefined}>
      <div className="grid gap-1.5">
        <label htmlFor="username" className="text-sm font-medium">Username</label>
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required
          aria-invalid={!!error} className={input} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <div className="relative">
          <input ref={pwRef} id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required
            aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} className={`${input} pr-12`} />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
            className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted-foreground hover:text-foreground">
            <Icon name={show ? 'eyeOff' : 'eye'} />
          </button>
        </div>
      </div>
      {error && (
        <p id="login-error" role="alert" className="flex items-start gap-2 rounded-[var(--radius)] border border-destructive px-3 py-2 text-sm text-destructive">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />{error}
        </p>
      )}
      <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.base} ${btn.primary} w-full`}>
        {pending && <Icon name="loader" className="animate-spin" />}{pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
