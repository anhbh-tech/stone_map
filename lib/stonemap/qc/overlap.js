// Chồng viên trên cỡ VẬT LÝ: khe mép-mép < −tol (tol 0.05 mm như lib/kit/catalog.js OVERLAP_TOL) = chồng.
// Xét mọi cặp trong cùng design (khác layer cũng chồng thật: layer chỉ là thứ tự vẽ/sửa).
import { allStones } from '../design.js';
import { edgeGap, neighbours } from '../geom.js';
import { OVERLAP_TOL } from '../../kit/catalog.js';

export default {
  id: 'overlap', level: 'error', title: 'Chồng viên (vật lý)',
  run(d, { cat, overlapTol = OVERLAP_TOL }) {
    const st = allStones(d), maxP = Math.max(0, ...st.map((s) => s.phys_mm));
    const pairs = [];
    for (const [i, j] of neighbours(st, maxP)) {
      const g = edgeGap(st[i], st[j], cat);
      if (g < -overlapTol) pairs.push({ a: st[i].id, b: st[j].id, codes: [st[i].code, st[j].code], phys: [st[i].phys_mm, st[j].phys_mm], depthMm: Math.round(-g * 1e4) / 1e4 });
    }
    pairs.sort((p, q) => q.depthMm - p.depthMm);
    if (!pairs.length) return [{ level: 'pass', msg: `0 cặp chồng > ${overlapTol} mm` }];
    return [{ level: 'error', msg: `${pairs.length} cặp chồng > ${overlapTol} mm, sâu nhất ${pairs[0].depthMm} mm`,
      ids: [...new Set(pairs.flatMap((p) => [p.a, p.b]))], data: { pairs: pairs.slice(0, 50), n: pairs.length, tol: overlapTol } }];
  },
};
