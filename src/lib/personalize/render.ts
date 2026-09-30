// Render ảnh ra: preview web, mockup treo tường, file in PNG theo designs.transform.
import sharp from 'sharp';
import { z } from 'zod';

/**
 * designs.transform — cùng nghĩa với CSS `translate(x·100%, y·100%) rotate(rotate deg) scale(zoom)` áp lên ảnh AI
 * đã "cover" khung vuông:
 *   rotate  độ, chiều kim đồng hồ (−180…180)
 *   zoom    ≥ 1; 1 = cạnh ngắn của ảnh vừa khít khung
 *   x, y    dịch tâm ảnh theo tỉ lệ cạnh khung (−0.5…0.5); dương = sang phải / xuống dưới
 */
export const TransformSchema = z.object({
  rotate: z.number().min(-180).max(180).default(0),
  zoom: z.number().min(1).max(4).default(1),
  x: z.number().min(-0.5).max(0.5).default(0),
  y: z.number().min(-0.5).max(0.5).default(0),
});
export type Transform = z.infer<typeof TransformSchema>;
export const IDENTITY: Transform = { rotate: 0, zoom: 1, x: 0, y: 0 };

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** Cắt khung vuông `size` px từ ảnh nguồn theo transform. Làm việc ở độ phân giải nguồn rồi mới resize → bộ nhớ không phụ thuộc zoom. */
export async function applyTransform(src: Buffer, t: Transform, size: number): Promise<ReturnType<typeof sharp>> {
  const meta = await sharp(src).metadata();
  const w = meta.autoOrient?.width ?? meta.width ?? size, h = meta.autoOrient?.height ?? meta.height ?? size;
  const win = Math.max(1, Math.min(w, h) / t.zoom);                       // cạnh khung, tính bằng px nguồn
  const rotated = await sharp(src).rotate(t.rotate, { background: WHITE }).toBuffer({ resolveWithObject: true });
  const rw = rotated.info.width, rh = rotated.info.height;
  const pad = Math.ceil(win) + 2;
  const cx = rw / 2 - t.x * win, cy = rh / 2 - t.y * win;
  const left = Math.round(cx - win / 2) + pad, top = Math.round(cy - win / 2) + pad;
  const side = Math.round(win);
  const padded = await sharp(rotated.data)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: WHITE })
    .toBuffer();
  return sharp(padded)
    .extract({ left: Math.max(0, left), top: Math.max(0, top), width: side, height: side })
    .resize(size, size, { kernel: 'lanczos3' });
}

/** Ảnh preview web: cạnh 1200, webp. */
export const renderPreview = (src: Buffer) =>
  sharp(src).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();

/** Mockup treo tường 1200×900: tường sơn, bóng đổ, khung gỗ vàng, ảnh ở giữa. */
export async function renderMockup(src: Buffer, t: Transform = IDENTITY): Promise<Buffer> {
  const W = 1200, H = 900, art = 440, frame = 36, mat = 28;
  const outer = art + 2 * (frame + mat);
  const x0 = Math.round((W - outer) / 2), y0 = 130;
  const wall = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ebe3d6"/><stop offset="1" stop-color="#d9cfbf"/></linearGradient>
    <radialGradient id="light" cx="0.5" cy="0.25" r="0.7"><stop offset="0" stop-color="#fffaf0" stop-opacity="0.55"/><stop offset="1" stop-color="#fffaf0" stop-opacity="0"/></radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9b86a"/><stop offset="0.5" stop-color="#a8842f"/><stop offset="1" stop-color="#e3c77f"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#3b2f1f" flood-opacity="0.35"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wall)"/>
  <rect width="${W}" height="${H}" fill="url(#light)"/>
  <rect x="0" y="${H - 150}" width="${W}" height="150" fill="#b89a74"/>
  <rect x="0" y="${H - 156}" width="${W}" height="10" fill="#f4efe6"/>
  <g filter="url(#shadow)"><rect x="${x0}" y="${y0}" width="${outer}" height="${outer}" fill="url(#gold)"/></g>
  <rect x="${x0 + frame}" y="${y0 + frame}" width="${outer - 2 * frame}" height="${outer - 2 * frame}" fill="#f7f3ea"/>
  <rect x="${x0 + frame - 4}" y="${y0 + frame - 4}" width="${outer - 2 * frame + 8}" height="${outer - 2 * frame + 8}" fill="none" stroke="#7d6123" stroke-width="3"/>
</svg>`);
  const artBuf = await (await applyTransform(src, t, art)).png().toBuffer();
  return sharp(wall)
    .composite([{ input: artBuf, left: x0 + frame + mat, top: y0 + frame + mat }])
    .webp({ quality: 84 })
    .toBuffer();
}

/** File in: PNG vuông print_px², sRGB, 300 dpi, theo transform khách đã chọn. */
export async function renderPrint(src: Buffer, t: Transform, printPx: number): Promise<Buffer> {
  return (await applyTransform(src, t, printPx))
    .toColorspace('srgb')
    .withIccProfile('srgb')
    .withDensity(300)
    .png({ compressionLevel: 6 })
    .toBuffer();
}
