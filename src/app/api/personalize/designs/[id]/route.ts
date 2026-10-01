// GET / PATCH /api/personalize/designs/:id → DesignViewV2.
import { z } from 'zod';
import { db, tx } from '../../../../../lib/db';
import { getSettings } from '../../../../../lib/settings';
import { designViewV2, editableFields, getDesign, nowIso, type PatchField } from '../../../../../lib/personalize/designs';
import { apiError, handle, ok, readJson } from '../../../../../lib/personalize/http';
import { themeForProduct } from '../../../../../lib/personalize/engine';
import { activeJobFor, createJob, wakeWorker } from '../../../../../lib/personalize/jobs';
import { DesignFields, checkProductVariant, checkStyle, lockedStyle } from '../../../../../lib/personalize/validate';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object(DesignFields).strict();

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const d = getDesign((await ctx.params).id);
  return d ? ok(designViewV2(d)) : apiError(404, 'not_found', 'Design not found.');
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const d = getDesign((await ctx.params).id);
  if (!d) return apiError(404, 'not_found', 'Design not found.');
  const r = await readJson(req, Body);
  if ('error' in r) return r.error;
  const b = r.data;
  const fields = (Object.keys(b) as PatchField[]).filter((k) => b[k] !== undefined);
  const allowed = editableFields(d.status);
  const locked = fields.filter((f) => !allowed.includes(f));
  if (locked.length) {
    return apiError(409, 'design_locked', `This design is ${d.status}; ${locked.join(', ')} can no longer be changed.`);
  }
  if (b.variant_id != null) { const e = checkProductVariant(d.product_id, b.variant_id); if (e) return e; }
  if (b.style != null) { const e = checkStyle(b.style, getSettings()); if (e) return e; }
  if (b.style != null) b.style = lockedStyle(themeForProduct(d.product_id), b.style);

  const values: Record<string, string | number | null> = {};
  for (const f of fields) values[f] = f === 'transform' ? (b.transform ? JSON.stringify(b.transform) : null) : (b[f] as string | number | null);
  if (!fields.length) return ok(designViewV2(d));

  tx(() => {
    db().prepare(`UPDATE designs SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...fields.map((f) => values[f]), nowIso(), d.id);
    // Đổi size sau khi đã xác nhận → render lại file in đúng print_px của size mới.
    if (d.status === 'confirmed' && fields.includes('variant_id') && b.variant_id !== d.variant_id && !activeJobFor(d.id, 'render_print')) {
      createJob(d.id, 'render_print', getSettings());
    }
  });
  wakeWorker();
  return ok(designViewV2(getDesign(d.id)!));
});
