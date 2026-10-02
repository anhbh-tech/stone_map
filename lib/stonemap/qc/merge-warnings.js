// Gộp mã lệch màu: design.merges = [{ from, to, de00, n, layer? }] (compose share / giới hạn số mã ghi vào).
// ΔE00 > maxMergeDe (20, map_generator RUN.md merge_warnings) = warn, cần người xem lại; còn lại = info.
export default {
  id: 'merge-warnings', level: 'warn', title: 'Gộp mã lệch màu ΔE > 20',
  run(d, { maxMergeDe = 20 }) {
    const m = d.merges || [];
    if (!m.length) return [{ level: 'pass', msg: 'không gộp mã nào' }];
    const bad = m.filter((x) => x.de00 > maxMergeDe), ok = m.filter((x) => !(x.de00 > maxMergeDe));
    const fmt = (x) => `${x.from}→${x.to} ΔE ${x.de00} (${x.n} viên${x.layer ? ` ${x.layer}` : ''})`;
    const out = bad.map((x) => ({ level: 'warn', msg: `gộp ${fmt(x)} > ${maxMergeDe}`, data: x }));
    if (ok.length) out.push({ level: 'info', msg: `${ok.length} lần gộp ≤ ΔE ${maxMergeDe}: ${ok.map(fmt).join(', ')}`, data: { merges: ok } });
    return out;
  },
};
