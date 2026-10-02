// Quy tắc ký hiệu (rules: per design): đá = 1 chữ hoa trong STONE_LETTERS, ngọc trai = số = cỡ mm, không trùng, mã nào cũng có.
import { counts } from '../design.js';
import { STONE_LETTERS, pearlSymbol } from '../catalog.js';

export default {
  id: 'symbols', level: 'error', title: 'Quy tắc ký hiệu',
  run(d, { cat }) {
    const out = [], used = new Map();
    for (const code of Object.keys(counts(d).byCode)) {
      const sym = d.symbols?.[code], e = cat.codes[code];
      if (!sym) { out.push({ level: 'error', msg: `mã ${code} chưa có ký hiệu` }); continue; }
      if (used.has(sym)) out.push({ level: 'error', msg: `ký hiệu ${sym} trùng: ${used.get(sym)} và ${code}` });
      used.set(sym, code);
      if (!e) continue;
      if (e.kind === 'pearl') { if (sym !== pearlSymbol(e)) out.push({ level: 'error', msg: `ngọc trai ${code} (${e.physMm} mm) phải là '${pearlSymbol(e)}', đang '${sym}'` }); }
      else if (!/^[A-Z]$/.test(sym)) out.push({ level: 'error', msg: `đá ${code} phải là 1 chữ hoa, đang '${sym}'` });
      else if (!STONE_LETTERS.includes(sym)) out.push({ level: 'warn', msg: `đá ${code} dùng '${sym}' ngoài bộ ${STONE_LETTERS} (chữ đầu series / dễ nhầm)` });
    }
    if (!out.length) out.push({ level: 'pass', msg: `${used.size} ký hiệu đúng luật` });
    return out;
  },
};
