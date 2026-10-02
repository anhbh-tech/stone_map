// STONEMAP design.json: nguồn sự thật duy nhất của 1 bản đồ đá (docs/STONEMAP.md).
//   { format: 'stonemap-design/1', id, canvas: { w_mm, h_mm }, catalogVersion,
//     layers: [{ id: 'bg'|'costume'|'pet', stones: [{ id, layer, code, shape, x_mm, y_mm, phys_mm, ref_mm, rot_deg, locked, source }] }],
//     symbols: { code: sym }, expected?: { total, byCode: { code: n } },   (expected = BOM của sản phẩm thật, cho QC layer-total)
//     merges?: [{ from, to, de00, n, layer }] }                           (mã đã gộp, cho QC merge-warnings)
//   Toạ độ = tâm viên, mm từ góc trên-trái canvas; phys_mm = cỡ vật lý (cạnh dài với đá không tròn), ref_mm = cỡ vẽ.
//   Thứ tự vẽ BG < Costume < Pet (LAYER_IDS).
export const FORMAT = 'stonemap-design/1';
export const LAYER_IDS = ['bg', 'costume', 'pet'];
export const STONE_KEYS = ['id', 'layer', 'code', 'shape', 'x_mm', 'y_mm', 'phys_mm', 'ref_mm', 'rot_deg', 'locked', 'source'];

export function newDesign({ id, w_mm, h_mm, catalogVersion, layers = ['bg'] }) {
  return { format: FORMAT, id, canvas: { w_mm, h_mm }, catalogVersion, layers: layers.map((l) => ({ id: l, stones: [] })), symbols: {} };
}

export const allStones = (d) => d.layers.flatMap((l) => l.stones);

// Lỗi cấu trúc (không phải QC sản xuất): trả [] nếu hợp lệ.
export function validate(d) {
  const err = [];
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!d || d.format !== FORMAT) err.push(`format phải là ${FORMAT}`);
  if (!d?.id || typeof d.id !== 'string') err.push('thiếu id');
  if (!(fin(d?.canvas?.w_mm) && d.canvas.w_mm > 0 && fin(d.canvas.h_mm) && d.canvas.h_mm > 0)) err.push('canvas.w_mm/h_mm phải > 0');
  if (!d?.catalogVersion) err.push('thiếu catalogVersion');
  if (!Array.isArray(d?.layers) || !d.layers.length) return [...err, 'layers rỗng'];
  const seenL = new Set(), seenS = new Set();
  let last = -1;
  for (const l of d.layers) {
    const li = LAYER_IDS.indexOf(l.id);
    if (li < 0) err.push(`layer lạ ${l.id}`);
    if (seenL.has(l.id)) err.push(`layer trùng ${l.id}`);
    if (li >= 0 && li < last) err.push(`layer ${l.id} sai thứ tự (bg < costume < pet)`);
    seenL.add(l.id); last = Math.max(last, li);
    for (const s of l.stones || []) {
      const at = `stone ${s?.id ?? '?'}`;
      if (!s?.id) err.push(`${at}: thiếu id`);
      else if (seenS.has(s.id)) err.push(`${at}: id trùng`);
      seenS.add(s?.id);
      if (s.layer !== l.id) err.push(`${at}: layer ${s.layer} ≠ ${l.id}`);
      if (!s.code) err.push(`${at}: thiếu code`);
      if (!s.shape) err.push(`${at}: thiếu shape`);
      for (const k of ['x_mm', 'y_mm', 'phys_mm', 'ref_mm', 'rot_deg']) if (!fin(s[k])) err.push(`${at}: ${k} không phải số`);
      if (!(s.phys_mm > 0 && s.ref_mm > 0)) err.push(`${at}: cỡ phải > 0`);
      if (typeof s.locked !== 'boolean') err.push(`${at}: locked phải boolean`);
      if (fin(s.x_mm) && d.canvas && (s.x_mm < 0 || s.y_mm < 0 || s.x_mm > d.canvas.w_mm || s.y_mm > d.canvas.h_mm)) err.push(`${at}: tâm ngoài canvas`);
    }
  }
  const used = new Set(allStones(d).map((s) => s.code));
  for (const c of used) if (!d.symbols?.[c]) err.push(`mã ${c} chưa có ký hiệu`);
  return err;
}

// Đếm theo layer & tổng: { total, codes, byCode, byLayer: { id: { total, codes, byCode } } }
export function counts(d) {
  const one = (stones) => {
    const byCode = {};
    for (const s of stones) byCode[s.code] = (byCode[s.code] || 0) + 1;
    return { total: stones.length, codes: Object.keys(byCode).length, byCode };
  };
  return { ...one(allStones(d)), byLayer: Object.fromEntries(d.layers.map((l) => [l.id, one(l.stones)])) };
}

// So 2 design theo id viên: { missing, extra, changed: [{ id, keys }] } (tol = sai số mm/độ chấp nhận cho số).
export function diff(a, b, tol = 0) {
  const A = new Map(allStones(a).map((s) => [s.id, s])), B = new Map(allStones(b).map((s) => [s.id, s]));
  const missing = [...A.keys()].filter((k) => !B.has(k)), extra = [...B.keys()].filter((k) => !A.has(k)), changed = [];
  for (const [id, s] of A) {
    const t = B.get(id);
    if (!t) continue;
    const keys = STONE_KEYS.filter((k) => (typeof s[k] === 'number' ? !(Math.abs(s[k] - t[k]) <= tol) : s[k] !== t[k]));
    if (keys.length) changed.push({ id, keys });
  }
  return { missing, extra, changed, same: !missing.length && !extra.length && !changed.length };
}
