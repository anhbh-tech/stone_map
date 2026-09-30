'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { UiIcon } from '@/components/nav/icons';
import { Field, FormAlert, postJson, type FieldErrors } from './fields';

/** Đăng nhập / đăng ký. Cho dán + trình quản lý mật khẩu (autocomplete đúng loại), nút hiện mật khẩu thay ô "nhập lại". */
export function AuthForm({ mode, next }: { mode: 'login' | 'register'; next: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const reg = mode === 'register';

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '');
    const errs: FieldErrors = {};
    if (reg && !v('name').trim()) errs.name = 'Enter your name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email').trim())) errs.email = 'Enter a valid email address';
    if (!v('password')) errs.password = 'Enter your password';
    else if (reg && v('password').length < 8) errs.password = 'Use at least 8 characters';
    setErrors(errs);
    setAlert(null);
    if (Object.keys(errs).length) { document.getElementById(Object.keys(errs)[0])?.focus(); return; }
    setBusy(true);
    const r = await postJson(`/api/account/${mode}`, reg ? { name: v('name').trim(), email: v('email').trim(), password: v('password') } : { email: v('email').trim(), password: v('password') });
    if (r.ok) {
      router.push(next);
      router.refresh(); // header (AccountLink) là server component: render lại để hiện trạng thái đăng nhập
      return;
    }
    setBusy(false);
    setErrors(r.fields);
    setAlert(r.message);
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <FormAlert message={alert} ref={alertRef} />
      {reg && (
        <Field id="name" label="Name" error={errors.name}>
          {(a) => <input {...a} name="name" autoComplete="name" maxLength={120} />}
        </Field>
      )}
      <Field id="email" label="Email" error={errors.email}>
        {(a) => <input {...a} name="email" type="email" autoComplete={reg ? 'email' : 'username'} inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={200} />}
      </Field>
      <Field id="password" label="Password" error={errors.password} hint={reg ? 'At least 8 characters.' : undefined}>
        {(a) => (
          <div className="relative">
            <input {...a} name="password" type={show ? 'text' : 'password'} autoComplete={reg ? 'new-password' : 'current-password'} maxLength={200} className={`${a.className} pr-12`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
              <UiIcon name={show ? 'eyeOff' : 'eye'} size={20} />
            </button>
          </div>
        )}
      </Field>
      <button type="submit" disabled={busy} aria-busy={busy}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 font-semibold text-on-primary transition-colors hover:bg-secondary disabled:opacity-60">
        {busy && <UiIcon name="loader" size={18} className="animate-spin motion-reduce:animate-none" />}
        {reg ? 'Create account' : 'Sign in'}
      </button>
      <p className="text-center text-sm text-muted-foreground">
        {reg ? 'Already have an account? ' : 'New here? '}
        <Link href={`/account/${reg ? 'login' : 'register'}${next !== '/account' ? `?next=${encodeURIComponent(next)}` : ''}`}
          className="font-medium text-foreground underline underline-offset-4 hover:decoration-2">
          {reg ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  );
}
