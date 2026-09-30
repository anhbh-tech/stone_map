// Bố cục storage/ của module personalize. DB lưu đường dẫn TƯƠNG ĐỐI với STORAGE (vd "previews/DSN-AB12CD-k3.webp").
//   uploads/   ảnh gốc khách gửi, đã xoay EXIF + bỏ metadata      → /media/uploads/…  (xoá khi hết hạn, #10)
//   previews/  ảnh AI bản web (webp)                              → /media/previews/…
//   mockups/   ảnh treo tường (webp)                              → /media/mockups/…
//   generated/ ảnh AI gốc độ phân giải đầy đủ (nguồn để render in) — không public
//   print/     file in PNG print_px² 300 dpi                        — không public, chỉ qua /api/admin/designs/:id/print
// Module khác đọc file bằng storagePath(rel); không tự ghép đường dẫn.
import fs from 'node:fs';
import path from 'node:path';
import { STORAGE } from '../db';

export const PUBLIC_DIRS = ['uploads', 'previews', 'mockups'] as const;
export type StorageDir = (typeof PUBLIC_DIRS)[number] | 'generated' | 'print';

/** Đường dẫn tuyệt đối từ đường dẫn tương đối đã lưu trong DB. */
export const storagePath = (rel: string) => path.join(STORAGE, normalizeRel(rel));

/** Ghi file vào 1 thư mục con, trả về đường dẫn tương đối để lưu DB. */
export function writeStored(dir: StorageDir, name: string, buf: Buffer): string {
  fs.mkdirSync(path.join(STORAGE, dir), { recursive: true });
  const rel = `${dir}/${name}`;
  fs.writeFileSync(storagePath(rel), buf);
  return rel;
}

export function removeStored(rel: string | null | undefined) {
  if (!rel) return;
  try { fs.unlinkSync(storagePath(rel)); } catch { /* đã xoá */ }
}

const FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp)$/;
// Bản xem trước artwork designer (crew A ghi storage/designs/<DSN>/artwork-<stamp>-preview.webp). File in PNG cùng thư mục vẫn riêng tư.
const ARTWORK_PREVIEW = /^designs\/DSN-[A-Z0-9]+\/[A-Za-z0-9_-][A-Za-z0-9._-]*-preview\.webp$/;

/** Bỏ tiền tố "storage/" mà một số module ghi vào cột *_path. */
export const normalizeRel = (rel: string) => rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^storage\//, '');

/** Đường dẫn tương đối có được phục vụ công khai qua /media không. */
export function isPublicRel(rel: string): boolean {
  const r = normalizeRel(rel);
  if (r.split('/').includes('..')) return false;
  if (ARTWORK_PREVIEW.test(r)) return true;
  const segs = r.split('/');
  return segs.length === 2 && (PUBLIC_DIRS as readonly string[]).includes(segs[0]) && FILE.test(segs[1]);
}

/** URL công khai cho file trong thư mục public; file in / ảnh gốc AI không bao giờ có URL /media. */
export function mediaUrl(rel: string | null | undefined): string | null {
  if (!rel) return null;
  return isPublicRel(rel) ? `/media/${normalizeRel(rel)}` : null;
}

/** Map /media/<…> → đường dẫn tuyệt đối, hoặc null nếu không được phép (thư mục riêng, db, "..", file in). */
export function resolveMedia(segments: string[]): string | null {
  const rel = segments.join('/');
  if (segments.some((s) => !s || s === '.' || s === '..' || s.includes('/') || s.includes('\\')) || rel !== normalizeRel(rel) || !isPublicRel(rel)) return null;
  const abs = path.join(STORAGE, rel);
  return abs.startsWith(STORAGE + path.sep) ? abs : null;
}
