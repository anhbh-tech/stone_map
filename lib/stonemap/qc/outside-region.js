// Viên nằm ngoài vùng đính đá = error (map_generator RUN.md V7).
//   ctx.region = { w, h, data } (1 byte / px phủ cả canvas, > 0 = vùng đính đá) → tâm viên phải trong vùng;
//   ctx.layerRegions = { layerId: mask cùng dạng } → tâm viên phải trong vùng của layer nó (vd bg ở nền, pet ở ô mặt);
//   luôn kiểm: thân viên (cỡ vật lý, đường viền thật với đá không tròn) không vượt mép canvas quá tol 0.05 mm.
import { allStones } from '../design.js';
import { outline } from '../geom.js';

const inMask = (m, d, x, y) => m.data[Math.min(m.h - 1, Math.max(0, Math.floor((y / d.canvas.h_mm) * m.h))) * m.w + Math.min(m.w - 1, Math.max(0, Math.floor((x / d.canvas.w_mm) * m.w)))] > 0;

export default {
  id: 'outside-region', level: 'error', title: 'Viên ngoài vùng đính đá',
  run(d, { cat, region, layerRegions, edgeTol = 0.05 }) {
    const out = [], st = allStones(d);
    const off = ([x, y], r = 0) => x - r < -edgeTol || y - r < -edgeTol || x + r > d.canvas.w_mm + edgeTol || y + r > d.canvas.h_mm + edgeTol;
    const edge = st.filter((s) => (s.shape === 'round' ? off([s.x_mm, s.y_mm], s.phys_mm / 2) : outline(s, cat).some((p) => off(p))));
    if (edge.length) out.push({ level: 'error', msg: `${edge.length} viên lố mép canvas > ${edgeTol} mm`, ids: edge.map((s) => s.id) });
    if (region) {
      const bad = st.filter((s) => !inMask(region, d, s.x_mm, s.y_mm));
      out.push(bad.length ? { level: 'error', msg: `${bad.length} viên có tâm ngoài vùng đính đá`, ids: bad.map((s) => s.id) } : { level: 'pass', msg: `${st.length} viên trong vùng đính đá` });
    }
    for (const [lid, m] of Object.entries(layerRegions || {})) {
      const ls = d.layers.find((l) => l.id === lid)?.stones || [], bad = ls.filter((s) => !inMask(m, d, s.x_mm, s.y_mm));
      if (bad.length) out.push({ level: 'error', msg: `layer ${lid}: ${bad.length}/${ls.length} viên có tâm ngoài vùng của layer (locked ${bad.filter((s) => s.locked).length})`, ids: bad.map((s) => s.id) });
      else out.push({ level: 'pass', msg: `layer ${lid}: ${ls.length} viên trong vùng` });
    }
    if (!region && !layerRegions) out.push({ level: 'info', msg: 'chưa có mask vùng (ctx.region / ctx.layerRegions): chỉ kiểm mép canvas' });
    if (!edge.length && !out.some((f) => f.level !== 'info')) out.push({ level: 'pass', msg: 'không viên nào lố mép canvas' });
    return out;
  },
};
