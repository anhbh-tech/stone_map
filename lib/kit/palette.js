// KIT-18 bảng mã chung sản phẩm (nhiều lớp: nền + trang phục [+ pet]) — 1 tập ≤ maxCodes mã cho mọi lớp, min Σ chi phí có trọng số
// số viên. Viên = lớp (vật liệu, cỡ, hình) + màu mục tiêu; chi phí viên ← mã:
//   cùng lớp = ΔE00 (vàng: deGold theo goldWL của lớp); tròn sang mã nhỏ hơn cùng tính-ngọc = ΔE + shrinkPenalty (20; chỗ đó lấp lưới 2.8);
//   đá trắng tròn ≥ 4 mm sang ngọc trai trắng cỡ ≤ = ΔE + crossPenalty (12);
//   có hình sang mã cùng hình vừa trong hình cũ = ΔE + 100·TB|ln tỉ lệ cạnh|; hình nhỏ (≤ 8 mm) → 1 viên tròn = ΔE + 40;
//   khác = không được (lớp không mã nào → UNCOV; viên có hình to → UNCOV_SHAPE = bắt buộc giữ hình).
// Chọn: tham lam (như chooseCodes) rồi đổi 1-1 (swap) tới khi không giảm. Ra mã + thống kê từng lớp.
import { entryOf } from './catalog.js';
import { lab, materialOf, deGoldF } from './select.js';
import { de2000 } from './place.js';

const hex2 = (h) => h.replace('#', '').match(/\w\w/g).map((v) => parseInt(v, 16));
const UNCOV = 1e3, UNCOV_SHAPE = 1e5; // viên có hình (đã duyệt) không có mã cùng hình: coi như bắt buộc

// viên mapCostume (hook o.onStones, trước chọn mã) → bản ghi gọn ghi JSON được; one = oneMaterial của lớp, gwl = goldWL
export function stoneRecords(placed, cat, { layer, one = false, gwl = 1 } = {}) {
  return placed.map((s) => {
    const e = s.fixedCode ? entryOf(s.fixedCode, cat) : null;
    const mat = e ? materialOf(e) : s.mat, shape = e?.shape || s.shape || null;
    return { layer, mat, physMm: e ? e.physMm : s.physMm, ...(shape && { shape, w: e ? e.physW : s.w, h: e ? e.physH : s.h }), from: s.from, fixed: s.fixedCode || undefined,
      t: s.target.map((v) => Math.round(v * 10) / 10), one, gwl };
  });
}

export function stoneCost(s, e, el, { shrinkPenalty = 20, crossPenalty = 12, shapeToRound = 40, smallShapeMm = 8 } = {}) {
  const dE = (s.mat === 'gold' ? deGoldF(s.gwl ?? 1) : de2000)(s.t, el);
  const white = s.t[0] >= 70 && Math.hypot(s.t[1], s.t[2]) <= 15;
  if (s.shape) {
    // hình nhỏ (cạnh dài ≤ smallShapeMm, vd marquise 4×8) được thành 1 viên tròn ≥ 4 mm vừa bề ngang (+1) — phạt shapeToRound
    if (!e.shape && Math.max(s.w, s.h) <= smallShapeMm && e.physMm >= 4 && e.physMm <= Math.min(s.w, s.h) + 1 && (e.kind !== 'pearl' || white)) return [dE + shapeToRound, false, dE];
    if (e.shape !== s.shape || e.physW > s.w + 1e-6 || e.physH > s.h + 1e-6) return [Infinity, false];
    const same = Math.abs(e.physW - s.w) < 1e-6 && Math.abs(e.physH - s.h) < 1e-6;
    return [dE + (same ? 0 : (100 * (Math.abs(Math.log(e.physW / s.w)) + Math.abs(Math.log(e.physH / s.h)))) / 2), same, dE];
  }
  if (e.shape) return [Infinity, false];
  const sameKind = (e.kind === 'pearl') === (s.mat === 'pearl');
  const cls = Math.abs(e.physMm - s.physMm) < 1e-6 && (s.one && s.mat !== 'pearl' ? e.kind !== 'pearl' : materialOf(e) === s.mat);
  if (cls) return [dE, true, dE];
  if (sameKind && e.physMm < s.physMm - 1e-6) return [dE + shrinkPenalty, false, dE];
  // pha lê / đá trắng tròn ≥ 4 mm không có mã cùng lớp: ngọc trai trắng cỡ ≤ (vẫn 1 viên tròn trắng) — phạt crossPenalty
  if (e.kind === 'pearl' && s.mat !== 'gold' && s.physMm >= 4 && e.physMm <= s.physMm + 1e-6 && white) return [dE + crossPenalty, false, dE];
  return [Infinity, false];
}

// records [{layer, mat, physMm, shape?, w?, h?, t, one, gwl}] → { codes, total, layers: {name: {stones, meanDE, meanCost, keptClass, reclass}} }
// o = { maxCodes (11), cands (mã xét, mặc định mọi mã tròn + mọi mã hình), fixed (mã bắt buộc), shrinkPenalty, swap (true) }
export function jointPalette(records, cat, o = {}) {
  const maxCodes = o.maxCodes ?? 11;
  const cands = (o.cands || [...Object.keys(cat.codes), ...Object.keys(cat.shaped || {})]).map((c) => entryOf(c, cat)).filter(Boolean);
  const cl = cands.map((e) => lab(hex2(e.fill)));
  // gộp viên cùng (lớp, vật liệu, cỡ, hình, màu làm tròn 1 Lab) → trọng số
  const grp = new Map();
  for (const s of records) {
    const k = [s.layer, s.mat, s.physMm, s.shape || '', s.w || '', s.h || '', s.one ? 1 : 0, s.gwl, ...s.t.map((v) => Math.round(v))].join('|');
    const g = grp.get(k); if (g) g.n++; else grp.set(k, { s, n: 1 });
  }
  const G = [...grp.values()], nG = G.length, nC = cands.length, cost = new Float64Array(nG * nC), dEm = new Float64Array(nG * nC), keepM = new Uint8Array(nG * nC);
  const unc = G.map((g) => (g.s.shape ? UNCOV_SHAPE : UNCOV));
  G.forEach((g, i) => cands.forEach((e, j) => { const [c, same, dE] = stoneCost(g.s, e, cl[j], o); cost[i * nC + j] = Math.min(c, unc[i]); dEm[i * nC + j] = dE ?? NaN; keepM[i * nC + j] = same ? 1 : 0; }));
  const total = (set) => { let t = 0; for (let i = 0; i < nG; i++) { let b = unc[i]; for (const j of set) b = Math.min(b, cost[i * nC + j]); t += b * G[i].n; } return t; };
  const chosen = (o.fixed || []).map((c) => cands.findIndex((e) => e.code === c)).filter((j) => j >= 0);
  const cur = Float64Array.from(unc);
  const take = (j) => { chosen.push(j); for (let i = 0; i < nG; i++) cur[i] = Math.min(cur[i], cost[i * nC + j]); };
  for (const j of [...chosen.splice(0)]) take(j);
  while (chosen.length < maxCodes) {
    let best = -1, bg = 0;
    for (let j = 0; j < nC; j++) {
      if (chosen.includes(j)) continue;
      let gain = 0;
      for (let i = 0; i < nG; i++) { const v = cost[i * nC + j]; if (v < cur[i]) gain += (cur[i] - v) * G[i].n; }
      if (gain > bg) { bg = gain; best = j; }
    }
    if (best < 0) break;
    take(best);
  }
  let tot = total(chosen), swaps = 0;
  if (o.swap !== false) for (let improved = true, pass = 0; improved && pass < 6; pass++) {
    improved = false;
    for (let a = 0; a < chosen.length; a++) {
      if ((o.fixed || []).includes(cands[chosen[a]].code)) continue;
      for (let j = 0; j < nC; j++) {
        if (chosen.includes(j)) continue;
        const trial = chosen.slice(); trial[a] = j;
        const t = total(trial);
        if (t < tot - 1e-6) { tot = t; chosen[a] = j; improved = true; swaps++; }
      }
    }
  }
  return { codes: chosen.map((j) => cands[j].code), total: tot, swaps, layers: evalLayers(G, cands, chosen, cost, dEm, keepM, nC, unc) };
}

function evalLayers(G, cands, chosen, cost, dEm, keepM, nC, unc) {
  const L = {};
  G.forEach((g, i) => {
    let bj = -1, b = Infinity;
    for (const j of chosen) if (cost[i * nC + j] < b) { b = cost[i * nC + j]; bj = j; }
    const r = (L[g.s.layer] ||= { stones: 0, sumDE: 0, sumCost: 0, keptClass: 0, reclass: {}, uncovered: 0, byCode: {} });
    r.stones += g.n;
    if (bj < 0 || b >= unc[i]) { r.uncovered += g.n; return; }
    r.sumDE += dEm[i * nC + bj] * g.n; r.sumCost += b * g.n; r.byCode[cands[bj].code] = (r.byCode[cands[bj].code] || 0) + g.n;
    if (keepM[i * nC + bj]) r.keptClass += g.n;
    else { const e = cands[bj], k = `${g.s.mat}${g.s.shape ? ` ${g.s.shape} ${g.s.w}x${g.s.h}` : ` ${g.s.physMm}`} → ${e.code} ${e.shape ? `${e.physW}x${e.physH}` : e.physMm}`; r.reclass[k] = (r.reclass[k] || 0) + g.n; }
  });
  for (const r of Object.values(L)) { r.meanDE = +(r.sumDE / Math.max(1, r.stones - r.uncovered)).toFixed(2); r.meanCost = +(r.sumCost / Math.max(1, r.stones - r.uncovered)).toFixed(2); delete r.sumDE; delete r.sumCost; }
  return L;
}

// đánh giá 1 tập mã cố định (vd bảng riêng của từng lớp hiện tại) cùng cách tính
export function evalPalette(records, cat, codes, o = {}) {
  return jointPalette(records, cat, { ...o, cands: codes, fixed: codes, maxCodes: codes.length, swap: false });
}

// viên to đã duyệt (kit/templates/<name>_big.json) → mã trong pool: cùng lớp rẻ nhất, không thì nhỏ hơn cùng hình / cùng tính-ngọc
// (≥ minMm, viên tròn), màu lệch ≤ maxDE ΔE00 (20: đá đỏ 8 không thành vàng 4); không có → bỏ (chỗ đó lấp lưới). Trả [{ id, from, to | null, why }]
export function remapBig(stones, pool, cat, { minMm = 4, maxDE = 20, ...co } = {}) {
  const P = pool.map((c) => entryOf(c, cat)).filter(Boolean);
  return stones.map((s) => {
    const e0 = entryOf(s.code, cat);
    if (pool.includes(s.code)) return { id: s.id, from: s.code, to: s.code };
    const rec = { mat: materialOf(e0), physMm: e0.physMm, ...(e0.shape && { shape: e0.shape, w: e0.physW, h: e0.physH }), t: lab(hex2(e0.fill)), gwl: 0 };
    const best = P.map((e) => [...stoneCost(rec, e, lab(hex2(e.fill)), co), e]).filter(([c, , dE, e]) => Number.isFinite(c) && dE <= maxDE && (e.shape || e.physMm >= minMm)).map(([c, , , e]) => [c, e]).sort((a, b) => a[0] - b[0])[0];
    return best ? { id: s.id, from: s.code, to: best[1].code, why: e0.shape ? 'shape-size' : 'smaller' } : { id: s.id, from: s.code, to: null, why: 'no-class' };
  });
}

// KIT-18b gộp tham lam (theo map_generator SPEC §2 bước 8, viết lại): mỗi viên bắt đầu ở mã catalog tốt nhất cùng lớp (không lớp nào →
// mã rẻ nhất theo stoneCost); mỗi vòng gộp cặp mã (a → b) chi phí nhỏ nhất tới khi ≤ maxCodes:
//   chi phí = (cỡ a / 2.8)² · [Σ(ΔE00² mới − ΔE00² cũ) + downPenalty² · số viên nếu b nhỏ hơn a], chỉ cùng loại (ngọc / đá) + cùng hình,
//   b không lớn hơn a (viên hình: cả 2 cạnh); ΔE00 trung bình của viên bị gộp > warnDE → merge_warnings. Trả mã + lịch sử gộp.
export function mergePalette(records, cat, o = {}) {
  // o.lock = mã khoá (SPEC roadmap P1: vd vàng chủ đạo L16 captain đã duyệt ở KIT-16) — không bao giờ bị gộp đi, viên khác gộp vào được
  const maxCodes = o.maxCodes ?? 11, pen = (o.downPenalty ?? 25) ** 2, warnDE = o.warnDE ?? 20, lock = new Set(o.lock || []);
  const all = [...Object.values(cat.codes), ...Object.values(cat.shaped || {})], labOf = new Map(all.map((e) => [e.code, lab(hex2(e.fill))]));
  const grp = new Map();
  for (const s of records) {
    const k = [s.layer, s.mat, s.physMm, s.shape || '', s.w || '', s.h || '', s.one ? 1 : 0, s.gwl, ...s.t.map((v) => Math.round(v))].join('|');
    const g = grp.get(k); if (g) g.n++; else grp.set(k, { s, n: 1 });
  }
  const G = [...grp.values()], dist = (s, c) => (s.mat === 'gold' ? deGoldF(s.gwl ?? 1) : de2000)(s.t, labOf.get(c));
  // khởi đầu: cùng lớp rẻ nhất, không có thì rẻ nhất theo stoneCost (thu cỡ / đổi hình)
  const asg = G.map((g) => {
    let best = null, bc = Infinity, bf = null, bfc = Infinity;
    for (const e of all) { const [c, same] = stoneCost(g.s, e, labOf.get(e.code), o); if (!Number.isFinite(c)) continue; if (same && c < bc) { bc = c; best = e.code; } if (c < bfc) { bfc = c; bf = e.code; } }
    return best || bf;
  });
  const cur = G.map((g, i) => (asg[i] ? dist(g.s, asg[i]) : NaN));
  const init = { codes: new Set(asg.filter(Boolean)).size };
  const shapeOf = (c) => entryOf(c, cat).shape || 'round';
  const merges = [], warnings = [], cache = new Map();
  for (;;) {
    const used = [...new Set(asg.filter(Boolean))];
    if (used.length <= maxCodes) break;
    const mem = new Map(used.map((c) => [c, []]));
    asg.forEach((c, i) => c && mem.get(c).push(i));
    let best = null;
    for (const a of used) {
      if (lock.has(a)) continue;
      const ea = entryOf(a, cat);
      for (const b of used) {
        if (a === b) continue;
        const eb = entryOf(b, cat);
        if ((ea.kind === 'pearl') !== (eb.kind === 'pearl') || shapeOf(a) !== shapeOf(b)) continue;
        if (ea.shape ? eb.physW > ea.physW + 1e-6 || eb.physH > ea.physH + 1e-6 : eb.physMm > ea.physMm + 1e-6) continue;
        const key = `${a}>${b}`;
        let v = cache.get(key);
        if (!v) {
          let d2 = 0, n = 0, sd = 0;
          for (const i of mem.get(a)) { const d = dist(G[i].s, b); d2 += G[i].n * (d * d - cur[i] * cur[i]); n += G[i].n; sd += G[i].n * d; }
          const smaller = ea.shape ? eb.physW < ea.physW - 1e-6 || eb.physH < ea.physH - 1e-6 : eb.physMm < ea.physMm - 1e-6;
          v = { cost: (ea.physMm / 2.8) ** 2 * (d2 + (smaller ? pen * n : 0)), n, avg: sd / Math.max(1, n) };
          cache.set(key, v);
        }
        if (!best || v.cost < best.cost) best = { ...v, a, b };
      }
    }
    if (!best) { warnings.push(`không gộp thêm được (${used.length} mã)`); break; }
    for (const i of mem.get(best.a)) { asg[i] = best.b; cur[i] = dist(G[i].s, best.b); }
    for (const k of [...cache.keys()]) { const [x, y] = k.split('>'); if (x === best.a || y === best.a || x === best.b || y === best.b) cache.delete(k); }
    merges.push({ from: best.a, to: best.b, stones: best.n, avgDE: +best.avg.toFixed(2), cost: Math.round(best.cost) });
    if (best.avg > warnDE) warnings.push(`${best.a}->${best.b} ΔE=${best.avg.toFixed(1)} (${best.n} viên)`);
  }
  const codes = [...new Set(asg.filter(Boolean))], L = {};
  G.forEach((g, i) => {
    const r = (L[g.s.layer] ||= { stones: 0, sumDE: 0, sumDE2: 0, byCode: {}, unassigned: 0 });
    r.stones += g.n;
    if (!asg[i]) { r.unassigned += g.n; return; }
    r.sumDE += cur[i] * g.n; r.sumDE2 += cur[i] * cur[i] * g.n; r.byCode[asg[i]] = (r.byCode[asg[i]] || 0) + g.n;
  });
  for (const r of Object.values(L)) { const k = Math.max(1, r.stones - r.unassigned); r.meanDE = +(r.sumDE / k).toFixed(2); r.rmsDE = +Math.sqrt(r.sumDE2 / k).toFixed(2); delete r.sumDE; delete r.sumDE2; }
  return { codes, initialCodes: init.codes, merges, merge_warnings: warnings, layers: L };
}
