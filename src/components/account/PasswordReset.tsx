'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { UiIcon } from '@/components/nav/icons';
import { Field, FormAlert, postJson, type FieldErrors } from './fields';

const submitCls = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 font-semibold text-on-primary transition-colors hover:bg-secondary disabled:opacity-60';
const linkCls = 'font-medium text-foreground underline underline-offset-4 hover:decoration-2';

/** Bước 1: nhập email → luôn cùng một câu trả lời (không lộ email nào có tài khoản). */
export function ForgotForm() {
  const [error, setError] = useState<string | undefined>();
  const [alert, setAlert] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const email = String(new FormData(ev.currentTarget).get('email') ?? '').trim();
    setAlert(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address'); document.getElementById('email')?.focus(); return; }
    setError(undefined);
    setBusy(true);
    const r = await postJson('/api/account/forgot', { email });
    setBusy(false);
    if (r.ok) { setSentTo(email); requestAnimationFrame(() => doneRef.current?.focus()); return; }
    setError(r.fields.email);
    setAlert(r.message);
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  if (sentTo) {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className="rounded-[var(--radius)] border border-border bg-card p-5 outline-none" data-testid="forgot-sent">
        <p className="flex items-center gap-2 font-semibold"><UiIcon name="check" size={20} className="text-success" /> Check your inbox</p>
        <p className="mt-2 text-sm text-muted-foreground">
          If an account uses <strong className="font-medium text-foreground">{sentTo}</strong>, we’ve sent it a link to choose a new password. The link works once, for 1 hour.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing after a few minutes? Check spam, or <button type="button" onClick={() => setSentTo(null)} className={`${linkCls} min-h-11`}>try another email</button>.
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} method="post" noValidate className="grid gap-5">
      <FormAlert message={alert} ref={alertRef} />
      <Field id="email" label="Email" error={error}>
        {(a) => <input {...a} name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={200} />}
      </Field>
      <button type="submit" disabled={busy} aria-busy={busy} className={submitCls}>
        {busy && <UiIcon name="loader" size={18} className="animate-spin motion-reduce:animate-none" />}
        Send reset link
      </button>
      <p className="text-center text-sm text-muted-foreground">Remembered it? <Link href="/account/login" className={linkCls}>Sign in</Link></p>
    </form>
  );
}

/** Bước 2: từ link trong email → mật khẩu mới → đăng nhập luôn, về /account. */
export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const password = String(new FormData(ev.currentTarget).get('password') ?? '');
    setAlert(null);
    if (password.length < 8) { setErrors({ password: password ? 'Use at least 8 characters' : 'Enter a new password' }); document.getElementById('password')?.focus(); return; }
    setErrors({});
    setBusy(true);
    const r = await postJson('/api/account/reset', { token, password });
    if (r.ok) { router.push('/account'); router.refresh(); return; }
    setBusy(false);
    setExpired(r.status === 400 && !r.fields.password);
    setErrors(r.fields.password ? { password: r.fields.password } : {});
    setAlert(r.message);
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  return (
    <form onSubmit={submit} method="post" noValidate className="grid gap-5">
      <FormAlert message={alert} ref={alertRef} />
      {expired && <p className="-mt-2 text-sm"><Link href="/account/forgot" className={linkCls}>Send a new reset link</Link></p>}
      <Field id="password" label="New password" error={errors.password} hint="At least 8 characters.">
        {(a) => (
          <div className="relative">
            <input {...a} name="password" type={show ? 'text' : 'password'} autoComplete="new-password" maxLength={200} className={`${a.className} pr-12`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
              <UiIcon name={show ? 'eyeOff' : 'eye'} size={20} />
            </button>
          </div>
        )}
      </Field>
      <button type="submit" disabled={busy} aria-busy={busy} className={submitCls}>
        {busy && <UiIcon name="loader" size={18} className="animate-spin motion-reduce:animate-none" />}
        Save new password
      </button>
    </form>
  );
}
