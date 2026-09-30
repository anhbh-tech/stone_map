import fs from 'node:fs/promises';
import path from 'node:path';
import { admin, fail, notFound } from '@/app/admin/_lib/http';
import { getDesignRow } from '@/app/admin/_lib/repo';
import { storageAbs } from '@/app/admin/_lib/storage';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.pdf': 'application/pdf' };

// File in chỉ tải qua đây (cần phiên admin), không bao giờ qua /media.
export const GET = admin<{ id: string }>(async (_req, { id }) => {
  const d = getDesignRow(id) ?? notFound('Design');
  const abs = storageAbs(d.print_path);
  if (!abs) return fail(404, 'no_print_file', 'This design has no print file yet');
  let data: Buffer;
  try { data = await fs.readFile(abs); } catch { return fail(404, 'no_print_file', 'Print file is missing on disk'); }
  const ext = path.extname(abs).toLowerCase();
  const name = `${d.id}${d.print_px ? `-${d.print_px}px` : ''}${ext}`;
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': String(data.length),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
