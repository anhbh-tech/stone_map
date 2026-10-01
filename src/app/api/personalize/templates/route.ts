// GET /api/personalize/templates?product_id=N → TemplateView của theme sản phẩm (tag style:<theme>).
import { getSettings } from '../../../../lib/settings';
import { engineFor, templateView, themeForProduct } from '../../../../lib/personalize/engine';
import { apiError, engineError, handle } from '../../../../lib/personalize/http';
import { PcError } from '../../../../lib/personalize/pearl-compare';

export const GET = handle(async (req: Request) => {
  const id = Number(new URL(req.url).searchParams.get('product_id'));
  if (!Number.isInteger(id) || id <= 0) return apiError(400, 'product_id_required', 'Pass ?product_id=<id>.');
  const theme = themeForProduct(id);
  if (!theme) return apiError(404, 'no_template', 'This product has no pearl_compare theme.');
  try {
    return Response.json(await templateView(engineFor(getSettings()), theme), { headers: { 'cache-control': 'public, max-age=60' } });
  } catch (e) {
    if (e instanceof PcError) return engineError(e);
    throw e;
  }
});
