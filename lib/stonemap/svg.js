// STONEMAP SVG sửa được ⇄ design.json (đơn vị viewBox = mm).
//   writeSvg(design, { cat, symbols = true }) → string
//     <desc id="stonemap"> = header JSON (format, id, canvas, catalogVersion, symbols, expected, merges, meta)
//     mỗi layer 1 <g id="layer-<id>" data-layer>, mỗi viên 1 <g data-id data-code data-layer data-phys data-ref data-shape data-locked data-source
//       transform="translate(x y) rotate(r)"> chứa hình ở cỡ REF tâm gốc toạ độ (trục dài dọc khi r = 0, mũi tim / giọt xuống dưới như lib/kit/shapes.js) + <text> ký hiệu đứng thẳng.
//   readSvg(text) → design: data-* là nguồn cho mã/cỡ/layer, transform (cả chuỗi translate/rotate/matrix, cộng transform của layer)
//     là nguồn cho vị trí/góc ⇒ kéo/xoay viên trong Inkscape rồi nhập lại vẫn đúng.
import { FORMAT } from './design.js';
import { outline as kitOutline, SHAPED as KIT_SHAPED } from '../kit/shapes.js';

export const SVG_FORMAT = 'stonemap-svg/1';
const ASPECT = { round: 1, marquise: 0.5, teardrop: 0.5, heart: 1, star: 1, flower: 1, rose: 1 };
const f = (v) => String(Math.round(v * 1e6) / 1e6);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Kích thước vẽ (w × h, h = trục dài) của 1 viên: tỉ lệ theo catalog nếu có, không thì theo ASPECT của shape.
export function refBox(s, cat) {
  const e = cat?.codes?.[s.code];
  const a = e && e.shape === s.shape && e.refH > 0 ? Math.min(e.refW, e.refH) / Math.max(e.refW, e.refH) : ASPECT[s.shape] ?? 1;
  return { w: s.ref_mm * a, h: s.ref_mm };
}

export function shapeSvg(shape, w, h, attrs) {
  const W = w / 2, H = h / 2;
  if (shape === 'round' || !ASPECT[shape]) return `<circle r="${f(W)}" ${attrs}/>`;
  if (shape === 'rose') return `<circle r="${f(W)}" ${attrs}/><circle r="${f(W * 0.45)}" fill="none" stroke="#0004" stroke-width="${f(W * 0.08)}"/>`;
  const P = (pts) => `<path d="M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} Z" ${attrs}/>`;
  if (KIT_SHAPED.includes(shape)) return P(kitOutline(shape, w, h, 48)); // cùng đường viền với lib/kit/shapes.js (mũi tim / giọt hướng +y)
  const n = shape === 'star' ? 10 : 40;
  return P(Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI - Math.PI / 2, r = shape === 'star' ? (i % 2 ? 0.4 : 1) : 0.72 + 0.28 * Math.cos(5 * (t + Math.PI / 2));
    return [Math.cos(t) * r * W, Math.sin(t) * r * H];
  }));
}

export function writeSvg(d, { cat = null, symbols = true } = {}) {
  const { w_mm: W, h_mm: H } = d.canvas;
  const head = { format: d.format, id: d.id, canvas: d.canvas, catalogVersion: d.catalogVersion, symbols: d.symbols, expected: d.expected, merges: d.merges, meta: d.meta };
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" data-format="${SVG_FORMAT}" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W)}mm" height="${f(H)}mm">`,
    `<desc id="stonemap">${esc(JSON.stringify(head))}</desc>`,
  ];
  for (const l of d.layers) {
    out.push(`<g id="layer-${esc(l.id)}" data-layer="${esc(l.id)}">`);
    for (const s of l.stones) {
      const { w, h } = refBox(s, cat), fill = cat?.codes?.[s.code]?.fill || '#BBBBBB', sym = d.symbols?.[s.code] ?? '';
      const fs = Math.min(w, h) * (sym.length > 1 ? 0.5 : 0.65);
      out.push(`<g id="s-${esc(s.id)}" data-id="${esc(s.id)}" data-code="${esc(s.code)}" data-layer="${esc(s.layer)}" data-shape="${esc(s.shape)}" data-phys="${f(s.phys_mm)}" data-ref="${f(s.ref_mm)}" data-locked="${s.locked}" data-source="${esc(s.source ?? '')}" transform="translate(${f(s.x_mm)} ${f(s.y_mm)}) rotate(${f(s.rot_deg)})">`
        + shapeSvg(s.shape, w, h, `fill="${fill}" stroke="#333" stroke-width="${f(Math.max(0.04, s.ref_mm * 0.03))}"`)
        + (symbols && sym ? `<text transform="rotate(${f(-s.rot_deg)})" font-size="${f(fs)}" text-anchor="middle" dominant-baseline="central" font-family="Arial" fill="#000">${esc(sym)}</text>` : '')
        + '</g>');
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], unesc(m[2])]));
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const I = [1, 0, 0, 1, 0, 0];

export function parseTransform(t) {
  let m = I;
  for (const [, fn, args] of String(t || '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let n = I;
    if (fn === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (fn === 'scale') n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (fn === 'matrix') n = a.slice(0, 6);
    else if (fn === 'rotate') {
      const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), [cx = 0, cy = 0] = a.slice(1);
      n = mul(mul([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else throw new Error(`transform ${fn} chưa hỗ trợ`);
    m = mul(m, n);
  }
  return m;
}

// translate(x y) rotate(r) đúng dạng do writeSvg ghi → lấy số nguyên văn (round-trip tuyệt đối); dạng khác → qua ma trận.
function placeOf(t, parent) {
  const m = /^\s*translate\(\s*([-\d.e+]+)[\s,]+([-\d.e+]+)\s*\)(?:\s*rotate\(\s*([-\d.e+]+)\s*\))?\s*$/.exec(t || '');
  if (m && parent === I) return { x: Number(m[1]), y: Number(m[2]), r: Number(m[3] || 0) };
  const M = mul(parent, parseTransform(t)), r6 = (v) => Math.round(v * 1e6) / 1e6;
  return { x: r6(M[4]), y: r6(M[5]), r: r6((Math.atan2(M[1], M[0]) * 180) / Math.PI) };
}

export function readSvg(text) {
  const desc = /<desc[^>]*id="stonemap"[^>]*>([\s\S]*?)<\/desc>/.exec(text);
  const head = desc ? JSON.parse(unesc(desc[1])) : {};
  let canvas = head.canvas;
  if (!canvas) {
    const vb = /viewBox="([^"]+)"/.exec(text)?.[1].trim().split(/[\s,]+/).map(Number);
    if (!vb) throw new Error('SVG không có viewBox lẫn header stonemap');
    canvas = { w_mm: vb[2], h_mm: vb[3] };
  }
  const d = { format: FORMAT, id: head.id ?? 'svg', canvas, catalogVersion: head.catalogVersion ?? null, layers: [], symbols: head.symbols ?? {} };
  if (head.expected) d.expected = head.expected;
  if (head.merges) d.merges = head.merges;
  if (head.meta) d.meta = head.meta;
  // Duyệt thẻ <g ...> / </g> theo thứ tự để biết viên nằm trong layer nào và cộng transform của layer.
  const stack = [];
  let layer = null;
  for (const m of text.matchAll(/<g\b([^>]*?)(\/?)>|<\/g>/g)) {
    if (m[0] === '</g>') { const top = stack.pop(); if (top?.layer) layer = null; continue; }
    const a = attrsOf(m[1]), selfClose = m[2] === '/';
    if (a['data-id'] != null) {
      if (!layer) throw new Error(`viên ${a['data-id']} nằm ngoài layer`);
      const p = placeOf(a.transform, layer.m);
      layer.l.stones.push({
        id: a['data-id'], layer: a['data-layer'] || layer.l.id, code: a['data-code'], shape: a['data-shape'] || 'round',
        x_mm: p.x, y_mm: p.y, phys_mm: Number(a['data-phys']), ref_mm: Number(a['data-ref']), rot_deg: p.r,
        locked: a['data-locked'] === 'true', source: a['data-source'] ?? '',
      });
      if (!selfClose) stack.push({});
    } else if (a['data-layer'] != null && !layer) {
      layer = { l: { id: a['data-layer'], stones: [] }, m: a.transform ? parseTransform(a.transform) : I };
      d.layers.push(layer.l);
      if (!selfClose) stack.push({ layer: true }); else layer = null;
    } else if (!selfClose) stack.push({});
  }
  return d;
}
