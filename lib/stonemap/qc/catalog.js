// Mã có trong catalog (đúng version), shape và cỡ vật lý / cỡ vẽ khớp catalog + size_map.
import { allStones } from '../design.js';
import { refOf } from '../catalog.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;

export default {
  id: 'catalog', level: 'error', title: 'Mã có trong catalog',
  run(d, { cat }) {
    const out = [];
    if (d.catalogVersion !== cat.version) out.push({ level: 'warn', msg: `design ghim ${d.catalogVersion}, catalog hiện tại ${cat.version}` });
    const by = new Map();
    const add = (key, level, msg, id) => { if (!by.has(key)) by.set(key, { level, msg, ids: [] }); by.get(key).ids.push(id); };
    for (const s of allStones(d)) {
      const e = cat.codes[s.code];
      if (!e) { add(`miss:${s.code}`, 'error', `mã ${s.code} không có trong catalog`, s.id); continue; }
      if (!e.active) add(`inactive:${s.code}`, 'warn', `mã ${s.code} đã ngừng`, s.id);
      if (e.shape !== s.shape) add(`shape:${s.code}:${s.shape}`, 'error', `${s.code} là ${e.shape}, design ghi ${s.shape}`, s.id);
      if (!near(e.physMm, s.phys_mm)) add(`phys:${s.code}:${s.phys_mm}`, 'error', `${s.code} cỡ vật lý ${e.physMm} mm, design ghi ${s.phys_mm}`, s.id);
      const ref = e.shape === 'round' ? refOf(s.phys_mm, cat) : e.refMm * (s.phys_mm / e.physMm);
      if (!near(ref, s.ref_mm)) add(`ref:${s.code}:${s.ref_mm}`, 'warn', `${s.code} cỡ vẽ phải ${ref} mm, design ghi ${s.ref_mm}`, s.id);
    }
    for (const f of by.values()) out.push({ ...f, msg: `${f.msg} (${f.ids.length} viên)` });
    if (!out.length) out.push({ level: 'pass', msg: `${new Set(allStones(d).map((s) => s.code)).size} mã đều có trong ${cat.version}` });
    return out;
  },
};
