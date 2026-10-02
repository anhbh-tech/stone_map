// ΔE00 mockup vs preview (stub): ctx.mockup / ctx.preview = { width, height, data RGBA } cùng cỡ (ảnh mockup sản phẩm vs render design).
// Trung bình ΔE00 trên lưới mẫu (bỏ px alpha < 128 ở một trong hai), warn khi > maxDe.
import { rgbToLab, de2000 } from '../../kit/place.js';

export default {
  id: 'delta-e', level: 'warn', title: 'ΔE mockup vs preview',
  run(d, { mockup, preview, maxDe = 10, step = 2 }) {
    if (!mockup || !preview) return [{ level: 'info', msg: 'bỏ qua: cần ctx.mockup và ctx.preview' }];
    if (mockup.width !== preview.width || mockup.height !== preview.height) return [{ level: 'error', msg: `ảnh lệch cỡ ${mockup.width}×${mockup.height} vs ${preview.width}×${preview.height}` }];
    let sum = 0, n = 0, max = 0;
    for (let y = 0; y < mockup.height; y += step) for (let x = 0; x < mockup.width; x += step) {
      const i = (y * mockup.width + x) * 4, A = mockup.data, B = preview.data;
      if (A[i + 3] < 128 || B[i + 3] < 128) continue;
      const e = de2000(rgbToLab(A[i], A[i + 1], A[i + 2]), rgbToLab(B[i], B[i + 1], B[i + 2]));
      sum += e; n++; if (e > max) max = e;
    }
    if (!n) return [{ level: 'warn', msg: 'không có px chung (alpha)' }];
    const mean = Math.round((sum / n) * 100) / 100;
    return [{ level: mean > maxDe ? 'warn' : 'pass', msg: `ΔE00 trung bình ${mean} (ngưỡng ${maxDe}), max ${Math.round(max * 10) / 10}, ${n} px`, data: { mean, max, n } }];
  },
};
