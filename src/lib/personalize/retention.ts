// Xoá ảnh gốc hết hạn lưu (#10): uploads.expires_at = consent_at + settings.privacy.retention_days.
// File bị xoá, dòng giữ lại (designs / đơn tham chiếu upload_id) với purged_at; upload_url trả null từ đó.
import { db } from '../db';
import { nowIso } from './designs';
import { removeStored } from './storage';

export function purgeExpiredUploads(now = new Date()): number {
  const rows = db().prepare('SELECT id, path FROM uploads WHERE purged_at IS NULL AND expires_at <= ?').all(now.toISOString()) as { id: string; path: string }[];
  const mark = db().prepare('UPDATE uploads SET purged_at = ? WHERE id = ?');
  for (const r of rows) {
    removeStored(r.path);
    mark.run(nowIso(), r.id);
  }
  return rows.length;
}
