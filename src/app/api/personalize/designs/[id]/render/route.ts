// POST /api/personalize/designs/:id/render { transform: PetTransform } → DesignViewV2. Khách bấm OK trong editor:
// pearl_compare render final phẳng theo transform (không gọi model, không tốn phí); lưu final + transform vào design.
import { z } from 'zod';
import { getSettings } from '../../../../../../lib/settings';
import { designViewV2, getDesign } from '../../../../../../lib/personalize/designs';
import { engineFor, NotReadyError, renderDesign } from '../../../../../../lib/personalize/engine';
import { apiError, engineError, handle, ok, readJson } from '../../../../../../lib/personalize/http';
import { PcError } from '../../../../../../lib/personalize/pearl-compare';
import { PetTransformSchema } from '../../../../../../lib/personalize/validate';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ transform: PetTransformSchema });

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const d = getDesign((await ctx.params).id);
  if (!d) return apiError(404, 'not_found', 'Design not found.');
  const r = await readJson(req, Body);
  if ('error' in r) return r.error;
  if (d.mode !== 'ai') return apiError(409, 'wrong_mode', 'Designer finish designs are made by hand.');
  try {
    return ok(designViewV2(await renderDesign(engineFor(getSettings()), d, r.data.transform)));
  } catch (e) {
    if (e instanceof NotReadyError) return apiError(409, 'not_ready', e.message);
    if (e instanceof PcError) return engineError(e);
    throw e;
  }
});
