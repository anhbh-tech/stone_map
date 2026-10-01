'use client';
// Form admin gọi thẳng /api/admin/* (đúng hợp đồng API, không có đường ghi thứ hai).
// <ApiForm types={{ price_cents: 'money' }}> đọc FormData → JSON đúng kiểu; lỗi `error.fields` hiện ngay dưới từng ô
// (aria-describedby + aria-invalid), focus nhảy vào ô sai đầu tiên, thông báo thành công qua role=status.
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon, type IconName } from './icons';
import { btn } from './ui';

export type FieldType = 'text' | 'nulltext' | 'int' | 'nullint' | 'num' | 'nullnum' | 'money' | 'nullmoney' | 'bool' | 'lines' | 'styles';

type ApiError = { code: string; message: string; fields?: Record<string, string> };
type Result = { ok: true; data: unknown } | { ok: false; error: ApiError };

export async function callApi(url: string, method: string, payload?: unknown): Promise<Result> {
  const isForm = typeof FormData !== 'undefined' && payload instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: payload === undefined || isForm ? undefined : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : isForm ? payload : JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: { code: 'network', message: 'Network error — check your connection and try again' } };
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, data };
  if (res.status === 401 && data?.error?.code === 'unauthorized') return { ok: false, error: { code: 'unauthorized', message: 'Your session expired. Reload the page to sign in again.' } };
  return { ok: false, error: data?.error ?? { code: 'http_' + res.status, message: `Request failed (${res.status})` } };
}

const toCents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, '')) * 100);
const toNum = (s: string) => Number(s.replace(/[,\s]/g, ''));

function convert(type: FieldType, raw: FormDataEntryValue | null, present: boolean): unknown {
  if (type === 'bool') return present;
  const s = typeof raw === 'string' ? raw.trim() : '';
  switch (type) {
    case 'text': return s === '' ? undefined : s;
    case 'nulltext': return s === '' ? null : s;
    case 'int': case 'num': return s === '' ? undefined : toNum(s);
    case 'nullint': case 'nullnum': return s === '' ? null : toNum(s);
    case 'money': return s === '' ? undefined : toCents(s);
    case 'nullmoney': return s === '' ? null : toCents(s);
    case 'lines': return s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    case 'styles': return s.split('\n').map((x) => x.trim()).filter(Boolean).map((line) => {
      const [id, ...name] = line.split('|');
      return { id: id.trim(), name: name.join('|').trim() };
    });
  }
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
  cur[keys[keys.length - 1]] = value;
}

/** Hỏi lại trước khi gửi: khi ô `field` rỗng (`empty`) hoặc mang một trong `values`. Dạng dữ liệu để server component truyền được. */
export type ConfirmRule = { field: string; empty?: boolean; values?: string[]; message: string };

// Form đang có chỉnh sửa chưa lưu (theo id): UnsavedGuard hỏi lại trước khi rời trang.
const dirtyForms = new Set<string>();
const LEAVE = 'You have unsaved changes on this page. Leave without saving?';

/** Gắn một lần trong layout admin: chặn link nội bộ, back/forward giữ nguyên, và reload/đóng tab khi còn form chưa lưu. */
export function UnsavedGuard() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyForms.size || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download') || a.getAttribute('href')?.startsWith('#')) return;
      if (!window.confirm(LEAVE)) { e.preventDefault(); e.stopPropagation(); return; }
      dirtyForms.clear();
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyForms.size) e.preventDefault(); };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('beforeunload', onUnload); };
  }, []);
  return null;
}

const FormCtx = createContext<{ errors: Record<string, string>; idFor: (n: string) => string }>({ errors: {}, idFor: (n) => n });

export function ApiForm({
  action, method = 'POST', types, extra, children, submitLabel = 'Save', pendingLabel = 'Saving…', successMessage = 'Saved',
  reset = false, redirect, tone = 'primary', className = '', inline = false, ariaLabel, confirm, trackDirty = true,
}: {
  action: string; method?: 'POST' | 'PATCH' | 'PUT'; types: Record<string, FieldType>; extra?: Record<string, unknown>;
  children: ReactNode; submitLabel?: string; pendingLabel?: string; successMessage?: string; reset?: boolean;
  /** Sau khi tạo xong: đường dẫn, `{id}` thay bằng id trả về. */
  redirect?: string; tone?: 'primary' | 'outline'; className?: string; inline?: boolean; ariaLabel?: string;
  confirm?: ConfirmRule[];
  /** false cho form thao tác (lọc, ghi chú nhanh) không cần cảnh báo khi rời trang. */
  trackDirty?: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => () => { dirtyForms.delete(uid); }, [uid]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const data: Record<string, unknown> = { ...extra };
    for (const [name, type] of Object.entries(types)) {
      const v = convert(type, fd.get(name), fd.has(name));
      if (v !== undefined) setPath(data, name, v);
    }
    for (const rule of confirm ?? []) {
      const raw = String(fd.get(rule.field) ?? '').trim();
      const hit = rule.empty ? raw === '' : !!rule.values?.includes(raw);
      if (hit && !window.confirm(rule.message)) return;
    }
    setPending(true); setMsg(null);
    const r = await callApi(action, method, data);
    setPending(false);
    if (!r.ok) {
      setErrors(r.error.fields ?? {});
      setMsg({ ok: false, text: r.error.message });
      const first = Object.keys(r.error.fields ?? {})[0];
      const el = first ? (form.elements.namedItem(first) as HTMLElement | null) : null;
      (el && 'focus' in el ? el : form.querySelector<HTMLElement>('[data-form-msg]'))?.focus();
      return;
    }
    setErrors({});
    dirtyForms.delete(uid);
    setMsg({ ok: true, text: successMessage });
    if (reset) form.reset();
    if (redirect) router.push(redirect.replace('{id}', String((r.data as { id?: unknown } | null)?.id ?? '')));
    router.refresh();
  }

  return (
    <FormCtx.Provider value={{ errors, idFor: (n) => `${uid}-${n.replace(/\W/g, '_')}` }}>
      <form ref={formRef} onSubmit={onSubmit} aria-label={ariaLabel} onInput={trackDirty ? () => dirtyForms.add(uid) : undefined} className={inline ? `flex flex-wrap items-end gap-3 ${className}` : `grid gap-4 ${className}`}>
        {children}
        <div className={`flex flex-wrap items-center gap-3 ${inline ? '' : 'pt-1'}`}>
          <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.base} ${btn[tone]}`}>
            {pending && <Icon name="loader" className="animate-spin" />}
            {pending ? pendingLabel : submitLabel}
          </button>
          <p data-form-msg tabIndex={-1} role={msg && !msg.ok ? 'alert' : 'status'} className={`text-sm outline-none ${msg?.ok ? 'text-success' : 'text-destructive'}`}>
            {msg && <span className="inline-flex items-center gap-1.5"><Icon name={msg.ok ? 'check' : 'alert'} size={16} />{msg.text}</span>}
          </p>
        </div>
      </form>
    </FormCtx.Provider>
  );
}

function useField(name: string, hint?: ReactNode) {
  const { errors, idFor } = useContext(FormCtx);
  const id = idFor(name);
  const error = errors[name];
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return { id, error, describedBy };
}

const inputCls = 'min-h-11 w-full rounded-[var(--radius)] border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-foreground aria-[invalid=true]:border-destructive';

function Wrap({ id, label, hint, error, children, required, className = '' }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; required?: boolean; className?: string }) {
  return (
    <div className={`grid min-w-0 gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}{required && <span className="text-muted-foreground"> (required)</span>}
      </label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-err`} className="flex items-center gap-1 text-sm text-destructive"><Icon name="alert" size={14} />{error}</p>}
    </div>
  );
}

type Common = { name: string; label: ReactNode; hint?: ReactNode; className?: string };

export function Field({ name, label, hint, className, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const f = useField(name, hint);
  return (
    <Wrap id={f.id} label={label} hint={hint} error={f.error} required={rest.required} className={className}>
      <input id={f.id} name={name} aria-invalid={!!f.error} aria-describedby={f.describedBy} className={inputCls} {...rest} />
    </Wrap>
  );
}

/** Ô nhập tiền theo đô la; ApiForm đổi sang cent (type 'money' / 'nullmoney'). */
export function MoneyField({ name, label, hint, className, cents, ...rest }: Common & { cents: number | null | undefined } & InputHTMLAttributes<HTMLInputElement>) {
  const f = useField(name, hint);
  return (
    <Wrap id={f.id} label={label} hint={hint} error={f.error} required={rest.required} className={className}>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground" aria-hidden="true">$</span>
        <input id={f.id} name={name} type="number" inputMode="decimal" step="0.01" min="0" defaultValue={cents == null ? '' : (cents / 100).toFixed(2)}
          aria-invalid={!!f.error} aria-describedby={f.describedBy} className={`${inputCls} pl-7 tabular-nums`} {...rest} />
      </div>
    </Wrap>
  );
}

/** Ô chữ có bộ đếm ký tự (meta title / description, #9). */
export function CountedField({ name, label, hint, max, multiline, defaultValue, className, required }: Common & { max: number; multiline?: boolean; defaultValue?: string | null; required?: boolean }) {
  const f = useField(name, hint);
  const [len, setLen] = useState((defaultValue ?? '').length);
  const over = len > max;
  const common = {
    id: f.id, name, maxLength: max, required, defaultValue: defaultValue ?? '', 'aria-invalid': !!f.error || over,
    'aria-describedby': [f.describedBy, `${f.id}-count`].filter(Boolean).join(' '),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setLen(e.target.value.length),
    className: inputCls,
  };
  return (
    <Wrap id={f.id} label={label} hint={hint} error={f.error} required={required} className={className}>
      {multiline ? <textarea rows={3} {...common} /> : <input {...common} />}
      <p id={`${f.id}-count`} className={`text-xs tabular-nums ${over ? 'text-destructive' : 'text-muted-foreground'}`}>{len} / {max} characters</p>
    </Wrap>
  );
}

export function TextArea({ name, label, hint, className, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const f = useField(name, hint);
  return (
    <Wrap id={f.id} label={label} hint={hint} error={f.error} required={rest.required} className={className}>
      <textarea id={f.id} name={name} rows={4} aria-invalid={!!f.error} aria-describedby={f.describedBy} className={inputCls} {...rest} />
    </Wrap>
  );
}

export function Select({ name, label, hint, className, options, ...rest }: Common & { options: readonly (string | { value: string; label: string })[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  const f = useField(name, hint);
  return (
    <Wrap id={f.id} label={label} hint={hint} error={f.error} required={rest.required} className={className}>
      <select id={f.id} name={name} aria-invalid={!!f.error} aria-describedby={f.describedBy} className={inputCls} {...rest}>
        {options.map((o) => {
          const { value, label: l } = typeof o === 'string' ? { value: o, label: o.replace(/_/g, ' ') } : o;
          return <option key={value} value={value}>{l}</option>;
        })}
      </select>
    </Wrap>
  );
}

export function Checkbox({ name, label, hint, defaultChecked, className = '' }: Common & { defaultChecked?: boolean }) {
  const f = useField(name, hint);
  return (
    <div className={`grid gap-1 ${className}`}>
      <label htmlFor={f.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-foreground">
        <input id={f.id} type="checkbox" name={name} defaultChecked={defaultChecked} aria-describedby={f.describedBy}
          className="size-5 shrink-0 cursor-pointer accent-[var(--primary)]" />
        {label}
      </label>
      {hint && <p id={`${f.id}-hint`} className="pl-8 text-xs text-muted-foreground">{hint}</p>}
      {f.error && <p id={`${f.id}-err`} className="pl-8 text-sm text-destructive">{f.error}</p>}
    </div>
  );
}

/** Nút gọi 1 API (đổi trạng thái, xoá). `confirm` → hỏi lại trước thao tác không hoàn tác được. */
export function ActionButton({ action, method = 'PATCH', payload, label, pendingLabel, confirm, tone = 'outline', icon, redirect, ariaLabel, done }: {
  action: string; method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; payload?: unknown; label: string; pendingLabel?: string; confirm?: string;
  tone?: keyof typeof btn; icon?: IconName; redirect?: string; ariaLabel?: string; done?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setPending(true); setMsg(null);
    const r = await callApi(action, method, payload);
    setPending(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error.message }); return; }
    if (done) setMsg({ ok: true, text: done });
    if (redirect) router.push(redirect);
    router.refresh();
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={pending} aria-busy={pending} aria-label={ariaLabel} className={`${btn.base} ${btn[tone === 'base' ? 'outline' : tone]}`}>
        {pending ? <Icon name="loader" className="animate-spin" /> : icon && <Icon name={icon} />}
        {pending ? pendingLabel ?? label : label}
      </button>
      <span role={msg && !msg.ok ? 'alert' : 'status'} className={`text-sm ${msg?.ok ? 'text-success' : 'text-destructive'}`}>{msg?.text}</span>
    </span>
  );
}

/** Upload file (multipart) — bản làm tay của designer, ảnh sản phẩm. children = field đi kèm file. */
export function UploadForm({ action, label, accept, hint, submitLabel = 'Upload artwork', successMessage = 'Artwork uploaded', extra, children }: {
  action: string; label: string; accept: string; hint?: string; submitLabel?: string; successMessage?: string; extra?: Record<string, string | number>; children?: ReactNode;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true); setMsg(null);
    const data = new FormData(form);
    for (const [k, v] of Object.entries(extra ?? {})) data.set(k, String(v));
    const r = await callApi(action, 'POST', data);
    setPending(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error.fields?.file ?? r.error.message }); return; }
    const warning = (r.data as { warning?: string | null })?.warning;
    setMsg({ ok: true, text: warning ? `Uploaded. ${warning}` : successMessage });
    form.reset();
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <label htmlFor={`${uid}-file`} className="text-sm font-medium text-foreground">{label}</label>
      <input id={`${uid}-file`} type="file" name="file" accept={accept} required aria-describedby={hint ? `${uid}-hint` : undefined}
        className="min-h-11 w-full min-w-0 rounded-[var(--radius)] border border-input bg-background px-2 py-2 text-sm file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-[var(--radius)] file:border-0 file:bg-muted file:px-3 file:text-sm file:font-medium file:text-foreground" />
      {hint && <p id={`${uid}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.base} ${btn.outline}`}>
          <Icon name={pending ? 'loader' : 'upload'} className={pending ? 'animate-spin' : ''} />{pending ? 'Uploading…' : submitLabel}
        </button>
        <span role={msg && !msg.ok ? 'alert' : 'status'} className={`text-sm ${msg?.ok ? 'text-success' : 'text-destructive'}`}>{msg?.text}</span>
      </div>
    </form>
  );
}
