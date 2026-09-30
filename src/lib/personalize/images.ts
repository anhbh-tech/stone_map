// Xử lý ảnh bằng sharp: chuẩn hoá ảnh upload và các phép đo dùng cho preflight.
import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 6000;

export class ImageError extends Error {}

/**
 * Xoay theo EXIF rồi ghi lại JPEG sRGB không metadata (bỏ GPS, model máy, ngày chụp…) (#10).
 * sharp mặc định không chép metadata sang ảnh ra; `.rotate()` không tham số = xoay theo EXIF Orientation.
 */
export async function normalizeUpload(input: Buffer): Promise<{ buf: Buffer; width: number; height: number }> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try { meta = await sharp(input).metadata(); } catch { throw new ImageError('This file is not an image we can read. Try a JPG, PNG or WebP photo.'); }
  if (!meta.width || !meta.height) throw new ImageError('This file is not an image we can read. Try a JPG, PNG or WebP photo.');
  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer({ resolveWithObject: true });
  return { buf: data, width: info.width, height: info.height };
}

/** Variance of Laplacian (kernel 4-lân cận) trên ảnh xám thu về cạnh dài 512 px. Ảnh mờ → số nhỏ. */
export async function sharpness(input: Buffer): Promise<number> {
  const { data, info } = await sharp(input)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return laplacianVariance(data, info.width, info.height);
}

export function laplacianVariance(px: Uint8Array, w: number, h: number): number {
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = px[i - 1] + px[i + 1] + px[i - w] + px[i + w] - 4 * px[i];
      sum += l; sq += l * l; n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.round((sq / n - mean * mean) * 10) / 10;
}

export type Texture = { entropy: number; edgeDensity: number; box: [number, number, number, number] | null };

/**
 * Đo "có chủ thể hay không" ở độ phân giải thấp (64 px) để không phụ thuộc độ nét:
 * entropy histogram 32 bậc xám + tỉ lệ điểm có gradient mạnh, và khung bao vùng có cạnh.
 * Ảnh phẳng / gradient / màn hình trơn gần như 0 ở cả hai số.
 */
export async function texture(input: Buffer): Promise<Texture> {
  const { data, info } = await sharp(input).resize(64, 64, { fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const hist = new Array<number>(32).fill(0);
  for (const v of data) hist[v >> 3]++;
  let entropy = 0;
  for (const c of hist) if (c) { const q = c / data.length; entropy -= q * Math.log2(q); }
  const xs: number[] = [], ys: number[] = [];
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      n++;
      if (Math.hypot(data[i + 1] - data[i - 1], data[i + w] - data[i - w]) > 24) { xs.push(x); ys.push(y); }
    }
  }
  const edgeDensity = n ? xs.length / n : 0;
  let box: Texture['box'] = null;
  if (xs.length > 20) {
    const q = (a: number[], p: number) => { const s = [...a].sort((m, k) => m - k); return s[Math.floor(p * (s.length - 1))]; };
    const r = (v: number) => Math.round(v * 1000) / 1000;
    box = [r(q(xs, 0.05) / w), r(q(ys, 0.05) / h), r((q(xs, 0.95) + 1) / w), r((q(ys, 0.95) + 1) / h)];
  }
  return { entropy: Math.round(entropy * 100) / 100, edgeDensity: Math.round(edgeDensity * 1000) / 1000, box };
}
