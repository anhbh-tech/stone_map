// KIT-10: nhãn vùng 'stone' (dán đá) vs 'print' (chỉ in) bằng VLM theo ô (docs/KIT-DATA.md §1: sản phẩm thật là partial drill).
// Ảnh → ô ~40 mm chồng 10% → mỗi ô 1 call Gemini Flash (JSON: polygon + nhãn + vật liệu + màu chính) → bỏ phiếu theo ô
// (gần tâm ô nặng hơn) → mặt nạ vùng đá toàn ảnh 'pearl-kit-region/1' (RLE trên lưới ≤ 1000 ô). DETECT/PLACE nhận mặt nạ này
// qua params.regionMask (withRegion). So với đáp án (bảng stones của kit/db/kit.sqlite): gtMask / scoreMask / rules.
// Không phụ thuộc server.js: callFlash gọi Gemini giống geminiJson của server, key đọc từ process.env lúc chạy.
// PEARL_MOCK=1 → mockLabel (đoán theo độ gắt + màu từng ô con), không gọi mạng.
import crypto from 'node:crypto';
import { encodePng } from '../png.js';

export const SCHEMA = 'pearl-kit-vlm/1';
export const REGION_SCHEMA = 'pearl-kit-region/1';
export const MATERIALS = ['pearl', 'faceted', 'metal', 'fur', 'other'];
export const VLM = { tileMm: 40, overlap: 0.1, pxPerMm: 11.81, sendPx: 768, maxGrid: 1000, minFill: 0.02, concurrency: 4, model: 'gemini-flash-latest' };
// Ước phí trước khi chạy (USD / 1M token, bảng giá Gemini Flash đời mới; ghi đè bằng env VLM_PRICE_IN / VLM_PRICE_OUT).
// Mỗi call ≈ 1 ảnh (~1120 token ở độ phân giải ảnh mặc định) + prompt, ra JSON polygon + suy nghĩ ~2500 token.
export const PRICE = { inPerM: 0.5, outPerM: 3, imgTokens: 1120, promptTokens: 450, outTokens: 2500 };

const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const hex2 = (v) => clampI(Math.round(v), 0, 255).toString(16).padStart(2, '0');
const toHex = (c) => `#${c.map(hex2).join('')}`.toUpperCase();
const fromHex = (s) => (/^#?[0-9a-f]{6}$/i.test(s || '') ? [0, 2, 4].map((i) => parseInt(s.replace('#', '').slice(i, i + 2), 16)) : null);

const priceOf = (v, d) => (v != null && v !== '' && Number.isFinite(+v) && +v >= 0 ? +v : d);
export function estimateCost(calls, p = PRICE, env = process.env) {
  const inPerM = priceOf(env.VLM_PRICE_IN, p.inPerM), outPerM = priceOf(env.VLM_PRICE_OUT, p.outPerM);
  const tin = calls * (p.imgTokens + p.promptTokens), tout = calls * p.outTokens;
  return { calls, tokensIn: tin, tokensOut: tout, usd: r3((tin * inPerM + tout * outPerM) / 1e6), inPerM, outPerM };
}
export const usageCost = (u, env = process.env) => r3(((u.in || 0) * priceOf(env.VLM_PRICE_IN, PRICE.inPerM) + (u.out || 0) * priceOf(env.VLM_PRICE_OUT, PRICE.outPerM)) / 1e6);

// ── ô: đều nhau, ô cuối sát mép (chồng ≥ overlap); bỏ ô gần như trong suốt (< minFill alpha ≥ 128).
export function tilePlan(img, opts = {}) {
  const o = { ...VLM, ...opts }, tp = Math.max(16, Math.round(o.tileMm * o.pxPerMm)), stride = Math.max(1, tp * (1 - o.overlap));
  const starts = (n) => {
    if (n <= tp) return [0];
    const k = Math.ceil((n - tp) / stride) + 1, s = (n - tp) / (k - 1);
    return [...Array(k)].map((_, i) => Math.round(i * s));
  };
  const tiles = [], tw = Math.min(tp, img.w), th = Math.min(tp, img.h);
  for (const y of starts(img.h)) for (const x of starts(img.w)) {
    let n = 0, a = 0;
    for (let v = y; v < y + th; v += 4) for (let u = x; u < x + tw; u += 4) { n++; if (img.data[(v * img.w + u) * 4 + 3] >= 128) a++; }
    tiles.push({ i: tiles.length, x, y, w: tw, h: th, fill: r2(a / n), skip: a / n < o.minFill });
  }
  return { tilePx: tp, stridePx: Math.round(stride), tiles };
}

// Cắt ô (nền trong suốt → trắng), thu nhỏ hộp khi > sendPx, ra PNG.
export function tilePng(img, t, sendPx = VLM.sendPx) {
  const f = Math.max(1, Math.ceil(Math.max(t.w, t.h) / sendPx)), W = Math.floor(t.w / f), H = Math.floor(t.h / f), out = new Uint8Array(W * H * 4), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = [0, 0, 0];
    for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) {
      const j = ((t.y + y * f + v) * img.w + t.x + x * f + u) * 4, al = d[j + 3] / 255;
      for (let k = 0; k < 3; k++) c[k] += d[j + k] * al + 255 * (1 - al);
    }
    out.set([...c.map((s) => Math.round(s / (f * f))), 255], (y * W + x) * 4);
  }
  return { w: W, h: H, png: encodePng(W, H, out, {}, { compact: true, rgb: true }) };
}

export const TILE_PROMPT = `This image is one square tile (about 40 x 40 mm) of a pearl / diamond painting kit design.
In the finished product only SOME areas get real stones glued on (partial drill): areas drawn as round beads, pearls,
rhinestones or glittering gems are covered with stones. Everything else is only printed (flat paint, sky, smooth shading,
painted branches, painted fur, background, text).
Split the tile into regions that together cover the whole tile without overlapping. For each region give:
- label: "stone" if the area is drawn as beads / pearls / gems that become real stones, otherwise "print";
- material: what the area depicts: pearl (smooth white or cream round beads), faceted (sparkly cut rhinestones),
  metal (gold or silver metallic), fur (animal fur or hair), other;
- color: the main colour as #RRGGBB, and color_name in one or two plain words;
- polygon: the outline as a flat list y1,x1,y2,x2,... on a 0-1000 scale of this tile (0,0 = top-left), 3 to 24 points.
Prefer a few large regions (at most 12). An area mostly covered by beads is "stone".`;

const STR = (description) => ({ type: 'STRING', description });
export const TILE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    regions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING', format: 'enum', enum: ['stone', 'print'] },
          material: { type: 'STRING', format: 'enum', enum: MATERIALS },
          color: STR('main colour #RRGGBB'),
          color_name: STR('main colour in one or two plain words'),
          polygon: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'flat y1,x1,y2,x2,... on a 0-1000 scale of the tile' },
        },
        required: ['label', 'material', 'color', 'color_name', 'polygon'],
        propertyOrdering: ['label', 'material', 'color', 'color_name', 'polygon'],
      },
    },
  },
  required: ['regions'],
};

// Gọi Gemini Flash JSON như geminiJson của server.js (temperature 0, responseSchema). Key chỉ đi trong header, không log.
export async function callFlash(parts, schema, { env = process.env, fetchFn = globalThis.fetch, timeoutMs = 120000, retries = 2, thinking } = {}) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('Cần GEMINI_API_KEY trong môi trường (vd. node --env-file=.env …)');
  const model = env.ANALYZE_MODEL || VLM.model;
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema, ...(thinking && { thinkingConfig: { thinkingLevel: thinking } }) } });
  for (let i = 0; ; i++) {
    let status = 0;
    try {
      const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body, signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(r?.error?.message || '').slice(0, 300)}`);
      const text = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const u = r.usageMetadata || {};
      let data;
      try { data = JSON.parse(text); } catch { throw Object.assign(new Error(`Model trả về không phải JSON: ${text.slice(0, 200)}`), { final: true }); }
      return { model: r.modelVersion || model, data, usage: { in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } };
    } catch (e) {
      const again = !e.final && (status === 0 || status === 429 || status >= 500) && i < retries;
      if (!again) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** i));
    }
  }
}

// ── màu → họ màu (luật theo màu không dựa vào chữ tự do của model)
export function colorFamily(rgb) {
  const [r, g, b] = rgb.map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
  if (s < 0.18 || mx - mn < 0.08) return mx > 0.78 ? 'white' : mx < 0.25 ? 'black' : 'grey';
  let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
  h = (h * 60 + 360) % 360;
  if (mx < 0.2) return 'black';
  if (h < 50 && mx < 0.6) return 'brown';
  if (h < 15 || h >= 340) return 'red';
  if (h < 45) return s < 0.45 && mx > 0.75 ? 'cream' : 'orange';
  if (h < 70) return s < 0.45 && mx > 0.75 ? 'cream' : 'yellow';
  if (h < 165) return 'green';
  if (h < 200) return 'cyan';
  if (h < 260) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

// Nhãn giả cho PEARL_MOCK: chia ô 4×4, ô con có cạnh gắt (hạt vẽ) → stone, mịn → print; vật liệu theo màu.
export function mockLabel(img, t) {
  const n = 4, regions = [], d = img.data, at = (u, v) => (v * img.w + u) * 4;
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const x0 = t.x + Math.floor((cx * t.w) / n), x1 = t.x + Math.floor(((cx + 1) * t.w) / n), y0 = t.y + Math.floor((cy * t.h) / n), y1 = t.y + Math.floor(((cy + 1) * t.h) / n);
    let e = 0, k = 0, a = 0;
    const c = [0, 0, 0];
    for (let v = y0; v < y1 - 1; v++) for (let u = x0; u < x1 - 1; u++) {
      const j = at(u, v), jr = at(u + 1, v), jd = at(u, v + 1), gy = (q) => 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
      k++; if (d[j + 3] < 128) continue;
      a++; e += Math.abs(gy(j) - gy(jr)) + Math.abs(gy(j) - gy(jd));
      for (let i = 0; i < 3; i++) c[i] += d[j + i];
    }
    const rgb = a ? c.map((s) => s / a) : [255, 255, 255], fam = colorFamily(rgb), stone = a > 0.5 * k && e / Math.max(1, a) > 14;
    const material = !stone ? (fam === 'brown' ? 'fur' : 'other') : fam === 'white' || fam === 'cream' ? 'pearl' : fam === 'yellow' || fam === 'grey' ? 'metal' : 'faceted';
    const q = (v, len) => Math.round((1000 * v) / len), Y0 = q(y0 - t.y, t.h), Y1 = q(y1 - t.y, t.h), X0 = q(x0 - t.x, t.w), X1 = q(x1 - t.x, t.w);
    regions.push({ label: stone ? 'stone' : 'print', material, color: toHex(rgb), color_name: fam, polygon: [Y0, X0, Y0, X1, Y1, X1, Y1, X0] });
  }
  return { regions };
}

export const tileKey = (model, png) => crypto.createHash('sha1').update(model).update(TILE_PROMPT).update(png).digest('hex');
// Mỗi ô 1 call (đồng thời ≤ concurrency). call(parts, tile) → { model, data, usage }; cache { get(k), set(k, v) } theo sha1 ảnh ô + prompt + model.
export async function labelTiles(img, plan, { call, model = VLM.model, cache = null, concurrency = VLM.concurrency, sendPx = VLM.sendPx, onTile = null } = {}) {
  const todo = plan.tiles.filter((t) => !t.skip), out = new Map();
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const t = todo[next++], { png } = tilePng(img, t, sendPx), t0 = Date.now(), key = tileKey(model, png);
      let r = cache?.get(key);
      if (r) r = { ...r, cached: true };
      else {
        try {
          const g = await call([{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }, { text: TILE_PROMPT }], t);
          r = { model: g.model, regions: cleanRegions(g.data?.regions), usage: g.usage || { in: 0, out: 0 }, ms: Date.now() - t0 };
          cache?.set(key, r);
        } catch (e) { r = { error: e.message.slice(0, 300), ms: Date.now() - t0 }; }
      }
      out.set(t.i, r);
      onTile?.(t, r);
    }
  };
  await Promise.all([...Array(Math.max(1, Math.min(concurrency, todo.length)))].map(worker));
  return plan.tiles.map((t) => ({ ...t, ...(t.skip ? {} : out.get(t.i)) }));
}

export function cleanRegions(list) {
  return (Array.isArray(list) ? list : []).map((r) => {
    const p = (Array.isArray(r?.polygon) ? r.polygon : []).map(Number).filter(Number.isFinite).map((v) => clampI(Math.round(v), 0, 1000));
    return { label: r?.label === 'stone' ? 'stone' : 'print', material: MATERIALS.includes(r?.material) ? r.material : 'other',
      color: fromHex(r?.color) ? toHex(fromHex(r.color)) : null, colorName: String(r?.color_name || '').slice(0, 40), polygon: p.slice(0, p.length - (p.length % 2)) };
  }).filter((r) => r.polygon.length >= 6);
}

// ── raster
// Tô đa giác (toạ độ lưới, [[x, y], …]) chẵn-lẻ theo tâm ô, chỉ trong khung clip {x0, y0, x1, y1} (ô lưới, x1/y1 không gồm).
export function fillPoly(arr, W, H, pts, val, clip = { x0: 0, y0: 0, x1: W, y1: H }) {
  const ys = pts.map((p) => p[1]), y0 = Math.max(clip.y0, Math.floor(Math.min(...ys))), y1 = Math.min(clip.y1 - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5, xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[j];
      if ((ay <= cy) !== (by <= cy)) xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(clip.x0, Math.ceil(xs[k] - 0.5)), b = Math.min(clip.x1 - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) arr[y * W + x] = val;
    }
  }
}
export function gridOf(w, h, maxGrid = VLM.maxGrid) { const g = Math.max(1, Math.ceil(Math.max(w, h) / maxGrid)); return { g, W: Math.ceil(w / g), H: Math.ceil(h / g) }; }
// polygon ô (0-1000, y,x) → px ảnh [[x, y], …]
export const polyPx = (t, p) => { const o = []; for (let i = 0; i + 1 < p.length; i += 2) o.push([t.x + (p[i + 1] / 1000) * t.w, t.y + (p[i] / 1000) * t.h]); return o; };

// Ghép các ô: mỗi ô vẽ print rồi stone (stone thắng chỗ chồng), ô không nhãn = print; phiếu nặng theo khoảng cách tới mép ô.
export function mergeTiles(img, tiles, maxGrid = VLM.maxGrid) {
  const { g, W, H } = gridOf(img.w, img.h, maxGrid), sv = new Float32Array(W * H), pv = new Float32Array(W * H), regions = [];
  for (const t of tiles) {
    if (!t.regions) continue;
    const clip = { x0: Math.floor(t.x / g), y0: Math.floor(t.y / g), x1: Math.min(W, Math.ceil((t.x + t.w) / g)), y1: Math.min(H, Math.ceil((t.y + t.h) / g)) };
    const lab = new Uint8Array(W * H);
    for (const want of ['print', 'stone']) for (const r of t.regions) if (r.label === want) fillPoly(lab, W, H, polyPx(t, r.polygon).map(([x, y]) => [x / g, y / g]), want === 'stone' ? 2 : 1, clip);
    for (const r of t.regions) regions.push({ tile: t.i, label: r.label, material: r.material, color: r.color, colorName: r.colorName, family: r.color ? colorFamily(fromHex(r.color)) : null, poly: polyPx(t, r.polygon).map(([x, y]) => [Math.round(x), Math.round(y)]) });
    const hw = (clip.x1 - clip.x0) / 2, hh = (clip.y1 - clip.y0) / 2;
    for (let y = clip.y0; y < clip.y1; y++) for (let x = clip.x0; x < clip.x1; x++) {
      const wt = Math.max(0.05, Math.min(1 - Math.abs(x + 0.5 - clip.x0 - hw) / hw, 1 - Math.abs(y + 0.5 - clip.y0 - hh) / hh)), j = y * W + x;
      if (lab[j] === 2) sv[j] += wt; else pv[j] += wt;
    }
  }
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = y * W + x, a = img.data[(Math.min(img.h - 1, Math.floor((y + 0.5) * g)) * img.w + Math.min(img.w - 1, Math.floor((x + 0.5) * g))) * 4 + 3];
    mask[j] = sv[j] > pv[j] && a >= 128 ? 1 : 0;
  }
  return { grid: { w: W, h: H, scale: g }, mask, regions };
}

// ── mặt nạ vùng 'pearl-kit-region/1': lưới w×h phủ cả ảnh, rle = độ dài các đoạn xen kẽ bắt đầu bằng 0.
export function encodeRegion(mask, W, H) {
  const rle = [];
  let cur = 0, n = 0;
  for (let j = 0; j < W * H; j++) { const v = mask[j] ? 1 : 0; if (v === cur) n++; else { rle.push(n); cur = v; n = 1; } }
  rle.push(n);
  return { schema: REGION_SCHEMA, w: W, h: H, rle };
}
export function decodeRegion(rm) {
  if (rm?.regionMask) rm = rm.regionMask;
  if (rm?.schema !== REGION_SCHEMA || !(rm.w > 0) || !(rm.h > 0) || !Array.isArray(rm.rle)) throw new Error(`regionMask lạ (cần ${REGION_SCHEMA} { w, h, rle })`);
  const m = new Uint8Array(rm.w * rm.h);
  let j = 0;
  rm.rle.forEach((n, i) => { if (!(n >= 0) || j + n > m.length) throw new Error('regionMask: rle sai độ dài'); if (i % 2) m.fill(1, j, j + n); j += n; });
  if (j !== m.length) throw new Error(`regionMask: rle ${j} ≠ ${rm.w}×${rm.h}`);
  return { w: rm.w, h: rm.h, bits: m };
}
// Lưới → mặt nạ cỡ ảnh (lân cận gần nhất). Nhận cả Uint8Array w·h sẵn cỡ ảnh (dạng params.regionMask của lib/kit/select.js).
export function regionToMask(rm, w, h) {
  if (ArrayBuffer.isView(rm)) { if (rm.length !== w * h) throw new Error(`regionMask ${rm.length} ≠ ảnh ${w}×${h}`); return Uint8Array.from(rm, (v) => (v ? 1 : 0)); }
  const { w: W, h: H, bits } = decodeRegion(rm), m = new Uint8Array(w * h), cx = Uint32Array.from({ length: w }, (_, x) => Math.min(W - 1, Math.floor(((x + 0.5) * W) / w)));
  for (let y = 0; y < h; y++) { const row = Math.min(H - 1, Math.floor(((y + 0.5) * H) / h)) * W; for (let x = 0; x < w; x++) m[y * w + x] = bits[row + cx[x]]; }
  return m;
}
// Điểm nhận params.regionMask của DETECT/PLACE: mask (null = alpha ≥ 128 / cả ảnh) AND vùng đá. rm rỗng → trả mask nguyên.
export function withRegion(img, mask, rm) {
  if (!rm) return mask;
  const m = regionToMask(rm, img.w, img.h);
  for (let j = 0; j < m.length; j++) if (m[j] && !(mask ? mask[j] : img.data[j * 4 + 3] >= 128)) m[j] = 0;
  return m;
}

export function buildDoc(img, { name, sha1, plan, tiles, merged, opts = {}, model }) {
  const o = { ...VLM, ...opts }, usage = { in: 0, out: 0 };
  for (const t of tiles) if (t.usage && !t.cached) { usage.in += t.usage.in; usage.out += t.usage.out; }
  const done = tiles.filter((t) => t.regions), calls = done.filter((t) => !t.cached).length;
  const stoneCells = merged.mask.reduce((a, b) => a + b, 0);
  return {
    schema: SCHEMA, name, model, createdAt: new Date().toISOString(),
    source: { name, sha1, widthPx: img.w, heightPx: img.h },
    params: { tileMm: o.tileMm, overlap: o.overlap, pxPerMm: o.pxPerMm, tilePx: plan.tilePx, stridePx: plan.stridePx, sendPx: o.sendPx },
    stats: { tiles: tiles.length, skipped: tiles.filter((t) => t.skip).length, labelled: done.length, errors: tiles.filter((t) => t.error).length, calls, cached: done.length - calls,
      usage, costUsd: usageCost(usage), stonePct: r2((100 * stoneCells) / merged.mask.length) },
    tiles: tiles.map(({ i, x, y, w, h, fill, skip, error, ms, cached }) => ({ i, x, y, w, h, fill, ...(skip && { skip }), ...(error && { error }), ...(ms != null && { ms }), ...(cached && { cached }) })),
    regions: merged.regions,
    regionMask: encodeRegion(merged.mask, merged.grid.w, merged.grid.h),
  };
}

// ── so với đáp án: viên thật [{x, y, dMm}] (px ảnh) → lưới; đĩa vật lý + đóng (closeMm) = vùng có đá.
export function gtMask(stones, w, h, { maxGrid = VLM.maxGrid, pxPerMm = VLM.pxPerMm, closeMm = 1.5 } = {}) {
  const { g, W, H } = gridOf(w, h, maxGrid), disc = new Uint8Array(W * H), rc = (closeMm * pxPerMm) / g;
  const draw = (arr, s, extra) => {
    const r = (s.dMm * pxPerMm) / 2 / g + extra, cx = s.x / g, cy = s.y / g;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) arr[y * W + x] = 1;
  };
  for (const s of stones) draw(disc, s, 0);
  const dil = new Uint8Array(W * H);
  for (const s of stones) draw(dil, s, rc);
  // co lại rc: khoảng cách chamfer (3-4) tới ô ngoài dil
  const D = new Float32Array(W * H), INF = 1e9;
  for (let j = 0; j < D.length; j++) D[j] = dil[j] ? INF : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = y * W + x; if (!D[j]) continue; let v = D[j];
    if (x) v = Math.min(v, D[j - 1] + 1); if (y) v = Math.min(v, D[j - W] + 1); if (x && y) v = Math.min(v, D[j - W - 1] + 1.4142); if (y && x < W - 1) v = Math.min(v, D[j - W + 1] + 1.4142); D[j] = v; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const j = y * W + x; if (!D[j]) continue; let v = D[j];
    if (x < W - 1) v = Math.min(v, D[j + 1] + 1); if (y < H - 1) v = Math.min(v, D[j + W] + 1); if (x < W - 1 && y < H - 1) v = Math.min(v, D[j + W + 1] + 1.4142); if (y < H - 1 && x) v = Math.min(v, D[j + W - 1] + 1.4142); D[j] = v; }
  const closed = new Uint8Array(W * H);
  for (let j = 0; j < D.length; j++) closed[j] = disc[j] || D[j] > rc ? 1 : 0;
  return { grid: { w: W, h: H, scale: g }, disc, closed };
}
export function scoreMask(pred, gt) {
  let tp = 0, fp = 0, fn = 0;
  for (let j = 0; j < gt.length; j++) { if (pred[j] && gt[j]) tp++; else if (pred[j]) fp++; else if (gt[j]) fn++; }
  return { iou: r4(tp / Math.max(1, tp + fp + fn)), precision: r4(tp / Math.max(1, tp + fp)), recall: r4(tp / Math.max(1, tp + fn)) };
}
// Tỉ lệ tâm viên thật rơi vào mặt nạ (theo series catalog).
export function centerRecall(pred, grid, stones) {
  const by = {};
  let hit = 0;
  for (const s of stones) {
    const x = Math.min(grid.w - 1, Math.floor(s.x / grid.scale)), y = Math.min(grid.h - 1, Math.floor(s.y / grid.scale)), k = s.series || '?', inside = !!pred[y * grid.w + x];
    (by[k] ||= { n: 0, hit: 0 }).n++; if (inside) { by[k].hit++; hit++; }
  }
  return { all: r2(hit / Math.max(1, stones.length)), bySeries: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.n, recall: r2(v.hit / v.n) }])) };
}

// Luật: mỗi vùng VLM → % diện tích nằm trong vùng có đá thật; gộp theo nhãn / vật liệu / họ màu / vật liệu+họ màu.
// Tập vật liệu (và vật liệu+màu) có ≥ 50% diện tích là đá → mặt nạ luật, chấm IoU như mặt nạ theo nhãn.
export function rules(doc, gt, stones = []) {
  const { w: W, h: H, scale: g } = gt.grid, tmp = new Uint8Array(W * H), groups = {}, per = [];
  for (const r of doc.regions) {
    tmp.fill(0);
    fillPoly(tmp, W, H, r.poly.map(([x, y]) => [x / g, y / g]), 1);
    let n = 0, s = 0;
    for (let j = 0; j < tmp.length; j++) if (tmp[j]) { n++; s += gt.closed[j]; }
    if (!n) continue;
    const series = {};
    for (const st of stones) { const x = Math.floor(st.x / g), y = Math.floor(st.y / g); if (x < W && y < H && tmp[y * W + x]) series[st.series || '?'] = (series[st.series || '?'] || 0) + 1; }
    per.push({ r, n, s, series });
    for (const key of [`label:${r.label}`, `material:${r.material}`, `family:${r.family || '?'}`, `material+family:${r.material}/${r.family || '?'}`]) {
      const q = (groups[key] ||= { key, regions: 0, cells: 0, stoneCells: 0, series: {} });
      q.regions++; q.cells += n; q.stoneCells += s;
      for (const [k, v] of Object.entries(series)) q.series[k] = (q.series[k] || 0) + v;
    }
  }
  const mm2 = (cells) => Math.round((cells * g * g) / VLM.pxPerMm ** 2);
  const table = Object.values(groups).map((q) => ({ key: q.key, regions: q.regions, areaMm2: mm2(q.cells), stoneFrac: r2(q.stoneCells / q.cells),
    verdict: q.stoneCells / q.cells >= 0.6 ? 'có đá' : q.stoneCells / q.cells <= 0.25 ? 'in' : 'lẫn', series: q.series })).sort((a, b) => a.key.localeCompare(b.key) || b.areaMm2 - a.areaMm2);
  const maskOf = (pick) => {
    const m = new Uint8Array(W * H);
    for (const { r } of per) if (pick(r)) fillPoly(m, W, H, r.poly.map(([x, y]) => [x / g, y / g]), 1);
    return m;
  };
  const good = (prefix) => new Set(table.filter((t) => t.key.startsWith(prefix) && t.stoneFrac >= 0.5).map((t) => t.key.slice(prefix.length)));
  const mats = good('material:'), combos = good('material+family:');
  return {
    table,
    derived: {
      byLabel: scoreMask(maskOf((r) => r.label === 'stone'), gt.closed),
      byMaterial: { materials: [...mats], ...scoreMask(maskOf((r) => mats.has(r.material)), gt.closed) },
      byMaterialFamily: { combos: [...combos], ...scoreMask(maskOf((r) => combos.has(`${r.material}/${r.family || '?'}`)), gt.closed) },
    },
  };
}

// ── KIT-12c: VLM hỗ trợ vật thể to (ít call): cả ảnh → danh sách vật thể to + box_2d; crop phóng to → từng hạt + box_2d.
// box_2d = [ymin, xmin, ymax, xmax] 0-1000 theo ảnh gửi đi (quy ước detect của Gemini). Ngân sách call ghi file, dừng cứng.
export const OBJ_MATERIALS = ['pearl', 'faceted', 'cabochon', 'opal', 'metal', 'fabric', 'fur', 'other'];
export const STRUCTURES = ['single', 'beads', 'area'];
const BOX = { type: 'ARRAY', items: { type: 'INTEGER' }, description: '[ymin, xmin, ymax, xmax] normalized to 0-1000' };
const ENUM = (values, description) => ({ type: 'STRING', format: 'enum', enum: values, description });

export const objectPrompt = (canvasMm = 300) => `This image (${canvasMm} x ${canvasMm} mm when printed) is a jewelled costume / design for a pearl and rhinestone diamond-painting kit.
List the LARGE or special objects only, at most 25: big gemstones, cabochons, opals, single large pearls, strings / rings of pearls or beads,
metallic (gold / silver) areas. Do not list each tiny background bead of a large textured area separately.
For each object give:
- label: short name (e.g. "central blue sapphire", "pearl ring around the opal");
- material: pearl, faceted (cut rhinestone / gem with facets), cabochon (smooth domed stone), opal, metal, fabric, fur, other;
- structure: "single" if it is ONE stone / ONE pearl, "beads" if it is made of many separate beads or pearls (a chain, ring, row or cluster), "area" for a textured surface;
- count: number of separate stones / pearls in it (1 for single; your best count for beads; 0 for area);
- bead_mm: typical diameter in mm of one stone / pearl in it (the whole object for single);
- color: main colour #RRGGBB;
- box_2d: [ymin, xmin, ymax, xmax] normalized to 0-1000.`;

export const OBJECT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    objects: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { label: STR('short name'), material: ENUM(OBJ_MATERIALS), structure: ENUM(STRUCTURES), count: { type: 'INTEGER' }, bead_mm: { type: 'NUMBER' }, color: STR('#RRGGBB'), box_2d: BOX },
        required: ['label', 'material', 'structure', 'count', 'bead_mm', 'color', 'box_2d'],
        propertyOrdering: ['label', 'material', 'structure', 'count', 'bead_mm', 'color', 'box_2d'],
      },
    },
  },
  required: ['objects'],
};

export const cropPrompt = (mmW, mmH, hint = '') => `This image is an enlarged crop (${Math.round(mmW)} x ${Math.round(mmH)} mm in the printed design) of a jewelled costume for a pearl and rhinestone diamond-painting kit.${hint ? ` It should show: ${hint}.` : ''}
1) main: the central object: material (pearl, faceted, cabochon, opal, metal, fabric, fur, other), structure ("single" = ONE stone, "beads" = many separate beads), count of separate stones in it, and whether all its beads look the same (same_type).
2) beads: EVERY separate round stone, pearl or bead visible in the crop (including the ones around the central object), at most 80, each with
   material, color #RRGGBB and box_2d [ymin, xmin, ymax, xmax] normalized to 0-1000. A large single stone is ONE entry with its full box.`;

export const CROP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    main: {
      type: 'OBJECT',
      properties: { label: STR('short name'), material: ENUM(OBJ_MATERIALS), structure: ENUM(STRUCTURES), count: { type: 'INTEGER' }, same_type: { type: 'BOOLEAN' }, box_2d: BOX },
      required: ['label', 'material', 'structure', 'count', 'same_type', 'box_2d'],
      propertyOrdering: ['label', 'material', 'structure', 'count', 'same_type', 'box_2d'],
    },
    beads: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { material: ENUM(OBJ_MATERIALS), color: STR('#RRGGBB'), box_2d: BOX },
        required: ['material', 'color', 'box_2d'], propertyOrdering: ['material', 'color', 'box_2d'],
      },
    },
  },
  required: ['main', 'beads'],
};

// box_2d (0-1000 theo vùng {x, y, w, h} px ảnh gốc đã gửi) → {x0, y0, x1, y1} px ảnh gốc; hỏng → null
export function boxPx(b, area) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return null;
  const [y0, x0, y1, x1] = b.map((v) => clampI(v, 0, 1000) / 1000);
  if (!(y1 > y0 && x1 > x0)) return null;
  return { x0: area.x + x0 * area.w, y0: area.y + y0 * area.h, x1: area.x + x1 * area.w, y1: area.y + y1 * area.h };
}

// Cắt vùng {x, y, w, h} rồi đổi cỡ song tuyến sao cho cạnh dài = outPx (phóng to crop / thu nhỏ cả ảnh); nền trong suốt → trắng.
export function resizeRegion(img, area, outPx) {
  const k = outPx / Math.max(area.w, area.h), W = Math.max(1, Math.round(area.w * k)), H = Math.max(1, Math.round(area.h * k)), out = new Uint8Array(W * H * 4), d = img.data;
  if (k < 1) { // thu nhỏ: trung bình hộp
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u0 = Math.floor(area.x + x / k), u1 = Math.max(u0 + 1, Math.floor(area.x + (x + 1) / k)), v0 = Math.floor(area.y + y / k), v1 = Math.max(v0 + 1, Math.floor(area.y + (y + 1) / k)), c = [0, 0, 0];
      let n = 0;
      for (let v = v0; v < Math.min(v1, img.h); v++) for (let u = u0; u < Math.min(u1, img.w); u++) { const j = (v * img.w + u) * 4, a = d[j + 3] / 255; for (let i = 0; i < 3; i++) c[i] += d[j + i] * a + 255 * (1 - a); n++; }
      out.set([...c.map((s) => Math.round(s / Math.max(1, n))), 255], (y * W + x) * 4);
    }
  } else {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const fx = clampI(area.x + (x + 0.5) / k - 0.5, 0, img.w - 1), fy = clampI(area.y + (y + 0.5) / k - 0.5, 0, img.h - 1), x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1), ax = fx - x0, ay = fy - y0, c = [0, 0, 0];
      for (const [u, v, wt] of [[x0, y0, (1 - ax) * (1 - ay)], [x1, y0, ax * (1 - ay)], [x0, y1, (1 - ax) * ay], [x1, y1, ax * ay]]) {
        const j = (v * img.w + u) * 4, a = d[j + 3] / 255;
        for (let i = 0; i < 3; i++) c[i] += wt * (d[j + i] * a + 255 * (1 - a));
      }
      out.set([...c.map(Math.round), 255], (y * W + x) * 4);
    }
  }
  return { w: W, h: H, data: out };
}

// Ngân sách call ghi vào file jsonl: mỗi call 1 dòng 'sent' TRƯỚC khi gọi (đếm cả call lỗi / bị ngắt) + 1 dòng 'done'.
// fsMod = node:fs (truyền vào để module không tự ghi đĩa khi chỉ dùng hàm tính toán).
// usdCap: dừng khi phí thật đã tiêu (tính lại từ token, không làm tròn) + reserveUsd (phí tối đa ước cho 1 call) vượt trần.
export function callBudget(file, cap, fsMod, { usdCap = Infinity, reserveUsd = 0.03 } = {}) {
  const lines = () => { try { return fsMod.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const used = () => lines().filter((l) => l.state === 'sent').length;
  const spent = () => lines().filter((l) => l.state === 'done').reduce((a, l) => a + ((l.usage?.in || 0) * PRICE.inPerM + (l.usage?.out || 0) * PRICE.outPerM) / 1e6, 0);
  let inflight = 0, lastN = 0; // gọi song song: mỗi call đang chạy giữ 1 phần dự phòng; số thứ tự không trùng
  return {
    cap, usdCap, used, lines, spent,
    async call(meta, fn) {
      const n = Math.max(used(), lastN) + 1;
      if (n > cap) throw Object.assign(new Error(`Hết ngân sách: đã dùng ${n - 1}/${cap} call (${file})`), { budget: true });
      if (spent() + reserveUsd * (inflight + 1) > usdCap) throw Object.assign(new Error(`Hết ngân sách: đã tiêu $${r4(spent())} + dự phòng $${reserveUsd}×${inflight + 1} > trần $${usdCap} (${file})`), { budget: true });
      lastN = n; inflight++;
      const append = (o) => fsMod.appendFileSync(file, `${JSON.stringify(o)}\n`);
      append({ n, state: 'sent', at: new Date().toISOString(), ...meta });
      const t0 = Date.now();
      try {
        const r = await fn();
        append({ n, state: 'done', at: new Date().toISOString(), ms: Date.now() - t0, model: r.model, usage: r.usage, usd: usageCost(r.usage || {}), ...meta });
        return r;
      } catch (e) {
        append({ n, state: 'error', at: new Date().toISOString(), ms: Date.now() - t0, error: String(e.message).slice(0, 300), ...meta });
        throw e;
      } finally { inflight--; }
    },
  };
}

// Cả ảnh, độ phân giải gốc: MỌI viên đá / ngọc riêng lẻ ≥ ~5 mm hoặc không tròn, kèm hình dạng (catalog có M marquise, S giọt, X tim).
export const SHAPES = ['round', 'oval', 'marquise', 'teardrop', 'heart', 'star', 'flower', 'square', 'other'];
export const stonesPrompt = (canvasMm = 300) => `This image (${canvasMm} x ${canvasMm} mm when printed) is a jewelled costume / design for a pearl and rhinestone diamond-painting kit.
List EVERY individual gemstone, cabochon, opal or pearl that is at least about 5 mm across, or that is not round (marquise, teardrop, heart, star, flower...), at most 120.
Do not list the tiny 2-4 mm background beads that make up textured areas, and do not list groups: one entry per stone.
For each stone: material (pearl, faceted, cabochon, opal, metal, other), shape, color #RRGGBB, box_2d [ymin, xmin, ymax, xmax] normalized to 0-1000.`;
export const STONES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    stones: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { material: ENUM(OBJ_MATERIALS), shape: ENUM(SHAPES), color: STR('#RRGGBB'), box_2d: BOX },
        required: ['material', 'shape', 'color', 'box_2d'], propertyOrdering: ['material', 'shape', 'color', 'box_2d'],
      },
    },
  },
  required: ['stones'],
};

// ── KIT-13: chia theo cỡ, to → nhỏ. Tầng 1 ≥ 8 mm (cả ảnh), tầng 2 5-7 mm (ô, vùng tầng 1 tô xám), tầng 3 2.8-4 mm
// (crop phóng to: ĐẾM theo vật liệu/màu/cỡ, hoặc gán vật liệu/màu cho tâm đánh số do thuật toán dò).
export const TIERS = { big: [8, 14], mid: [5, 7], small: [2.8, 4] };
export const BEAD_MATERIALS = ['pearl', 'rhinestone', 'cabochon', 'opal', 'metal', 'other'];
export const COLORS = ['white', 'clear', 'gold', 'silver', 'red', 'pink', 'orange', 'brown', 'green', 'blue', 'purple', 'black', 'grey', 'other'];
const COLOR_NOTE = "color: 'white' = opaque white (also pearl white), 'clear' = transparent crystal / AB, 'gold' = gold, amber or yellow";
const NUM = (description) => ({ type: 'NUMBER', description });
const ITEM = {
  type: 'OBJECT',
  properties: { material: ENUM(BEAD_MATERIALS), color: ENUM(COLORS), diameter_mm: NUM('estimated physical diameter in mm'), box_2d: BOX },
  required: ['material', 'color', 'diameter_mm', 'box_2d'], propertyOrdering: ['material', 'color', 'diameter_mm', 'box_2d'],
};
export const TIER_SCHEMA = { type: 'OBJECT', properties: { stones: { type: 'ARRAY', items: ITEM } }, required: ['stones'] };
const per1000 = (mm, side) => Math.round((1000 * mm) / side);
export const bigPrompt = (wMm, hMm) => `This image (${Math.round(wMm)} x ${Math.round(hMm)} mm when printed) is the artwork of a pearl and rhinestone diamond-painting kit.
List EVERY single LARGE stone or pearl that is at least 8 mm across (8 mm = about ${per1000(8, wMm)} units on the 0-1000 scale): big round rhinestones, cabochons, opals, big pearls, ornaments / baubles that are one stone. At most 150.
One entry per stone, never a group or a string. Do not list beads smaller than 7 mm.
For each: material, ${COLOR_NOTE}, diameter_mm, box_2d [ymin, xmin, ymax, xmax] normalized to 0-1000 (tight around that one stone).`;
export const midPrompt = (wMm, hMm) => `This image is a crop (${Math.round(wMm)} x ${Math.round(hMm)} mm when printed) of the artwork of a pearl and rhinestone diamond-painting kit. Flat grey areas are already handled: ignore them.
List EVERY single MEDIUM bead, pearl or rhinestone that is 5 to 7 mm across (5 mm = about ${per1000(5, wMm)} units on the 0-1000 scale). At most 200.
Do not list the tiny 2-4 mm beads that fill textured areas, nor stones 8 mm or larger. One entry per bead.
For each: material, ${COLOR_NOTE}, diameter_mm, box_2d [ymin, xmin, ymax, xmax] normalized to 0-1000.`;
export const COUNT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    groups: { type: 'ARRAY', items: { type: 'OBJECT',
      properties: { material: ENUM(BEAD_MATERIALS), color: ENUM(COLORS), size: ENUM(['2.8', '4', '5+'], 'bead diameter class in mm'), count: { type: 'INTEGER' } },
      required: ['material', 'color', 'size', 'count'], propertyOrdering: ['material', 'color', 'size', 'count'] } },
    total: { type: 'INTEGER', description: 'all beads counted' },
  },
  required: ['groups', 'total'], propertyOrdering: ['groups', 'total'],
};
export const countPrompt = (wMm, hMm) => `This image is an enlarged crop (${Math.round(wMm)} x ${Math.round(hMm)} mm when printed) of the artwork of a pearl and rhinestone diamond-painting kit, so a 2.8 mm bead is about ${Math.round((2.8 / wMm) * 100)}% of the crop width.
COUNT the individual beads, pearls and rhinestones whose centre lies inside the crop, row by row. Do not count flat printed or painted areas, only round raised beads.
Group the counts by material, ${COLOR_NOTE}, and size class: '2.8' (smallest beads), '4' (about 4 mm), '5+' (5 mm or larger). Give the exact total.`;
export const LABEL_SCHEMA = {
  type: 'OBJECT',
  properties: { items: { type: 'ARRAY', items: { type: 'OBJECT',
    properties: { n: { type: 'INTEGER' }, material: ENUM([...BEAD_MATERIALS, 'none']), color: ENUM(COLORS) },
    required: ['n', 'material', 'color'], propertyOrdering: ['n', 'material', 'color'] } } },
  required: ['items'],
};
export const labelPrompt = (n, wMm) => `This image is an enlarged crop (${Math.round(wMm)} mm wide when printed) of the artwork of a pearl and rhinestone diamond-painting kit.
Small white tags numbered 1 to ${n} sit on the centres of beads. For EVERY number 1..${n}, give the material and color of the bead directly under that tag
(${COLOR_NOTE}). If a tag sits on a flat printed area or between beads, use material 'none'.`;

// Tag số trắng viền đen ở tâm (x, y) (Set-of-Mark): chữ từ kit/glyphs.json, cao fontPx; vẽ thẳng vào img {w, h, data}.
export function drawTag(img, x, y, text, fontPx, G) {
  const k = fontPx / G.em, chars = [...String(text)].map((c) => G.glyphs[c]), adv = 0.62 * fontPx;
  const w = Math.ceil(adv * chars.length + 0.3 * fontPx), h = Math.ceil(1.05 * fontPx), x0 = Math.round(x - w / 2), y0 = Math.round(y - h / 2);
  for (let v = y0; v < y0 + h; v++) for (let u = x0; u < x0 + w; u++) {
    if (u < 0 || v < 0 || u >= img.w || v >= img.h) continue;
    const edge = u === x0 || v === y0 || u === x0 + w - 1 || v === y0 + h - 1;
    img.data.set(edge ? [0, 0, 0, 255] : [255, 255, 255, 255], (v * img.w + u) * 4);
  }
  chars.forEach((g, i) => {
    if (!g) return;
    const gx0 = x0 + 0.15 * fontPx + i * adv + (adv - g.w * k) / 2, gy0 = y0 + 0.5 * h + 0.36 * fontPx + g.y * k;
    for (let v = Math.floor(gy0); v < gy0 + g.h * k; v++) for (let u = Math.floor(gx0); u < gx0 + g.w * k; u++) {
      if (u < 0 || v < 0 || u >= img.w || v >= img.h) continue;
      const a = g.a[Math.min(g.h - 1, Math.floor((v - gy0) / k)) * g.w + Math.min(g.w - 1, Math.floor((u - gx0) / k))] / 255, j = (v * img.w + u) * 4;
      for (let c = 0; c < 3; c++) img.data[j + c] = Math.round(img.data[j + c] * (1 - a));
    }
  });
}

// ── KIT-15: đáp án tay (Queen): VLM gán từng tag DETECT (hạt? vật liệu / màu / hình / cỡ) + liệt kê hạt chưa có tag.
// mat4 = vật liệu kiểu DETECT (detect.js MATERIALS: gold / pearl / white / color); hạt màu vàng = gold kể cả khi VLM gọi là pearl.
export const mat4 = (material, color) => (color === 'gold' ? 'gold' : material === 'pearl' ? 'pearl' : ['white', 'clear', 'silver', 'grey'].includes(color) ? 'white' : 'color');
const GT_ITEM = { material: ENUM(BEAD_MATERIALS), color: ENUM(COLORS), shape: ENUM(SHAPES), size_mm: NUM('physical diameter (long side) in mm') };
export const GT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' }, is_bead: { type: 'BOOLEAN' }, ...GT_ITEM, material: ENUM([...BEAD_MATERIALS, 'none']) },
      required: ['n', 'is_bead', 'material', 'color', 'shape', 'size_mm'], propertyOrdering: ['n', 'is_bead', 'material', 'color', 'shape', 'size_mm'] } },
    missing: { type: 'ARRAY', items: { type: 'OBJECT', properties: { ...GT_ITEM, box_2d: BOX },
      required: ['material', 'color', 'shape', 'size_mm', 'box_2d'], propertyOrdering: ['material', 'color', 'shape', 'size_mm', 'box_2d'] } },
  },
  required: ['items', 'missing'], propertyOrdering: ['items', 'missing'],
};
export const gtPrompt = (n, wMm) => `This image is an enlarged crop, ${wMm} x ${wMm} mm when printed (1 mm = ${Math.round(1024 / wMm)} px here), of a jewelled costume for a pearl and rhinestone diamond-painting kit.
Small white tags numbered 1 to ${n} were placed by a detector on bead centres. We are building an exact answer key of every individual bead, pearl and stone.
items: for EVERY number 1..${n}: is_bead = true only if the tag sits on the centre of ONE bead / pearl / stone (false if it is on a flat printed area, between beads, on the edge of a bigger stone, or a second tag on a bead that already has a closer tag);
material, ${COLOR_NOTE}, shape, size_mm (its real diameter measured with the scale above).
missing: every bead, pearl or stone that has NO tag on it (including big stones and marquise / heart shapes), with box_2d [ymin, xmin, ymax, xmax] normalized to 0-1000 of this crop.`;
export const MISS_SCHEMA = { type: 'OBJECT', properties: { missing: GT_SCHEMA.properties.missing }, required: ['missing'] };
export const missPrompt = (wMm) => `This image is an enlarged crop, ${wMm} x ${wMm} mm when printed (1 mm = ${Math.round(1024 / wMm)} px here), of a jewelled costume for a pearl and rhinestone diamond-painting kit.
Beads that are already in our answer key carry a small black dot with a white ring at their centre. List EVERY other individual bead, pearl or stone whose centre is inside the crop and that has NO dot,
one entry per bead (never a group): material, ${COLOR_NOTE}, shape, size_mm (real diameter measured with the scale above), box_2d [ymin, xmin, ymax, xmax] normalized to 0-1000 of this crop. Return an empty list if none.`;
