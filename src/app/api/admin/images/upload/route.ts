import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { admin, HttpError, insertRow, parse } from '@/app/admin/_lib/http';
import { imageCreate } from '@/app/admin/_lib/schemas';
import { STORAGE, db } from '@/lib/db';

const MAX_BYTES = 20 * 1024 * 1024;

// Ảnh sản phẩm upload từ máy (A-08): chuẩn hoá về WebP (cạnh dài ≤ 2000 px, không phóng to) và lưu vào storage/mockups/
// (thư mục công khai qua /media), rồi tạo dòng product_images như POST /api/admin/images.
export const POST = admin(async (req) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, 'file_required', 'Send multipart form data with a file field'); }
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new HttpError(400, 'file_required', 'Choose an image file', { file: 'Choose an image file' });
  if (file.size > MAX_BYTES) throw new HttpError(413, 'file_too_large', 'Image must be 20 MB or smaller', { file: 'Must be 20 MB or smaller' });
  const fields = parse(imageCreate.omit({ url: true }), {
    product_id: Number(form.get('product_id')),
    alt: String(form.get('alt') ?? ''),
    kind: form.get('kind') || undefined,
    position: form.get('position') === null || form.get('position') === '' ? undefined : Number(form.get('position')),
  });
  if (!db().prepare('SELECT 1 FROM products WHERE id = ?').get(fields.product_id)) throw new HttpError(404, 'not_found', 'Product not found');

  const input = Buffer.from(await file.arrayBuffer());
  try { await sharp(input).metadata(); } catch { throw new HttpError(422, 'not_an_image', 'File is not a readable image', { file: 'Not a readable image (PNG, JPEG, WebP, AVIF)' }); }
  const name = `product-${fields.product_id}-${Date.now()}.webp`;
  await fs.mkdir(path.join(STORAGE, 'mockups'), { recursive: true });
  await sharp(input).rotate().toColorspace('srgb').resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 })
    .toFile(path.join(STORAGE, 'mockups', name));

  const id = insertRow('product_images', { ...fields, url: `/media/mockups/${name}` });
  return Response.json(db().prepare('SELECT * FROM product_images WHERE id = ?').get(id), { status: 201 });
});
