// Ô nhập dùng chung cho form tài khoản: nhãn luôn hiện, lỗi ngay dưới ô (aria-describedby), cùng kiểu với CheckoutForm.
export type FieldErrors = Record<string, string>;

export function Field({ id, label, error, hint, className = '', children }: {
  id: string; label: string; error?: string; hint?: string; className?: string; children: (a: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; className: string }) => React.ReactNode;
}) {
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children({
        id, 'aria-invalid': error ? true : undefined, 'aria-describedby': described,
        className: `mt-1 block min-h-12 w-full rounded-md border bg-background px-3 text-foreground ${error ? 'border-destructive' : 'border-border'}`,
      })}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function FormAlert({ message, ref }: { message: string | null; ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} tabIndex={-1} role="alert" className={message ? 'rounded-md border border-destructive bg-card px-4 py-3 text-sm text-destructive outline-none' : 'sr-only'}>
      {message}
    </div>
  );
}

/** POST JSON tới API tài khoản; trả { ok, data, error, fields } theo hợp đồng lỗi { error: { code, message, fields? } }. */
export async function postJson<T>(url: string, body: unknown, method = 'POST'): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string; fields: FieldErrors }> {
  try {
    const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    if (res.status === 204) return { ok: true, data: undefined as T };
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: data as T };
    return { ok: false, status: res.status, message: data?.error?.message ?? 'Something went wrong. Please try again.', fields: data?.error?.fields ?? {} };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the store. Check your connection and try again.', fields: {} };
  }
}
