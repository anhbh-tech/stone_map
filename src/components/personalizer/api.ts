// Client nhỏ cho hợp đồng API ở docs/ARCHITECTURE.md mục 4. Personalizer chỉ gọi API qua file này.
import type { DesignView, JobView, Preflight } from '@/lib/types';

export type Transform = { rotate: number; zoom: number; x: number; y: number };
export type UploadResult = { upload_id: string; url: string; preflight: Preflight };
export type CreateDesignBody = {
  product_id: number; variant_id?: number; upload_id: string; mode: 'ai' | 'designer';
  style?: string; pet_name?: string; notes?: string; email?: string;
};
export type PatchDesignBody = { variant_id?: number; transform?: Transform; style?: string; pet_name?: string; notes?: string; email?: string };

// ── v2 theo lớp (pearl_compare docs/OUTPUT.md): template của theme + cutout pet + transform. Editor vẽ
// base → canvasBg → pet (cắt theo clip) → overlay; OK → POST /designs/:id/render → final phẳng mới.
// STUB: bản sao đúng hình dạng của src/lib/personalize/contract.ts (backend pc-v2-template-cutout, commit 16a1eb0) tới khi
// nhánh đó vào main; khi đó thay khối này bằng import từ '@/lib/personalize/contract'.
export type Pt = [number, number];
export type PetTransform = { x: number; y: number; scale: number; rotate: number };
export type TemplateView = {
  theme: string;
  rev: string;
  kind: 'theme' | 'scene';
  size: { w: number; h: number };
  quad: [Pt, Pt, Pt, Pt];
  clip: Pt[];
  canvas_bg: { w: number; h: number } | null;
  urls: { base: string; canvas_bg: string | null; overlay: string; mask: string | null; empty: string | null };
};
export type CutoutView = { url: string; w: number; h: number; default_transform: PetTransform; bottom_cut: boolean };
export type PcDesign = {
  theme: string;
  template: TemplateView;
  cutout: CutoutView;
  transform: PetTransform;
  final_url: string;
  pass: boolean | null;
  why: string[];
  scene: boolean;
  rendered_at: string;
};
export type Fallback = 'designer_upload';
export type DesignViewV2 = DesignView & { product_id?: number; theme?: string | null; pc?: PcDesign | null };
export type JobViewV2 = Omit<JobView, 'design'> & { message?: string; fallback?: Fallback | null; design: DesignViewV2 | null };

/** Phần v2 của design (null = design v1 / designer / chưa gen xong → editor cũ). */
export const layeredOf = (d: DesignView | null | undefined): PcDesign | null => (d as DesignViewV2 | null | undefined)?.pc ?? null;

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
  generate: (id: string, style: string) => call<JobViewV2>(`/api/personalize/designs/${id}/generate`, { method: 'POST', json: { style } }),
  job: (id: string) => call<JobViewV2>(`/api/personalize/jobs/${id}`, { cache: 'no-store' }),
  /** Khách bấm OK trong editor theo lớp: server render final mới với transform này (không gọi model). */
  render: (id: string, transform: PetTransform) => call<DesignViewV2>(`/api/personalize/designs/${id}/render`, { method: 'POST', json: { transform } }),
  confirm: (id: string) => call<DesignView>(`/api/personalize/designs/${id}/confirm`, { method: 'POST', json: { confirmed: true } }),
  submit: (id: string) => call<DesignView>(`/api/personalize/designs/${id}/submit`, { method: 'POST' }),
  addLine: (body: { variant_id: number; qty: number; design_id: string }) => call<unknown>('/api/cart/lines', { method: 'POST', json: body }),
  setAddon: (body: { addon_id: number; on: boolean; text?: string }) => call<unknown>('/api/cart/addons', { method: 'PUT', json: body }),
};
