// Khe mép-mép tới viên gần nhất (vật lý), mục tiêu 0.15–0.2 mm: warn khi có viên sát hơn 0.15 mm (chưa tới mức chồng),
// info = phân bố khe theo bin (viên đứng riêng > 0.5 mm là bình thường ở mép/vùng thưa).
import { allStones } from '../design.js';
import { edgeGap, neighbours } from '../geom.js';
import { OVERLAP_TOL } from '../../kit/catalog.js';

export const BINS = [-Infinity, -OVERLAP_TOL, 0.15, 0.2, 0.5, Infinity];
export const BIN_NAMES = ['chồng (< −0.05)', 'sát (−0.05..0.15)', 'đúng (0.15..0.2)', 'rộng (0.2..0.5)', 'rời (> 0.5)'];

export function nnGaps(d, cat, reach = 1.5) {
  const st = allStones(d), maxP = Math.max(0, ...st.map((s) => s.phys_mm)), nn = new Array(st.length).fill(Infinity);
  for (const [i, j] of neighbours(st, maxP + reach)) {
    const g = edgeGap(st[i], st[j], cat);
    if (g < nn[i]) nn[i] = g;
    if (g < nn[j]) nn[j] = g;
  }
  return { st, nn };
}

export default {
  id: 'gap', level: 'warn', title: 'Khe 0.15–0.2 mm',
  run(d, { cat, gapMin = 0.15, gapMax = 0.2 }) {
    const { st, nn } = nnGaps(d, cat), hist = BIN_NAMES.map(() => 0);
    for (const g of nn) hist[BINS.findIndex((b, k) => g >= b && (g < BINS[k + 1] || k === BINS.length - 2))]++;
    const fin = nn.filter(Number.isFinite).sort((a, b) => a - b), q = (p) => Math.round(fin[Math.floor(p * (fin.length - 1))] * 1e4) / 1e4;
    const dist = Object.fromEntries(BIN_NAMES.map((n, k) => [n, hist[k]]));
    const out = [{ level: 'info', msg: `phân bố khe (n=${st.length}): ${BIN_NAMES.map((n, k) => `${n} ${hist[k]}`).join(', ')}; trung vị ${q(0.5)} mm`,
      data: { hist: dist, p10: q(0.1), p50: q(0.5), p90: q(0.9) } }];
    const tight = st.filter((s, k) => nn[k] >= -OVERLAP_TOL && nn[k] < gapMin);
    if (tight.length) out.push({ level: 'warn', msg: `${tight.length} viên có khe < ${gapMin} mm (nhưng chưa chồng)`, ids: tight.map((s) => s.id) });
    else out.push({ level: 'pass', msg: `không viên nào khe < ${gapMin} mm` });
    if (gapMax) out[0].data.target = [gapMin, gapMax];
    return out;
  },
};
