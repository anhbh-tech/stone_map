// Client nhỏ cho hợp đồng API ở docs/ARCHITECTURE.md mục 4. Personalizer chỉ gọi API qua file này.
import type { DesignView, JobView, Preflight } from '@/lib/types';

export type Transform = { rotate: number; zoom: number; x: number; y: number };
export type UploadResult = { upload_id: string; url: string; preflight: Preflight };
export type CreateDesignBody = {
  product_id: number; variant_id?: number; upload_id: string; mode: 'ai' | 'designer';
  style?: string; pet_name?: string; notes?: string; email?: string;
};
export type PatchDesignBody = { variant_id?: number; transform?: Transform; style?: string; pet_name?: string; notes?: string; email?: string };

/** Lỗi theo hợp đồng `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code || 'http_' + res.status, err?.message || 'Something went wrong. Please try again.');
  }
  return data as T;
}

export const api = {
  upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    form.append('consent', '1');
    return call<UploadResult>('/api/personalize/uploads', { method: 'POST', body: form });
  },
  createDesign: (body: CreateDesignBody) => call<DesignView>('/api/personalize/designs', { method: 'POST', json: body }),
  patchDesign: (id: string, body: PatchDesignBody) => call<DesignView>(`/api/personalize/designs/${id}`, { method: 'PATCH', json: body }),
  generate: (id: string, style: string) => call<JobView>(`/api/personalize/designs/${id}/generate`, { method: 'POST', json: { style } }),
  job: (id: string) => call<JobView>(`/api/personalize/jobs/${id}`, { cache: 'no-store' }),
  confirm: (id: string) => call<DesignView>(`/api/personalize/designs/${id}/confirm`, { method: 'POST', json: { confirmed: true } }),
  submit: (id: string) => call<DesignView>(`/api/personalize/designs/${id}/submit`, { method: 'POST' }),
  addLine: (body: { variant_id: number; qty: number; design_id: string }) => call<unknown>('/api/cart/lines', { method: 'POST', json: body }),
  setAddon: (body: { addon_id: number; on: boolean; text?: string }) => call<unknown>('/api/cart/addons', { method: 'PUT', json: body }),
};
