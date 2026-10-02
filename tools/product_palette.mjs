// KIT-18 bảng mã chung sản phẩm Queen + Starry: nền + trang phục ≤ 11 mã (chừa 2 cho pet; trần cả sản phẩm 13 lý tưởng / 15 cứng)
//   node tools/product_palette.mjs [--max-codes 11] [--method greedy|merge] [--crystal auto|<mã>|none] [--lock L16,…|none] [--recollect] [--no-build]   (offline, 0 API, ~2 phút)
// 1. viên của từng lớp (lớp vật liệu / cỡ / hình + màu mục tiêu, trước chọn mã) từ chính các tool mẫu: queen_template.mjs --collect,
//    starry_template.mjs --collect (cả hai --palette none = bảng riêng hiện tại = "trước")
// 2. mặc định --method greedy = jointPalette (captain chốt KIT-18: phủ / ΔE / vật liệu ô tim tốt hơn merge; tham lam thêm mã + đổi 1-1),
//    --crystal auto = bắt buộc 1 mã pha lê / đá trắng tròn ≥ 4 mm (D1, D94, W1, Q109 …; mã cho tổng chi phí nhỏ nhất) để viên pha lê
//    trắng giữ đúng vật liệu (không thành ngọc trai); --method merge = mergePalette (gộp tham lam theo map_generator SPEC §2 bước 8: cặp mã chi phí nhỏ nhất
//    (cỡ/2.8)²·[Σ(ΔE²mới − ΔE²cũ) + 25²·n khi hạ cỡ], chỉ xuống cỡ nhỏ hơn; lịch sử gộp + merge_warnings ΔE > 20 vào report);
//    --lock mã khoá không bị gộp đi (mặc định L16 = vàng captain duyệt ở KIT-16, thay L17 xỉn). Cả hai luôn được tính và so trong report
// 3. ghi kit/templates/product_queen_starry_palette.json, rồi dựng lại 2 mẫu với bảng chung (trừ --no-build); báo ΔE trước / sau từng lớp
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCatalog, entryOf } from '../lib/kit/catalog.js';
import { lab, materialOf } from '../lib/kit/select.js';
import { jointPalette, evalPalette, mergePalette } from '../lib/kit/palette.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const maxCodes = +(flag('--max-codes') || 11), method = flag('--method') || 'greedy', crystalArg = flag('--crystal') || 'auto', lockArg = flag('--lock') || 'L16', build = !args.includes('--no-build');
const lock = lockArg === 'none' ? [] : lockArg.split(',');
const TPL = path.join(ROOT, 'kit', 'templates'), OUT = path.join(ROOT, 'outputs', 'kit', 'product_palette'), FILE = path.join(TPL, 'product_queen_starry_palette.json');
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now(), cat = loadCatalog();
const run = (tool, a) => execFileSync(process.execPath, [path.join(ROOT, 'tools', tool), ...a], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 }).toString();
const col = {};
for (const [layer, tool] of [['queen', 'queen_template.mjs'], ['starry', 'starry_template.mjs']]) {
  const f = path.join(OUT, `collect_${layer}.json`);
  if (!fs.existsSync(f) || args.includes('--recollect')) process.stdout.write(run(tool, ['--collect', f, '--palette', 'none']));
  col[layer] = JSON.parse(fs.readFileSync(f, 'utf8'));
}
const recs = [...col.queen.records, ...col.starry.records];
// trước: mỗi lớp với bảng riêng hiện tại của nó (cùng cách tính chi phí)
const before = {};
for (const l of Object.keys(col)) before[l] = { codes: col[l].codes, ...evalPalette(col[l].records, cat, col[l].codes).layers[l] };
const unionBefore = [...new Set(Object.values(col).flatMap((c) => c.codes))];
// mã pha lê trắng: đá trong (tên clear / crystal, không ngọc, không vàng) tròn ≥ 4 mm, L* ≥ 75, C* ≤ 12; auto = thử từng mã làm mã bắt buộc, giữ
// mã tổng chi phí nhỏ nhất. Khi có mã pha lê: pha lê / đá trắng ≥ 4 mm không được thành ngọc trai (crossPenalty cấm) — chỉ thu cỡ cùng tính-đá
const isCrystal = (e) => e && !e.shape && e.kind !== 'pearl' && /clear|crystal/i.test(e.name || '') && materialOf(e) !== 'gold' && e.physMm >= 4 && (([L, a, b]) => L >= 75 && Math.hypot(a, b) <= 12)(lab(e.fill.replace('#', '').match(/\w\w/g).map((v) => parseInt(v, 16))));
if (!['none', 'auto'].includes(crystalArg) && !isCrystal(entryOf(crystalArg, cat))) throw new Error(`--crystal ${crystalArg}: không phải mã đá trắng tròn ≥ 4 mm`);
const crystalTry = crystalArg === 'none' ? [] : crystalArg === 'auto' ? Object.values(cat.codes).filter(isCrystal).map((e) => e.code) : [crystalArg];
const NOCROSS = { crossPenalty: 1e4 };
const crystalRuns = crystalTry.map((c) => ({ crystal: c, ...jointPalette(recs, cat, { maxCodes, fixed: [c], ...NOCROSS }) })).sort((a, b) => a.total - b.total);
const greedyFree = jointPalette(recs, cat, { maxCodes });
const greedy = crystalRuns[0] || greedyFree, crystal = crystalRuns[0]?.crystal || null;
const merged = mergePalette(recs, cat, { maxCodes, lock });
const chosenCodes = method === 'greedy' ? greedy.codes : merged.codes;
// cùng thước đo (chi phí jointPalette, ΔE00 TB) cho cả hai phương án
const costO = method === 'greedy' && crystal ? NOCROSS : {};
const joint = { ...evalPalette(recs, cat, chosenCodes, costO), codes: chosenCodes, swaps: greedy.swaps };
const cmp = Object.fromEntries([['merge', merged.codes], ['greedy', greedy.codes], ...(crystal ? [['greedyNoCrystal', greedyFree.codes]] : [])].map(([k, c]) => { const e = evalPalette(recs, cat, c, k === 'greedy' ? costO : {}); return [k, { codes: c, total: Math.round(e.total), ...Object.fromEntries(Object.entries(e.layers).map(([l, v]) => [l, { meanDE: v.meanDE, meanCost: v.meanCost, reclass: Object.values(v.reclass).reduce((a, x) => a + x, 0) }])) }]; }));
const desc = (c) => { const e = entryOf(c, cat); return { code: c, kind: e.kind, shape: e.shape || 'round', physMm: e.shape ? `${e.physW}x${e.physH}` : e.physMm, hex: e.fill, name: e.name }; };
const pal = { schema: 'pearl-kit-product-palette/1', product: 'queen+starry', layers: ['starry (background)', 'queen (costume)'], maxCodes, reservedForPet: 2, productTarget: 13, productHard: 15,
  method, lock, crystal, crystalTried: crystalRuns.map((r) => ({ code: r.crystal, total: Math.round(r.total) })), codes: joint.codes, entries: joint.codes.map(desc),
  rule: 'min Σ chi phí theo số viên: cùng lớp (vật liệu, cỡ, hình) = ΔE00 tới màu mục tiêu; tròn thu nhỏ cùng tính-ngọc = ΔE + 20 + 2/mm thu (chỗ đó lấp lưới 2.8); đá trắng tròn ≥ 4 mm → ngọc trai trắng cỡ ≤ = ΔE + 12 (cấm khi có mã pha lê --crystal); hình thu nhỏ cùng hình = ΔE + 100·TB|ln tỉ lệ cạnh|; viên có hình đã duyệt luôn giữ hình (bắt buộc 1 mã mỗi hình)',
  before: { union: unionBefore.length, layers: before }, after: joint.layers, compare: cmp,
  merge: { initialCodes: merged.initialCodes, merges: merged.merges, merge_warnings: merged.merge_warnings, layers: merged.layers }, createdAt: new Date().toISOString(), apiCalls: 0, rebuild: 'node tools/product_palette.mjs' };
fs.writeFileSync(FILE, JSON.stringify(pal, null, 1) + '\n');
console.log(`palette (${method}${method === 'merge' && lock.length ? `, lock ${lock}` : ''}${method === 'greedy' && crystal ? `, pha lê ${crystal}` : ''}) ${joint.codes.length} mã: ${joint.codes.join(' ')} → ${FILE}`);
console.log(`  merge: ${merged.initialCodes} → ${merged.codes.length} mã qua ${merged.merges.length} lần gộp, ${merged.merge_warnings.length} cảnh báo ΔE > 20; greedy: ${greedy.codes.join(' ')}`);
for (const [k, v] of Object.entries(cmp)) console.log(`  ${k}: tổng ${v.total}, queen ΔE ${v.queen.meanDE}, starry ΔE ${v.starry.meanDE}`);
for (const l of Object.keys(col)) console.log(`  ${l}: ΔE00 ${before[l].meanDE} → ${joint.layers[l].meanDE}, chi phí ${before[l].meanCost} → ${joint.layers[l].meanCost}, đổi lớp ${Object.values(before[l].reclass).reduce((a, v) => a + v, 0)} → ${Object.values(joint.layers[l].reclass).reduce((a, v) => a + v, 0)} / ${joint.layers[l].stones}`);
if (build) {
  // queen trước: starry --share queen đọc mã từ svg trang phục (giờ đã nằm trong bảng chung)
  process.stdout.write(run('queen_template.mjs', []));
  process.stdout.write(run('starry_template.mjs', []));
}
console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s · 0 API calls`);
