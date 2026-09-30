import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { admin, HttpError, notFound } from '@/app/admin/_lib/http';
import { getDesignRow } from '@/app/admin/_lib/repo';
import { mediaUrl } from '@/app/admin/_lib/storage';
import { STORAGE, db } from '@/lib/db';

const MAX_BYTES = 40 * 1024 * 1024;

// Designer upload bản làm tay (#11): lưu file in vuông variants.print_px (PNG sRGB 300 dpi, giống worker render)
// + preview webp. Đường dẫn lưu dạng "storage/designs/<id>/…" như cột uploads.path.
export const POST = admin<{ id: string }>(async (req, { id }) => {
  const d = getDesignRow(id) ?? notFound('Design');
  if (d.status !== 'in_review' && d.status !== 'rejected')
    throw new HttpError(409, 'not_in_review', `Design is ${d.status}; artwork can only be added while it waits for review`);
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, 'file_required', 'Send multipart form data with a file field'); }
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new HttpError(400, 'file_required', 'Choose an image file', { file: 'Choose an image file' });
  if (file.size > MAX_BYTES) throw new HttpError(413, 'file_too_large', 'Artwork must be 40 MB or smaller', { file: 'Must be 40 MB or smaller' });

  const input = Buffer.from(await file.arrayBuffer());
  let meta: Metadata;
  try { meta = await sharp(input).metadata(); } catch { throw new HttpError(422, 'not_an_image', 'File is not a readable image', { file: 'Not a readable image (PNG, JPEG, WebP, TIFF)' }); }
  const px = d.print_px ?? 2000;
  if (!meta.width || !meta.height) throw new HttpError(422, 'not_an_image', 'File is not a readable image', { file: 'Not a readable image' });

  const rel = `designs/${id}`;
  const stamp = Date.now();
  await fs.mkdir(path.join(STORAGE, rel), { recursive: true });
  const printRel = `${rel}/artwork-${stamp}.png`;
  const previewRel = `${rel}/artwork-${stamp}-preview.webp`;
  const base = sharp(input).rotate().toColorspace('srgb');
  await base.clone().resize(px, px, { fit: 'cover' }).withMetadata({ density: 300 }).png().toFile(path.join(STORAGE, printRel));
  await base.clone().resize(1024, 1024, { fit: 'cover' }).webp({ quality: 82 }).toFile(path.join(STORAGE, previewRel));

  db().prepare("UPDATE designs SET print_path = ?, preview_path = ?, status = 'in_review', updated_at = datetime('now') WHERE id = ?")
    .run(`storage/${printRel}`, `storage/${previewRel}`, id);
  return Response.json({
    id, status: 'in_review', print_px: px, source: { width: meta.width, height: meta.height },
    preview_url: mediaUrl(previewRel), print_url: `/api/admin/designs/${id}/print`,
    warning: Math.min(meta.width, meta.height) < px ? `Source is ${Math.min(meta.width, meta.height)} px on its short side; it was upscaled to ${px} px` : null,
  }, { status: 201 });
});
