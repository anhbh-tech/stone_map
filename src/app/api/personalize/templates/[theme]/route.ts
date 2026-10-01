// GET /api/personalize/templates/:theme[?rev=] → TemplateView. Template cố định của theme: urls.empty là slide
// "khung trống" của trang sản phẩm trước khi khách upload. Lỗi pearl_compare → { error, fallback }.
import { getSettings } from '../../../../../lib/settings';
import { engineFor, isPcTheme, templateView } from '../../../../../lib/personalize/engine';
import { apiError, engineError, handle } from '../../../../../lib/personalize/http';
import { PcError } from '../../../../../lib/personalize/pearl-compare';

type Ctx = { params: Promise<{ theme: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const theme = (await ctx.params).theme;
  if (!isPcTheme(theme)) return apiError(404, 'no_template', 'This style has no template.');
  const rev = new URL(req.url).searchParams.get('rev');
  try {
    return Response.json(await templateView(engineFor(getSettings()), theme, rev), { headers: { 'cache-control': 'public, max-age=60' } });
  } catch (e) {
    if (e instanceof PcError) return engineError(e);
    throw e;
  }
});
