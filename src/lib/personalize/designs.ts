// Designs: đọc/ghi bảng designs + máy trạng thái. Module khác (admin, giỏ) import designView / transition từ đây.
import { db, json } from '../db';
import type { DesignStatus, DesignView, Preflight } from '../types';
import { mediaUrl } from './storage';

export type DesignRow = {
  id: string; product_id: number; variant_id: number | null; upload_id: string | null; mode: 'ai' | 'designer';
  style: string | null; pet_name: string | null; notes: string | null; status: DesignStatus; transform: string | null;
  preview_path: string | null; print_path: string | null; mockup_path: string | null; source_path: string | null;
  confirmed_at: string | null; email: string | null; created_at: string; updated_at: string;
};
export type UploadRow = {
  id: string; path: string; mime: string; width: number; height: number; sha: string; preflight: string;
  consent_at: string; expires_at: string; purged_at: string | null; created_at: string;
};

/**
 * Máy trạng thái design.
 *   ai:       draft ─generate→ generating ─job_succeeded→ ready ─confirm→ confirmed
 *                                 └─job_failed→ failed ─generate→ generating   (ready ─generate→ generating: đổi style)
 *   designer: draft ─submit→ in_review ─approve→ approved | ─reject→ rejected ─submit→ in_review
 */
export type DesignEvent = 'generate' | 'job_succeeded' | 'job_failed' | 'confirm' | 'submit' | 'approve' | 'reject';
const TRANSITIONS: Record<'ai' | 'designer', Partial<Record<DesignStatus, Partial<Record<DesignEvent, DesignStatus>>>>> = {
  ai: {
    draft: { generate: 'generating' },
    generating: { job_succeeded: 'ready', job_failed: 'failed' },
    ready: { generate: 'generating', confirm: 'confirmed' },
    failed: { generate: 'generating' },
  },
  designer: {
    draft: { submit: 'in_review' },
    in_review: { approve: 'approved', reject: 'rejected' },
    rejected: { submit: 'in_review' },
  },
};

export function nextStatus(mode: 'ai' | 'designer', from: DesignStatus, ev: DesignEvent): DesignStatus | null {
  return TRANSITIONS[mode][from]?.[ev] ?? null;
}

/** Trường PATCH được phép theo trạng thái. confirmed: đổi size (render lại file in) và thông tin liên hệ, không đổi ảnh. */
export type PatchField = 'variant_id' | 'transform' | 'style' | 'pet_name' | 'notes' | 'email';
const ALL: PatchField[] = ['variant_id', 'transform', 'style', 'pet_name', 'notes', 'email'];
export function editableFields(status: DesignStatus): PatchField[] {
  switch (status) {
    case 'draft': case 'generating': case 'ready': case 'failed': case 'rejected': return ALL;
    case 'confirmed': return ['variant_id', 'pet_name', 'notes', 'email'];
    case 'in_review': return ['variant_id', 'pet_name', 'notes', 'email'];
    default: return [];
  }
}

export class TransitionError extends Error {
  constructor(readonly from: DesignStatus, readonly event: DesignEvent) { super(`Cannot ${event} a design that is ${from}`); }
}

/** Chuyển trạng thái có kiểm tra, cập nhật thêm cột nếu cần. Ném TransitionError nếu không hợp lệ. */
export function transition(id: string, ev: DesignEvent, extra: Partial<Record<keyof DesignRow, string | number | null>> = {}): DesignRow {
  const d = getDesign(id);
  if (!d) throw new Error(`design ${id} not found`);
  const to = nextStatus(d.mode, d.status, ev);
  if (!to) throw new TransitionError(d.status, ev);
  const cols = Object.keys(extra);
  db().prepare(`UPDATE designs SET status = ?, ${cols.map((c) => `${c} = ?, `).join('')}updated_at = ? WHERE id = ? AND status = ?`)
    .run(to, ...cols.map((c) => extra[c as keyof DesignRow] ?? null), nowIso(), id, d.status);
  return getDesign(id)!;
}

export const nowIso = () => new Date().toISOString();
export const getDesign = (id: string) => db().prepare('SELECT * FROM designs WHERE id = ?').get(id) as DesignRow | undefined;
export const getUpload = (id: string) => db().prepare('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow | undefined;
export const uploadPreflight = (u: UploadRow) => json<Preflight | null>(u.preflight, null);
export const uploadAvailable = (u: UploadRow, now = Date.now()) => !u.purged_at && Date.parse(u.expires_at) > now;

/**
 * DesignView cho API. print_url chỉ có với `admin: true` (trỏ về route tải của admin); khách không bao giờ thấy file in.
 */
export function designView(d: DesignRow, opts: { admin?: boolean } = {}): DesignView {
  const up = d.upload_id ? getUpload(d.upload_id) : undefined;
  return {
    id: d.id,
    mode: d.mode,
    status: d.status,
    style: d.style,
    pet_name: d.pet_name,
    notes: d.notes,
    upload_url: up && !up.purged_at ? mediaUrl(up.path) : null,
    preview_url: mediaUrl(d.preview_path),
    mockup_url: mediaUrl(d.mockup_path),
    print_url: opts.admin && d.print_path ? `/api/admin/designs/${encodeURIComponent(d.id)}/print` : null,
    confirmed: d.confirmed_at != null,
  };
}
