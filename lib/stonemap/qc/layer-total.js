// Tổng các layer = tổng sản phẩm: viên đúng layer chứa nó, Σ layer theo mã = BOM (design.expected) nếu có.
import { counts } from '../design.js';

export default {
  id: 'layer-total', level: 'error', title: 'Tổng layer = tổng sản phẩm',
  run(d) {
    const c = counts(d), out = [];
    const wrong = d.layers.flatMap((l) => l.stones.filter((s) => s.layer !== l.id).map((s) => s.id));
    if (wrong.length) out.push({ level: 'error', msg: `${wrong.length} viên ghi layer khác layer chứa nó`, ids: wrong });
    const per = d.layers.map((l) => `${l.id} ${c.byLayer[l.id].total}`).join(' + ');
    if (!d.expected) return [...out, { level: 'info', msg: `${per} = ${c.total}; không có BOM để so` }];
    if (c.total !== d.expected.total) out.push({ level: 'error', msg: `${per} = ${c.total} ≠ sản phẩm ${d.expected.total}` });
    const codes = new Set([...Object.keys(c.byCode), ...Object.keys(d.expected.byCode || {})]);
    for (const k of codes) {
      const a = c.byCode[k] || 0, b = d.expected.byCode?.[k] || 0;
      if (a !== b) out.push({ level: 'error', msg: `mã ${k}: layer ${a} ≠ BOM ${b}` });
    }
    if (!out.length) out.push({ level: 'pass', msg: `${per} = ${c.total} = BOM, ${codes.size} mã khớp` });
    return out;
  },
};
