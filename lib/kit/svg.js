// Bản đồ đá (file *_reference_symbols_only.svg của bộ kit) ⇄ JSON chuẩn.
// SVG: viewBox 3543 = 300mm (11.81 px/mm). Mỗi viên = <g transform=matrix(...)> chứa ellipse ngoài (màu viền + data-*)
// và ellipse trong (màu hiển thị), theo sau là <text> ký hiệu. Toạ độ x/y của JSON là px nguồn (tâm viên).
import { advancePx } from './glyphs.js';

export const SIZE_MM = 300, PX = 3543, PX_PER_MM = 11.81;

const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const STONE_RE = /<g transform="matrix\(([^)]*)\)"><ellipse ([^>]*?)\/><ellipse ([^>]*?)\/><\/g>\s*<text ([^>]*)>([^<]*)<\/text>/g;

// → { map: {layer, sizeMm, px, stones:[{id,symbol,code,x,y,dMm,rot,group}]}, look: [{code, edge, fill, text, fontPx, dx, dy}] }
// look = phần hiển thị từng viên (màu, cỡ chữ, vị trí chữ so với tâm) để gộp vào palette; map giữ đúng schema chuẩn.
export function parseKitSvg(svg, layer) {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb || +vb[1] !== PX || +vb[2] !== PX) throw new Error(`viewBox lạ: ${vb?.[0]}`);
  const stones = [], look = [];
  for (const m of svg.matchAll(STONE_RE)) {
    const o = attrs(m[2]), i = attrs(m[3]), t = attrs(m[4]);
    const x = +o['data-center-x-source-px'], y = +o['data-center-y-source-px'];
    const [a, b, , , e, f] = m[1].trim().split(/\s+/).map(Number);
    if (Math.abs(e - x) > 0.01 || Math.abs(f - y) > 0.01) throw new Error(`${o.id}: matrix lệch tâm`);
    if (o['data-shape'] !== 'round' || o['data-width-mm'] !== o['data-height-mm']) throw new Error(`${o.id}: chỉ hỗ trợ đá tròn`);
    if (t['data-position-id'] !== o.id || m[5] !== o['data-symbol']) throw new Error(`${o.id}: text không khớp`);
    const dMm = +o['data-width-mm'], rot = +o['data-rotation-deg'];
    if (Math.abs(Math.hypot(a, b) - PX_PER_MM) > 1e-3 || Math.abs(+o.rx * 2 - dMm) > 1e-4) throw new Error(`${o.id}: tỉ lệ lạ`);
    stones.push({ id: o.id, symbol: o['data-symbol'], code: o['data-stone-code'], x, y, dMm, rot, group: o['data-group'] });
    look.push({ code: o['data-stone-code'], edge: o.fill.toUpperCase(), fill: i.fill.toUpperCase(), text: t.fill.toUpperCase(),
      inner: +i.rx / +o.rx, fontPx: parseFloat(t['font-size']), dx: +t.x - x, dy: +t.y - y });
  }
  const total = (svg.match(/<ellipse [^>]*data-position-id/g) || []).length;
  if (stones.length !== total) throw new Error(`${layer}: đọc được ${stones.length}/${total} viên`);
  return { map: { layer, sizeMm: SIZE_MM, px: PX, stones }, look };
}

// Gộp phần hiển thị của nhiều layer thành palette: code → {symbol, fill, edge, text, dMm, fontPx, group, layers}.
// Một mã luôn có đúng 1 ký hiệu / bộ màu / cỡ; mâu thuẫn giữa các file thì báo lỗi.
// Lưu ý: ký hiệu chỉ duy nhất TRONG một layer (vd W = L38 ở starry nhưng L96 ở king) — xem symbolClash.
export function buildPalette(parsed) {
  const codes = {}, sizes = {};
  for (const { map, look } of parsed) map.stones.forEach((s, i) => {
    const l = look[i], group = s.group.replace(/^K_[^_]+_/, '');
    if (Math.abs(l.inner - 0.87) > 1e-3 || Math.abs(l.dy - 0.36 * l.fontPx) > 0.01) throw new Error(`${map.layer} ${s.id}: hình viên lệch chuẩn`);
    const v = { symbol: s.symbol, fill: l.fill, edge: l.edge, text: l.text, dMm: s.dMm, fontPx: l.fontPx, group };
    const p = codes[s.code] ||= { ...v, layers: {} };
    for (const key of Object.keys(v)) if (p[key] !== v[key]) throw new Error(`mã ${s.code}: ${key} ${p[key]} ≠ ${v[key]} (${map.layer} ${s.id})`);
    p.layers[map.layer] = (p.layers[map.layer] || 0) + 1;
    const z = sizes[s.dMm] ||= { group, fontPx: {} };
    z.fontPx[l.fontPx] = (z.fontPx[l.fontPx] || 0) + 1;
  });
  const bySym = {};
  for (const [code, p] of Object.entries(codes)) (bySym[p.symbol] ||= []).push(code);
  const symbolClash = Object.fromEntries(Object.entries(bySym).filter(([, c]) => c.length > 1));
  const sorted = Object.fromEntries(Object.entries(codes).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  const bySize = Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a - b));
  return { pxPerMm: PX_PER_MM, innerRatio: 0.87, baseline: 0.36, font: 'Arial Bold 700', sizes: bySize, symbolClash, codes: sorted };
}

// JSON chuẩn → SVG cùng cấu trúc file mẫu (đọc lại bằng parseKitSvg ra đúng JSON).
export function toKitSvg(map, palette) {
  const f = (v, n) => (Object.is(v, -0) ? "-" : "") + v.toFixed(n);
  const out = map.stones.map((s) => {
    const p = palette.codes[s.code], r = s.dMm / 2, t = (s.rot * Math.PI) / 180;
    const a = PX_PER_MM * Math.cos(t), b = PX_PER_MM * Math.sin(t);
    const tx = s.x - advancePx(s.symbol, p.fontPx) / 2, ty = s.y + palette.baseline * p.fontPx;
    return `<g transform="matrix(${f(a, 9)} ${f(b, 9)} ${f(-b, 9)} ${f(a, 9)} ${f(s.x, 6)} ${f(s.y, 6)})"><ellipse cx="0" cy="0" rx="${f(r, 6)}" ry="${f(r, 6)}" fill="${p.edge}" ` +
      `data-position-id="${s.id}" data-symbol="${s.symbol}" data-stone-code="${s.code}" data-shape="round" data-center-x-source-px="${f(s.x, 6)}" data-center-y-source-px="${f(s.y, 6)}" ` +
      `data-width-mm="${f(s.dMm, 6)}" data-height-mm="${f(s.dMm, 6)}" data-rotation-deg="${f(s.rot, 6)}" id="${s.id}" data-group="${s.group}" data-reference-width-mm="${s.dMm}" data-reference-height-mm="${s.dMm}"/>` +
      `<ellipse cx="0" cy="0" rx="${f(r * palette.innerRatio, 6)}" ry="${f(r * palette.innerRatio, 6)}" fill="${p.fill}" /></g>\n` +
      `<text x="${f(tx, 4)}" y="${f(ty, 4)}" font-family="Arial" font-weight="700" font-size="${f(p.fontPx, 3)}px" fill="${p.text}" data-position-id="${s.id}">${s.symbol}</text>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${map.sizeMm}mm" height="${map.sizeMm}mm" viewBox="0 0 ${map.px} ${map.px}">\n<g id="REFERENCE_MAP">\n${out.join('\n')}\n</g>\n</svg>\n`;
}
