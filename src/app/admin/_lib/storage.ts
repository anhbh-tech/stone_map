// Đường dẫn file trong storage/: cột *_path có thể là "storage/uploads/x.jpg" hoặc "uploads/x.jpg".
// Mọi đường đều được ép nằm trong STORAGE (chống path traversal) trước khi đọc.
import path from 'node:path';
import { STORAGE as STORAGE_DIR } from '../../../lib/db';

const STORAGE = path.resolve(STORAGE_DIR);

export function storageRel(p: string | null | undefined): string | null {
  if (!p) return null;
  let rel = p.replace(/\\/g, '/');
  if (path.isAbsolute(rel)) rel = path.relative(STORAGE, rel).replace(/\\/g, '/');
  rel = rel.replace(/^\/+/, '').replace(/^storage\//, '');
  const abs = path.resolve(STORAGE, rel);
  if (!abs.startsWith(STORAGE + path.sep)) return null;
  return rel;
}

export const storageAbs = (p: string | null | undefined) => {
  const rel = storageRel(p);
  return rel ? path.join(STORAGE, rel) : null;
};

/** URL công khai của ảnh trong storage/ qua route /media/:path* (crew B). File in không bao giờ đi qua đây. */
export function mediaUrl(p: string | null | undefined): string | null {
  if (!p) return null;
  if (p.startsWith('/media/') || /^https?:\/\//.test(p)) return p;
  const rel = storageRel(p);
  return rel ? `/media/${rel.split('/').map(encodeURIComponent).join('/')}` : null;
}
