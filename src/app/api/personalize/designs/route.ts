// POST /api/personalize/designs → 201 DesignViewV2. mode 'ai' cần preflight ok (422 preflight_failed); style bỏ trống = theme sản phẩm; sản phẩm theme luôn lưu theme của nó.
import { z } from 'zod';
import { db } from '../../../../lib/db';
import { designId } from '../../../../lib/ids';
import { getSettings } from '../../../../lib/settings';
import { designViewV2, getDesign, getUpload, nowIso, uploadAvailable, uploadPreflight } from '../../../../lib/personalize/designs';
import { apiError, handle, ok, readJson } from '../../../../lib/personalize/http';
import { DesignFields, checkProductVariant, checkStyle, lockedStyle } from '../../../../lib/personalize/validate';
import { themeForProduct } from '../../../../lib/personalize/engine';

const Body = z.object({
  product_id: z.number().int().positive(),
  upload_id: z.string().min(1).max(64),
  mode: z.enum(['ai', 'designer']),
  ...DesignFields,
});

export const POST = handle(async (req: Request) => {
  const r = await readJson(req, Body);
  if ('error' in r) return r.error;
  const b = r.data;
  const s = getSettings();

  const pv = checkProductVariant(b.product_id, b.variant_id ?? null);
  if (pv) return pv;
  if (b.style != null) { const e = checkStyle(b.style, s); if (e) return e; }
  const theme = themeForProduct(b.product_id);
  const style = lockedStyle(theme, b.style) ?? (b.mode === 'ai' ? theme : null);

  const up = getUpload(b.upload_id);
  if (!up) return apiError(404, 'upload_not_found', 'We could not find that photo. Please upload it again.');
  if (!uploadAvailable(up)) return apiError(410, 'upload_expired', 'That photo has expired from our servers. Please upload it again.');
  const pf = uploadPreflight(up);
  if (b.mode === 'ai' && !pf?.ok) {
    return apiError(422, 'preflight_failed', pf?.issues[0]?.message ?? 'This photo did not pass our checks. Choose another photo, or Designer finish.');
  }

  let id = designId();
  while (getDesign(id)) id = designId();
  const now = nowIso();
  db().prepare(`INSERT INTO designs (id, product_id, variant_id, upload_id, mode, style, pet_name, notes, email, transform, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).run(
    id, b.product_id, b.variant_id ?? null, b.upload_id, b.mode, style, b.pet_name ?? null, b.notes ?? null,
    b.email ?? null, b.transform ? JSON.stringify(b.transform) : null, now, now,
  );
  return ok(designViewV2(getDesign(id)!), 201);
});
