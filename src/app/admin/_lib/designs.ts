// Hàng chờ design: cần duyệt (designer finish hoặc AI được giao lại cho designer), preview AI để soát, lỗi, đã duyệt/từ chối.
import { db, json } from '../../../lib/db';
import type { DesignStatus } from '../../../lib/types';
import { like, offset, type ListState } from './list';
import { mediaUrl } from './storage';

export const DESIGN_TABS = [
  { key: 'in_review', label: 'Needs review', where: "g.status = 'in_review'", order: 'g.updated_at ASC' },
  { key: 'ai', label: 'AI previews', where: "g.mode = 'ai' AND g.status IN ('ready','confirmed')", order: 'g.updated_at DESC' },
  { key: 'failed', label: 'Failed', where: "g.status = 'failed'", order: 'g.updated_at DESC' },
  { key: 'approved', label: 'Approved', where: "g.status = 'approved'", order: 'g.updated_at DESC' },
  { key: 'rejected', label: 'Rejected', where: "g.status = 'rejected'", order: 'g.updated_at DESC' },
] as const;
export type DesignTab = (typeof DESIGN_TABS)[number]['key'];

export type QueueItem = {
  id: string; mode: 'ai' | 'designer'; status: DesignStatus; style: string | null; pet_name: string | null; notes: string | null;
  email: string | null; created_at: string; updated_at: string; product_title: string | null; variant_size: string | null; print_px: number | null;
  upload_url: string | null; upload_size: string | null; preview_url: string | null; has_print: boolean;
  assignee_id: number | null; assignee: string | null; orders: { id: number; number: string }[];
};

type Raw = Omit<QueueItem, 'upload_url' | 'upload_size' | 'preview_url' | 'has_print' | 'orders'> & {
  preview_path: string | null; print_path: string | null; upload_path: string | null; width: number | null; height: number | null;
};

const SELECT = `SELECT g.id, g.mode, g.status, g.style, g.pet_name, g.notes, coalesce(g.email, (SELECT o.email FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.design_id = g.id ORDER BY o.id DESC LIMIT 1)) AS email, g.created_at, g.updated_at, g.assignee_id,
    g.preview_path, g.print_path, p.title AS product_title, v.size AS variant_size, v.print_px, u.path AS upload_path, u.width, u.height,
    coalesce(a.display_name, a.username) AS assignee
  FROM designs g LEFT JOIN products p ON p.id = g.product_id LEFT JOIN variants v ON v.id = g.variant_id
  LEFT JOIN uploads u ON u.id = g.upload_id LEFT JOIN admin_users a ON a.id = g.assignee_id`;

function shape(rows: Raw[]): QueueItem[] {
  const ordersFor = db().prepare('SELECT DISTINCT o.id, o.number FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.design_id = ?');
  return rows.map(({ preview_path, print_path, upload_path, width, height, ...r }) => ({
    ...r,
    upload_url: mediaUrl(upload_path),
    upload_size: width && height ? `${width}×${height}` : null,
    preview_url: mediaUrl(preview_path),
    has_print: !!print_path,
    orders: ordersFor.all(r.id) as { id: number; number: string }[],
  }));
}

/** assignee: 'unassigned' | id nhân viên | undefined (tất cả). */
export function searchDesigns(tab: DesignTab, s: ListState<'date'>, assignee?: 'unassigned' | number) {
  const t = DESIGN_TABS.find((x) => x.key === tab) ?? DESIGN_TABS[0];
  const w: string[] = [t.where];
  const args: (string | number)[] = [];
  if (assignee === 'unassigned') w.push('g.assignee_id IS NULL');
  else if (typeof assignee === 'number') { w.push('g.assignee_id = ?'); args.push(assignee); }
  if (s.q) {
    w.push("(g.id LIKE ? ESCAPE '\\' OR g.pet_name LIKE ? ESCAPE '\\' OR g.email LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.design_id = g.id AND o.number = ?))");
    args.push(like(s.q), like(s.q), like(s.q), s.q.replace(/^#/, ''));
  }
  const sql = `WHERE ${w.join(' AND ')}`;
  const d = db();
  const rows = d.prepare(`${SELECT} ${sql} ORDER BY ${t.order}, g.id LIMIT ? OFFSET ?`).all(...args, s.per, offset(s)) as Raw[];
  const total = (d.prepare(`SELECT count(*) AS n FROM designs g ${sql}`).get(...args) as { n: number }).n;
  return { rows: shape(rows), total };
}

export function designTabCounts(): Record<DesignTab, number> {
  const d = db();
  return Object.fromEntries(DESIGN_TABS.map((t) => [t.key, (d.prepare(`SELECT count(*) AS n FROM designs g WHERE ${t.where}`).get() as { n: number }).n])) as Record<DesignTab, number>;
}

export type DesignJob = { id: string; status: string; stage: string | null; provider: string; model: string; attempts: number; error: string | null; check: Record<string, unknown> | null; queued_at: string; finished_at: string | null; ms: number | null };

export function getDesignDetail(id: string): (QueueItem & { transform: Record<string, number> | null; confirmed_at: string | null; jobs: DesignJob[]; preflight: Record<string, unknown> | null; mockup_url: string | null }) | null {
  const d = db();
  const raw = d.prepare(`${SELECT} WHERE g.id = ?`).get(id) as Raw | undefined;
  if (!raw) return null;
  const extra = d.prepare('SELECT g.transform, g.confirmed_at, g.mockup_path, u.preflight FROM designs g LEFT JOIN uploads u ON u.id = g.upload_id WHERE g.id = ?').get(id) as
    { transform: string | null; confirmed_at: string | null; mockup_path: string | null; preflight: string | null };
  const jobs = (d.prepare(`SELECT id, status, stage, provider, model, attempts, error, check_result, queued_at, finished_at,
      CASE WHEN finished_at IS NOT NULL THEN (julianday(finished_at) - julianday(queued_at)) * 86400000 END AS ms
    FROM jobs WHERE design_id = ? ORDER BY queued_at DESC`).all(id) as (Omit<DesignJob, 'check'> & { check_result: string | null })[])
    .map(({ check_result, ...j }) => ({ ...j, ms: j.ms == null ? null : Math.round(j.ms), check: json(check_result, null as Record<string, unknown> | null) }));
  return {
    ...shape([raw])[0],
    transform: json(extra.transform, null as Record<string, number> | null),
    confirmed_at: extra.confirmed_at,
    mockup_url: mediaUrl(extra.mockup_path),
    preflight: json(extra.preflight, null as Record<string, unknown> | null),
    jobs,
  };
}
