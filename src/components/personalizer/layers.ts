// Hình học của editor theo lớp (v2, pearl_compare docs/OUTPUT.md). Port đúng các hàm editor của pearl_compare
// public/layers.js để editor ở đây vẽ và chuẩn hoá transform giống hệt server render final (POST /api/render).
// Toạ độ = điểm ảnh template; transform { x, y } = tâm pet, scale = px template / px cutout, rotate = độ, chiều kim đồng hồ.
import type { PetTransform, Pt } from './api';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const len = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Hình chữ nhật trong của quad (tl, tr, br, bl): [x0, y0, x1, y1]. Tâm pet được kẹp trong vùng này. */
export function innerRect(quad: Pt[]): [number, number, number, number] {
  const [tl, tr, br, bl] = quad;
  return [Math.max(tl[0], bl[0]), Math.max(tl[1], tr[1]), Math.min(tr[0], br[0]), Math.min(bl[1], br[1])];
}

/** Giống normTransform của server: kẹp tâm vào innerRect, scale vào [0.01, 20], rotate về (-180, 180], làm tròn 3 số. */
export function normTransform(t: Partial<PetTransform> | null | undefined, quad: Pt[]): PetTransform {
  const [x0, y0, x1, y1] = innerRect(quad);
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  let rot = num(t?.rotate, 0) % 360;
  if (rot > 180) rot -= 360;
  if (rot <= -180) rot += 360;
  return {
    x: r3(Math.min(x1, Math.max(x0, num(t?.x, (x0 + x1) / 2)))),
    y: r3(Math.min(y1, Math.max(y0, num(t?.y, (y0 + y1) / 2)))),
    scale: r3(Math.min(20, Math.max(0.01, num(t?.scale, 1)))),
    rotate: r3(rot),
  };
}

/** 4 góc của pet đã transform (tl, tr, br, bl): khung chọn của editor. */
export function corners(t: PetTransform, pw: number, ph: number): Pt[] {
  const a = (t.rotate * Math.PI) / 180, c = Math.cos(a) * t.scale, s = Math.sin(a) * t.scale;
  return ([[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]] as Pt[]).map(([u, v]) => [t.x + c * u - s * v, t.y + s * u + c * v]);
}

/** Toạ độ template → toạ độ trong PNG pet (0..pw, 0..ph): con trỏ có nằm trên pet không. */
export function toPet(t: PetTransform, pw: number, ph: number, x: number, y: number): Pt {
  const a = (t.rotate * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = x - t.x, dy = y - t.y;
  return [(c * dx + s * dy) / t.scale + pw / 2, (-s * dx + c * dy) / t.scale + ph / 2];
}

const ang = (c: Pt, p: Pt) => Math.atan2(p[1] - c[1], p[0] - c[0]);
/** Kéo núm góc từ p0 tới p1: đổi cỡ theo khoảng cách tới tâm. */
export const dragScale = (t0: PetTransform, p0: Pt, p1: Pt): PetTransform =>
  ({ ...t0, scale: r3(t0.scale * (len([t0.x, t0.y], p1) / (len([t0.x, t0.y], p0) || 1))) });
/** Kéo núm xoay từ p0 tới p1: xoay theo góc quanh tâm. */
export const dragRotate = (t0: PetTransform, p0: Pt, p1: Pt): PetTransform =>
  ({ ...t0, rotate: r3(t0.rotate + ((ang([t0.x, t0.y], p1) - ang([t0.x, t0.y], p0)) * 180) / Math.PI) });

/** Nền canvas: phủ kín hình chữ nhật bao clip (+2 px), giữ tỉ lệ, căn giữa, không xoay. */
export function canvasBgTransform(clip: Pt[], bw: number, bh: number): PetTransform {
  const xs = clip.map((q) => q[0]), ys = clip.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale: Math.max((x1 - x0 + 2) / bw, (y1 - y0 + 2) / bh), rotate: 0 };
}

/** Núm xoay: đoạn thẳng từ giữa cạnh trên ra ngoài `d` (px template), theo góc xoay của pet. */
export function rotateHandle(t: PetTransform, pw: number, ph: number, d: number): { mid: Pt; at: Pt } {
  const c = corners(t, pw, ph), mid: Pt = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
  const a = (t.rotate * Math.PI) / 180;
  return { mid, at: [mid[0] + Math.sin(a) * d, mid[1] - Math.cos(a) * d] };
}

export type Hit = 'rotate' | 'scale' | 'move' | null;
/** Con trỏ p (px template) trúng gì: núm xoay, một trong 4 góc, thân pet, hay không gì. r = bán kính bắt núm (px template). */
export function hitTest(t: PetTransform, pw: number, ph: number, p: Pt, r: number, rotD: number): Hit {
  if (len(p, rotateHandle(t, pw, ph, rotD).at) <= r) return 'rotate';
  if (corners(t, pw, ph).some((c) => len(p, c) <= r)) return 'scale';
  const [u, v] = toPet(t, pw, ph, p[0], p[1]);
  return u >= 0 && v >= 0 && u <= pw && v <= ph ? 'move' : null;
}
