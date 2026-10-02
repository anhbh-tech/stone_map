// Vùng có lỗ trống (stub): ctx.mask = { w, h, data } (1 px = canvas/w mm, data[i] > 0 = vùng phải phủ đá).
// Lấy mẫu mask mỗi stepMm (bỏ dải minStoneMm/2 sát mép canvas: viên không đặt ra ngoài được);
// điểm trong mask cách mép viên gần nhất > minStoneMm/2 + gap = lỗ (đặt vừa 1 viên nhỏ nhất).
import { allStones } from '../design.js';
import { neighbours } from '../geom.js';

export default {
  id: 'holes', level: 'warn', title: 'Lỗ trống trong vùng đá',
  run(d, { mask, stepMm = 1, minStoneMm = 2.8, gapMm = 0.15 }) {
    if (!mask) return [{ level: 'info', msg: 'bỏ qua: chưa có mask vùng đá (ctx.mask)' }];
    const st = allStones(d), sx = d.canvas.w_mm / mask.w, sy = d.canvas.h_mm / mask.h, need = minStoneMm / 2 + gapMm;
    const probes = [];
    const e = minStoneMm / 2;
    for (let y = stepMm / 2; y < d.canvas.h_mm; y += stepMm) for (let x = stepMm / 2; x < d.canvas.w_mm; x += stepMm) {
      if (x < e || y < e || x > d.canvas.w_mm - e || y > d.canvas.h_mm - e) continue;
      if (mask.data[Math.min(mask.h - 1, Math.floor(y / sy)) * mask.w + Math.min(mask.w - 1, Math.floor(x / sx))] > 0) probes.push({ id: `probe`, x_mm: x, y_mm: y, phys_mm: 0, probe: true });
    }
    const maxP = Math.max(0, ...st.map((s) => s.phys_mm)), all = [...st, ...probes], free = new Array(all.length).fill(Infinity);
    for (const [i, j] of neighbours(all, maxP / 2 + need)) {
      const [p, s] = all[i].probe ? [i, j] : [j, i];
      if (!all[p].probe || all[s].probe) continue;
      free[p] = Math.min(free[p], Math.hypot(all[p].x_mm - all[s].x_mm, all[p].y_mm - all[s].y_mm) - all[s].phys_mm / 2);
    }
    const holes = all.map((p, k) => (p.probe && free[k] > need ? [Math.round(p.x_mm * 10) / 10, Math.round(p.y_mm * 10) / 10] : null)).filter(Boolean);
    if (!holes.length) return [{ level: 'pass', msg: `${probes.length} điểm mask (bước ${stepMm} mm) đều phủ` }];
    return [{ level: 'warn', msg: `${holes.length}/${probes.length} điểm mask còn trống đủ đặt 1 viên ${minStoneMm} mm`, data: { holes: holes.slice(0, 2000), n: holes.length } }];
  },
};
