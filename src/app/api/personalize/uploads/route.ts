// POST /api/personalize/uploads — multipart `file` + `consent=1` → 201 { upload_id, url, preflight }.
import { db } from '../../../../lib/db';
import { newId } from '../../../../lib/ids';
import { getSettings } from '../../../../lib/settings';
import crypto from 'node:crypto';
import { apiError, handle, ok } from '../../../../lib/personalize/http';
import { ImageError, MAX_UPLOAD_BYTES, normalizeUpload } from '../../../../lib/personalize/images';
import { runPreflight } from '../../../../lib/personalize/preflight';
import { mediaUrl, writeStored } from '../../../../lib/personalize/storage';

const CONSENT_VALUES = new Set(['1', 'true', 'on', 'yes']);

export const POST = handle(async (req: Request) => {
  let form: FormData;
  try { form = await req.formData(); } catch {
    return apiError(400, 'invalid_body', 'Send the photo as multipart/form-data with the fields "file" and "consent".');
  }
  // Consent trước mọi xử lý ảnh (#10): không đồng ý thì không đọc, không lưu.
  if (!CONSENT_VALUES.has(String(form.get('consent') ?? '').toLowerCase())) {
    return apiError(400, 'consent_required', 'Please agree to let us process your photo before uploading it.');
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return apiError(400, 'file_required', 'Choose a photo of your pet to upload.');
  if (file.size > MAX_UPLOAD_BYTES) return apiError(413, 'file_too_large', `This photo is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Please choose a smaller file.`);

  let norm: Awaited<ReturnType<typeof normalizeUpload>>;
  try { norm = await normalizeUpload(Buffer.from(await file.arrayBuffer())); } catch (e) {
    if (e instanceof ImageError) return apiError(415, 'unsupported_image', e.message);
    throw e;
  }
  const s = getSettings();
  const preflight = await runPreflight(norm.buf, { width: norm.width, height: norm.height }, s);

  const id = newId('up');
  const rel = writeStored('uploads', `${id}.jpg`, norm.buf);
  const consentAt = new Date();
  const expiresAt = new Date(consentAt.getTime() + s.privacy.retention_days * 86_400_000);
  db().prepare(`INSERT INTO uploads (id, path, mime, width, height, sha, preflight, consent_at, expires_at)
    VALUES (?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?)`).run(
    id, rel, norm.width, norm.height, crypto.createHash('sha256').update(norm.buf).digest('hex'),
    JSON.stringify(preflight), consentAt.toISOString(), expiresAt.toISOString(),
  );
  return ok({ upload_id: id, url: mediaUrl(rel), preflight }, 201);
});
