// GET /media/<uploads|previews|mockups>/<file> — phục vụ ảnh trong storage/. File in, ảnh AI gốc và DB không bao giờ ra đây.
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveMedia } from '../../../lib/personalize/storage';

type Ctx = { params: Promise<{ path: string[] }> };
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const notFound = () => Response.json({ error: { code: 'not_found', message: 'File not found.' } }, { status: 404 });

export async function GET(_req: Request, ctx: Ctx) {
  const segs = (await ctx.params).path ?? [];
  const file = resolveMedia(segs.map((s) => { try { return decodeURIComponent(s); } catch { return ''; } }));
  if (!file) return notFound();
  let buf: Buffer;
  try { buf = await fs.readFile(file); } catch { return notFound(); }
  // preview/mockup có tên theo job (đổi khi gen lại) → cache lâu được; ảnh gốc của khách: riêng tư, không cache chung.
  const cache = segs[0] === 'uploads' ? 'private, max-age=3600' : 'public, max-age=31536000, immutable';
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
      'content-length': String(buf.length),
    },
  });
}
