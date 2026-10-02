// KIT-6: bản đồ đá ⇄ SVG 'pearl-kit-map/1' (docs/KIT-SVG.md). Mỗi viên ghi đúng markup của file mẫu
// *_reference_symbols_only.svg (như toKitSvg của lib/kit/svg.js: <g matrix> + ellipse ngoài data-* + ellipse trong + <text>),
// thêm root theo mm + viewBox px, <title>/<desc> cho người đọc, <metadata> JSON cho máy, layer Inkscape và LEGEND ngoài canvas.
// readKitSvg đọc cả file mới lẫn 3 file mẫu cũ (không metadata, 1 nhóm REFERENCE_MAP).
import { advancePx, ADVANCE } from './glyphs.js';
import { physOf } from './catalog.js';
import { isShaped } from './shapes.js';

export const SCHEMA = 'pearl-kit-map/1';
export const PX_PER_MM = 11.81, INNER = 0.87, BASELINE = 0.36;
// Theo kit/palette.json (3 file mẫu): nhóm cỡ và cỡ chữ ký hiệu của từng cỡ đá.
export const SIZE_GROUP = { 2.2: 'S2.8', 3.2: 'S4', 4.2: 'S5', 5.2: 'S6', 7.2: 'S8' };
export const SIZE_FONT = { 2.2: 25, 3.2: 35, 4.2: 47, 5.2: 60, 7.2: 79 };
const LEGEND_ID = 'LEGEND';

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const f = (v, n) => (Object.is(v, -0) ? '-' : '') + v.toFixed(n);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], unesc(m[2])]));
const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
// Cỡ vẽ (reference) → nhóm theo cỡ VẬT LÝ (data-group K_<mã>_S<vật lý>): bảng mẫu, rồi size_map của catalog (kit/db/kit.sqlite).
export const sizeGroup = (d) => { if (SIZE_GROUP[d]) return SIZE_GROUP[d]; try { return `S${physOf(d)}`; } catch { return `S${d}`; } };
export const fontFor = (d, k = PX_PER_MM) => (SIZE_FONT[d] && k === PX_PER_MM ? SIZE_FONT[d] : Math.round(d * k * 0.96));
// Viền = fill·0.42 (như palette mẫu); chữ trắng trên màu tối, #111111 trên màu sáng.
export const edgeOf = (rgb) => toHex(hex2(rgb).map((v) => v * 0.42));
export const textOf = (rgb) => { const [r, g, b] = hex2(rgb); return 0.299 * r + 0.587 * g + 0.114 * b > 145 ? '#111111' : '#FFFFFF'; };
const advance = (sym, fontPx) => [...sym].reduce((a, ch) => a + (ADVANCE[ch] ? advancePx(ch, fontPx) : Math.round((1139 * fontPx * 64) / 2048) / 64), 0);

// Dạng chuẩn của 1 bản đồ (cái write ghi và read trả lại):
// { schema, canvas: {widthMm, heightMm, pxPerMm, widthPx, heightPx}, params, source, createdAt, stats,
//   palette: [{code, symbol, rgb, dMm, edge, text, fontPx}], bom: [{code, symbol, dMm, count}], layers: [{id, name, count}],
//   stones: [{id, symbol, code, x, y, dMm, rot, group, layer, (shape, wMm, hMm)}] }   (x, y = px bản đồ, tâm viên; xếp theo layer)
//   KIT-14 viên không tròn (tim / marquise / giọt): shape + wMm × hMm (cỡ vẽ reference, trục dài hMm theo rot), dMm = cạnh dài;
//   SVG: ellipse rx = wMm/2, ry = hMm/2 trong matrix xoay rot, data-shape = hình (lib/kit/shapes.js vẽ đúng hình).
export function normalizeDoc(doc) {
  const k = doc.canvas?.pxPerMm ?? PX_PER_MM;
  const widthMm = r6(doc.canvas.widthMm), heightMm = r6(doc.canvas.heightMm ?? doc.canvas.widthMm);
  const canvas = { widthMm, heightMm, pxPerMm: k, widthPx: doc.canvas.widthPx ?? Math.round(widthMm * k), heightPx: doc.canvas.heightPx ?? Math.round(heightMm * k) };
  const defLayer = doc.layers?.[0]?.id || 'STONES';
  const stones = doc.stones.map((s) => ({ id: s.id, symbol: String(s.symbol), code: String(s.code), x: r6(s.x), y: r6(s.y), dMm: r6(s.dMm), rot: r6(s.rot || 0) || 0,
    group: s.group || `K_${s.code}_${sizeGroup(s.dMm)}`, layer: s.layer || defLayer, ...(isShaped(s) && { shape: s.shape, wMm: r6(s.wMm), hMm: r6(s.hMm) }) }));
  const count = new Map();
  for (const s of stones) count.set(s.code, (count.get(s.code) || 0) + 1);
  const pal = new Map((doc.palette || []).map((p) => [String(p.code), p]));
  for (const s of stones) if (!pal.has(s.code)) throw new Error(`palette thiếu mã ${s.code}`);
  const palette = [...pal.values()].filter((p) => count.has(String(p.code))).map((p) => {
    const rgb = p.rgb.toUpperCase();
    return { code: String(p.code), symbol: String(p.symbol), rgb, dMm: r6(p.dMm), edge: (p.edge || edgeOf(rgb)).toUpperCase(), text: (p.text || textOf(rgb)).toUpperCase(), fontPx: p.fontPx ?? fontFor(p.dMm, k) };
  });
  const bom = palette.map((p) => ({ code: p.code, symbol: p.symbol, dMm: p.dMm, count: count.get(p.code) }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, 'en', { numeric: true }));
  const names = new Map((doc.layers || []).map((l) => [l.id, l.name]));
  const lc = new Map();
  for (const s of stones) lc.set(s.layer, (lc.get(s.layer) || 0) + 1);
  const layers = [...new Set([...(doc.layers || []).map((l) => l.id), ...lc.keys()])].filter((id) => lc.has(id))
    .map((id) => ({ id, name: names.get(id) || id, count: lc.get(id) }));
  const li = new Map(layers.map((l, i) => [l.id, i]));
  stones.sort((a, b) => li.get(a.layer) - li.get(b.layer)); // = thứ tự file ghi (theo layer), sort ổn định
  return { schema: SCHEMA, canvas, params: doc.params || {}, source: doc.source || null, createdAt: doc.createdAt || null, stats: doc.stats || {}, palette, bom, layers, stones };
}

// Markup 1 viên = toKitSvg (lib/kit/svg.js) khi pxPerMm = 11.81 — KIT-1 parseKitSvg đọc được.
function stoneSvg(s, p, k) {
  if (isShaped(s)) return shapedSvg(s, p, k);
  const r = s.dMm / 2, t = (s.rot * Math.PI) / 180, a = k * Math.cos(t), b = k * Math.sin(t);
  const sym = esc(s.symbol), tx = s.x - advance(s.symbol, p.fontPx) / 2, ty = s.y + BASELINE * p.fontPx;
  return `<g transform="matrix(${f(a, 9)} ${f(b, 9)} ${f(-b, 9)} ${f(a, 9)} ${f(s.x, 6)} ${f(s.y, 6)})"><ellipse cx="0" cy="0" rx="${f(r, 6)}" ry="${f(r, 6)}" fill="${p.edge}" ` +
    `data-position-id="${esc(s.id)}" data-symbol="${sym}" data-stone-code="${esc(s.code)}" data-shape="round" data-center-x-source-px="${f(s.x, 6)}" data-center-y-source-px="${f(s.y, 6)}" ` +
    `data-width-mm="${f(s.dMm, 6)}" data-height-mm="${f(s.dMm, 6)}" data-rotation-deg="${f(s.rot, 6)}" id="${esc(s.id)}" data-group="${esc(s.group)}" data-reference-width-mm="${s.dMm}" data-reference-height-mm="${s.dMm}"/>` +
    `<ellipse cx="0" cy="0" rx="${f(r * INNER, 6)}" ry="${f(r * INNER, 6)}" fill="${p.rgb}" /></g>\n` +
    `<text x="${f(tx, 4)}" y="${f(ty, 4)}" font-family="Arial" font-weight="700" font-size="${f(p.fontPx, 3)}px" fill="${p.text}" data-position-id="${esc(s.id)}">${sym}</text>`;
}

// viên có hình: cùng cấu trúc (g matrix + ellipse ngoài data-* + ellipse trong + text) để readKitSvg / parseKitSvg đọc được
function shapedSvg(s, p, k) {
  const t = (s.rot * Math.PI) / 180, a = k * Math.cos(t), b = k * Math.sin(t), rx = s.wMm / 2, ry = s.hMm / 2;
  const sym = esc(s.symbol), tx = s.x - advance(s.symbol, p.fontPx) / 2, ty = s.y + BASELINE * p.fontPx;
  return `<g transform="matrix(${f(a, 9)} ${f(b, 9)} ${f(-b, 9)} ${f(a, 9)} ${f(s.x, 6)} ${f(s.y, 6)})"><ellipse cx="0" cy="0" rx="${f(rx, 6)}" ry="${f(ry, 6)}" fill="${p.edge}" ` +
    `data-position-id="${esc(s.id)}" data-symbol="${sym}" data-stone-code="${esc(s.code)}" data-shape="${esc(s.shape)}" data-center-x-source-px="${f(s.x, 6)}" data-center-y-source-px="${f(s.y, 6)}" ` +
    `data-width-mm="${f(s.wMm, 6)}" data-height-mm="${f(s.hMm, 6)}" data-rotation-deg="${f(s.rot, 6)}" id="${esc(s.id)}" data-group="${esc(s.group)}" data-reference-width-mm="${s.wMm}" data-reference-height-mm="${s.hMm}"/>` +
    `<ellipse cx="0" cy="0" rx="${f(rx * INNER, 6)}" ry="${f(ry * INNER, 6)}" fill="${p.rgb}" /></g>\n` +
    `<text x="${f(tx, 4)}" y="${f(ty, 4)}" font-family="Arial" font-weight="700" font-size="${f(p.fontPx, 3)}px" fill="${p.text}" data-position-id="${esc(s.id)}">${sym}</text>`;
}

const sizesLine = (stones) => {
  const m = {};
  for (const s of stones) m[s.dMm] = (m[s.dMm] || 0) + 1;
  return Object.entries(m).sort(([a], [b]) => a - b).map(([d, n]) => `${d}mm×${n}`).join(', ');
};

// Bảng ký hiệu → mã → màu → cỡ → số viên, bên phải canvas (ngoài trang: trình duyệt không vẽ, Inkscape thấy cạnh trang).
function legendSvg(d) {
  const k = d.canvas.pxPerMm, x0 = d.canvas.widthPx + Math.round(10 * k), row = Math.round(8 * k), fs = Math.round(3.4 * k), R = 2.6 * k;
  const rows = d.bom.map((b, i) => {
    const p = d.palette.find((q) => q.code === b.code), y = Math.round((i + 1.5) * row);
    return `<g data-legend-code="${esc(b.code)}"><circle cx="${x0 + R}" cy="${y}" r="${f(R, 3)}" fill="${p.edge}"/><circle cx="${x0 + R}" cy="${y}" r="${f(R * INNER, 3)}" fill="${p.rgb}"/>` +
      `<text x="${x0 + R}" y="${f(y + BASELINE * fs, 2)}" text-anchor="middle" font-family="Arial" font-weight="700" font-size="${fs}px" fill="${p.text}">${esc(b.symbol)}</text>` +
      `<text x="${f(x0 + 2.6 * R, 2)}" y="${f(y + BASELINE * fs, 2)}" font-family="Arial" font-size="${fs}px" fill="#222222">${esc(b.code)}  ${p.rgb}  ${b.dMm}mm  ×${b.count}</text></g>`;
  });
  return `<g id="${LEGEND_ID}" data-layer="${LEGEND_ID}" inkscape:groupmode="layer" inkscape:label="Legend (ngoài canvas)">\n` +
    `<text x="${x0}" y="${Math.round(0.6 * row)}" font-family="Arial" font-weight="700" font-size="${fs}px" fill="#222222">Ký hiệu · mã · màu · cỡ · số viên</text>\n${rows.join('\n')}\n</g>`;
}

export function writeKitSvg(input) {
  const d = normalizeDoc(input), k = d.canvas.pxPerMm, pal = new Map(d.palette.map((p) => [p.code, p]));
  const meta = { schema: d.schema, canvas: d.canvas, params: d.params, palette: d.palette, bom: d.bom, layers: d.layers, source: d.source, createdAt: d.createdAt, stats: d.stats };
  const title = `Pearl kit map ${d.canvas.widthMm}×${d.canvas.heightMm} mm — ${d.stones.length} viên, ${d.palette.length} mã`;
  const desc = [title, `Cỡ đá: ${sizesLine(d.stones)}.`, `Layer: ${d.layers.map((l) => `${l.name} (${l.count})`).join(', ')}.`,
    d.source?.name ? `Nguồn: ${d.source.name}${d.source.sha1 ? ` sha1 ${d.source.sha1}` : ''}.` : '', d.params?.mode ? `Chế độ: ${d.params.mode}.` : '',
    d.createdAt ? `Tạo lúc ${d.createdAt}.` : '', `Schema ${SCHEMA}: xem metadata JSON.`].filter(Boolean).join('\n');
  const groups = d.layers.map((l) => `<g id="${esc(l.id)}" data-layer="${esc(l.id)}" inkscape:groupmode="layer" inkscape:label="${esc(l.name)}">\n` +
    d.stones.filter((s) => s.layer === l.id).map((s) => stoneSvg(s, pal.get(s.code), k)).join('\n') + '\n</g>');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${d.canvas.widthMm}mm" height="${d.canvas.heightMm}mm" viewBox="0 0 ${d.canvas.widthPx} ${d.canvas.heightPx}" data-schema="${SCHEMA}" data-px-per-mm="${k}">\n` +
    `<title>${esc(title)}</title>\n<desc>${esc(desc)}</desc>\n` +
    `<metadata id="pearl-kit-meta" data-schema="${SCHEMA}"><![CDATA[${JSON.stringify(meta).replace(/]]>/g, ']]\\u003e')}]]></metadata>\n` +
    `${groups.join('\n')}\n${legendSvg(d)}\n</svg>\n`;
}

const STONE_RE = /<g transform="matrix\(([^)]*)\)">\s*<ellipse ([^>]*?)\/?>\s*<ellipse ([^>]*?)\/?>\s*<\/g>\s*<text ([^>]*)>([^<]*)<\/text>/g;
const LAYER_RE = /<g\b([^>]*)>/g;

// SVG (mới hoặc file mẫu cũ) → dạng chuẩn. File cũ: palette lấy từ màu từng viên, canvas từ width/height + viewBox.
export function readKitSvg(svg) {
  const root = attrs(svg.match(/<svg\b([^>]*)>/)?.[1] || '');
  const vb = (root.viewBox || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0)) throw new Error('SVG thiếu viewBox');
  const mm = (v) => (/mm$/.test(v || '') ? parseFloat(v) : null);
  const mt = svg.match(/<metadata\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/metadata>/);
  const meta = mt ? JSON.parse(mt[1]) : null;
  if (meta && meta.schema !== SCHEMA) throw new Error(`schema lạ: ${meta.schema}`);
  const widthMm = mm(root.width) ?? meta?.canvas?.widthMm, heightMm = mm(root.height) ?? meta?.canvas?.heightMm;
  if (!widthMm) throw new Error('SVG thiếu width theo mm');
  const k = Number(root['data-px-per-mm']) || r6(vb[2] / widthMm);
  // ranh giới layer: <g data-layer> (file mới) hoặc <g id> không transform (file cũ: REFERENCE_MAP)
  const marks = [];
  for (const m of svg.matchAll(LAYER_RE)) {
    const a = attrs(m[1]);
    if (a['data-layer'] || (!meta && a.id && !a.transform)) marks.push({ at: m.index, id: a['data-layer'] || a.id, name: a['inkscape:label'] || a.id });
  }
  const layerAt = (i) => { let l = null; for (const m of marks) if (m.at < i) l = m; else break; return l; };
  const stones = [], seen = new Map();
  for (const m of svg.matchAll(STONE_RE)) {
    const o = attrs(m[2]), i = attrs(m[3]), t = attrs(m[4]), L = layerAt(m.index);
    if (L?.id === LEGEND_ID) continue;
    const sym = unesc(m[5]);
    if (t['data-position-id'] !== o['data-position-id'] || sym !== o['data-symbol']) throw new Error(`${o.id}: text không khớp viên`);
    const shape = o['data-shape'], wd = +o['data-width-mm'], ht = +o['data-height-mm'] || wd;
    const s = { id: o['data-position-id'], symbol: sym, code: o['data-stone-code'], x: +o['data-center-x-source-px'], y: +o['data-center-y-source-px'],
      dMm: isShaped({ shape }) ? Math.max(wd, ht) : wd, rot: +o['data-rotation-deg'] || 0, group: o['data-group'], layer: L?.id || 'STONES', ...(isShaped({ shape }) && { shape, wMm: wd, hMm: ht }) };
    stones.push(s);
    if (!seen.has(s.code)) seen.set(s.code, { code: s.code, symbol: sym, rgb: i.fill.toUpperCase(), dMm: s.dMm, edge: o.fill.toUpperCase(), text: t.fill.toUpperCase(), fontPx: parseFloat(t['font-size']) });
  }
  const total = (svg.match(/<ellipse [^>]*data-position-id/g) || []).length;
  if (stones.length !== total) throw new Error(`đọc được ${stones.length}/${total} viên`);
  const layers = meta?.layers || marks.filter((m) => m.id !== LEGEND_ID).map((m) => ({ id: m.id, name: m.name }));
  const doc = normalizeDoc({ canvas: meta?.canvas || { widthMm, heightMm, pxPerMm: k, widthPx: vb[2], heightPx: vb[3] }, palette: meta?.palette || [...seen.values()],
    layers, stones, params: meta?.params, source: meta?.source, createdAt: meta?.createdAt, stats: meta?.stats });
  if (meta) {
    const want = JSON.stringify(meta.layers.map((l) => [l.id, l.count])), got = JSON.stringify(doc.layers.map((l) => [l.id, l.count]));
    if (want !== got) throw new Error(`metadata layers ${want} ≠ SVG ${got}`);
  }
  return { ...doc, legacy: !meta };
}
