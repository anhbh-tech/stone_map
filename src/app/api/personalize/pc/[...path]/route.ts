// GET /api/personalize/pc/outputs/templates/<file> — proxy ảnh lớp template của pearl_compare về cùng origin (canvas
// editor không bị taint, trình duyệt không cần thấy :5177). CHỈ outputs/templates/: outputs/ còn ảnh pet gốc và final
// của khách khác. Final + cutout của khách được chép về storage/ và đi qua /media.
import { getSettings } from '../../../../../lib/settings';
import { engineFor } from '../../../../../lib/personalize/engine';
import { PcError, safeOutputsRel } from '../../../../../lib/personalize/pearl-compare';

type Ctx = { params: Promise<{ path: string[] }> };
const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(_req: Request, ctx: Ctx) {
  const segs = (await ctx.params).path ?? [];
  const rel = safeOutputsRel(segs.map((s) => { try { return decodeURIComponent(s); } catch { return '..'; } }).join('/'));
  if (!rel || !rel.startsWith('outputs/templates/') || !/\.(png|jpe?g|webp)$/i.test(rel)) return fail(404, 'not_found', 'File not found.');
  try {
    const { buf, mime } = await engineFor(getSettings()).asset(rel);
    // Tên file template chứa rev → bất biến; outputs/<file> cũng có stamp riêng.
    return new Response(new Uint8Array(buf), {
      headers: { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-length': String(buf.length) },
    });
  } catch (e) {
    if (e instanceof PcError) return e.code === 'not_found' || e.code === 'rejected' ? fail(404, 'not_found', 'File not found.') : fail(502, 'engine_unavailable', 'The pearl studio is not reachable right now.');
    console.error('[personalize] pc proxy', e);
    return fail(500, 'internal_error', 'Something went wrong on our side.');
  }
}
