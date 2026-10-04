# KIT-28 (b)(c): chấm pet theo ẢNH (không theo màu đích k-NN của petMap) + ghép summary.md, 0 API.
#   ~/.cache/kit20/venv/bin/python tools/kit28_eval.py [outputs/kit/kit28]
# Mỗi outputs/kit/kit28/<pet>_<P13|P14>/: map.svg (stonemap-svg/1) + work.jpg (ảnh ghép 3543 px) + bom.json + report.json + qc.json.
# ΔE76 ảnh = màu ảnh (trung vị Lab trong đĩa 0.35 × cỡ vật lý quanh tâm) ↔ màu catalog của mã gán, từng viên pet;
# "tối" = viên có L ảnh < 35 (mũi / mắt / lông tối); "đổi" = cùng vị trí (≤ 0.3 mm) mà P13 ≠ P14.
import glob, json, os, re, sys
import cv2
import numpy as np
from scipy.spatial import cKDTree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'outputs', 'kit', 'kit28')
K = 3543 / 300
RE = re.compile(r'<g id="s-[^"]*" data-id="([^"]*)" data-code="([^"]*)" data-layer="([^"]*)" data-shape="([^"]*)" data-phys="([^"]*)"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\)')


def lab_img(im):
    L = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32)
    L[..., 0] *= 100 / 255
    L[..., 1:] -= 128
    return L


def hex_lab(h):
    return lab_img(np.uint8([[[int(h[5:7], 16), int(h[3:5], 16), int(h[1:3], 16)]]]))[0, 0]


def run(dirp):
    rep, bom = json.load(open(os.path.join(dirp, 'report.json'))), json.load(open(os.path.join(dirp, 'bom.json')))
    fill = {r['code']: hex_lab(r['fill']) for r in bom['rows']}
    L = lab_img(cv2.imread(os.path.join(dirp, 'work.jpg')))
    H, W = L.shape[:2]
    st = []
    for m in RE.finditer(open(os.path.join(dirp, 'map.svg')).read()):
        _, code, layer, shape, phys, x, y = m.groups()
        if layer != 'pet':
            continue
        x, y, phys = float(x) * K, float(y) * K, float(phys)
        r = max(2.0, 0.35 * phys * K)
        x0, x1, y0, y1 = max(0, int(x - r)), min(W, int(x + r) + 1), max(0, int(y - r)), min(H, int(y + r) + 1)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        px = L[y0:y1, x0:x1][(xx - x) ** 2 + (yy - y) ** 2 <= r * r]
        c = np.median(px, axis=0)
        st.append({'x': x / K, 'y': y / K, 'code': code, 'phys': phys, 'L': float(c[0]), 'dE': float(np.linalg.norm(c - fill[code]))})
    dE = np.array([s['dE'] for s in st])
    dark = np.array([s['L'] < 35 for s in st])
    wA = np.array([s['phys'] ** 2 for s in st])  # diện tích viên (8 mm = 8.2 × 2.8 mm)
    out = {'stones': len(st), 'dE76img': round(float(dE.mean()), 2), 'dE76area': round(float((dE * wA).sum() / wA.sum()), 2),
           'darkArea': round(float((dE * wA)[dark].sum() / wA[dark].sum()), 1) if dark.any() else None, 'p90': round(float(np.percentile(dE, 90)), 1), 'pctOver20': round(float(np.mean(dE > 20)) * 100, 1),
           'dark': {'n': int(dark.sum()), 'dE76img': round(float(dE[dark].mean()), 2) if dark.any() else None},
           'big': [{'code': s['code'], 'phys': s['phys'], 'L': round(s['L'], 1), 'dE': round(s['dE'], 1), 'at': [round(s['x'], 1), round(s['y'], 1)]} for s in st if s['phys'] >= 5]}
    return out, st


OPTS = ['P13', 'P14', 'P14g']  # P14g = P14 + --big-max-de 30 (tools/kit28_compose.mjs --tag g)
pets = sorted({os.path.basename(p).rsplit('_', 1)[0] for p in glob.glob(os.path.join(D, '*_P1[34]*')) if not os.path.basename(p).startswith('costume')})
res = {}
for p in pets:
    res[p] = {}
    sts = {}
    for o in OPTS:
        dp = os.path.join(D, f'{p}_{o}')
        if not os.path.exists(os.path.join(dp, 'report.json')):
            continue
        e, sts[o] = run(dp)
        r, q = json.load(open(os.path.join(dp, 'report.json'))), json.load(open(os.path.join(dp, 'qc.json')))['checks']
        res[p][o] = {**e, 'model': r['deltaE76'], 'codes': r['layers']['pet']['codes'], 'byCode': r['layers']['pet']['byCode'], 'new': r['petCodes']['new'],
                     'shared': r['petCodes']['shared'], 'merged': r['petCodes']['mergedFreeToForced'], 'layers': r['stones'], 'product': r['palette']['product'],
                     'keepOut': {k: r['layers']['pet'][k] for k in ('dropped', 'shrunk')}, 'seam': r['seam'], 'bgDropped': r['layers']['background']['droppedNearCostumeOrPet'],
                     'qc': {k: {'status': v['status'], 'msg': v['msg'][:2]} for k, v in q.items()}, 'bigGuard': r.get('bigGuard')}
    for o2 in [o for o in OPTS[1:] if o in sts and 'P13' in sts]:
        A, B = sts['P13'], sts[o2]
        t = cKDTree([[s['x'], s['y']] for s in B])
        same, diff, worse, better, dsum = 0, 0, 0, 0, 0.0
        pairs = {}
        for s in A:
            dd, j = t.query([s['x'], s['y']])
            if dd > 0.3:
                continue
            same += 1
            if B[j]['code'] != s['code']:
                diff += 1
                k = f"{s['code']}→{B[j]['code']}"
                pairs[k] = pairs.get(k, 0) + 1
                g = B[j]['dE'] - s['dE']
                dsum += g
                worse += g > 5
                better += g < -5
        res[p]['P13vs' + o2] = {'matched': same, 'changed': diff, 'worse5': worse, 'better5': better, 'meanDeltaChanged': round(dsum / max(1, diff), 1), 'pairs': dict(sorted(pairs.items(), key=lambda kv: -kv[1]))}
json.dump(res, open(os.path.join(D, 'eval.json'), 'w'), indent=1)

# ── summary.md
flat = json.load(open(os.path.join(D, 'flat_check.json')))
cos = {o: json.load(open(os.path.join(D, f'costume_{o}', 'report.json'))) for o in ('P13', 'P14')}
md = ['# KIT-28 — 3-layer Queen product (Starry + Queen KIT-27 costume + pet), P13 vs P14', '',
      '$0 API. Generated by `tools/kit28_flat.py`, `tools/kit20.mjs --force-codes`, `tools/kit28_compose.mjs`, `tools/kit28_eval.py`.', '',
      '## (a) Layers come from the template, not from a flat final', '',
      f"- v3 royal-starry finals checked: {flat['n']}. Painting = khung tứ giác nắn thẳng, aspect {flat['finals'][0]['paintingAspect']} (dọc) → cover-fit vuông cắt {flat['finals'][0]['squareCropLostPct']} % chiều cao.",
      f"- Trang phục trong final vs `Trang phục Queen.png` (vùng trắng của mask): ΔE76 trung vị {flat['median']['costume.meanDE76']}, {flat['median']['costume.pctDE_gt20']} % px lệch > 20; đỏ {flat['median']['costumeRedPct']} % vs mẫu {flat['reference']['template']['costume']['red']} %, xanh dương {flat['median']['costumeBluePct']} % vs mẫu {flat['reference']['template']['costume']['blue']} %.",
      f"- Nền final vs `BG.png` (vùng đen): ΔE76 trung vị {flat['median']['background.meanDE76_vsStarry']}; ô mặt: {flat['median']['faceSlot.meanDE76']}.",
      '- ⇒ Ảnh final là 1 bức tranh AI vẽ lại cả trang phục (áo xanh, vương miện khác chỗ, đầu pet to hơn ô): không tách layer ngược được. KIT compose lấy layer từ `kit/templates/queen_mask.png` + ảnh mặt pet đặt vào ô đỏ.', '']
md += ['| pet | opt | pet centre ngoài ô | pet đĩa chạm mép ô (max mm) | trang phục tâm trong ô | pet keepOut bỏ / thu | khe min pet↔trang phục | khe min pet↔nền | nền bỏ (sát) |', '|---|---|---|---|---|---|---|---|---|']
for p in pets:
    for o in OPTS:
        if o not in res[p]:
            continue
        r = res[p][o]
        s = r['seam']
        md.append(f"| {p} | {o} | {s['petCentreOutsideSlot']} | {s['petDiscCrossingSlot']} ({s['petOverflowMaxMm']}) | {s['costumeCentresInSlot']} | {r['keepOut']['dropped']} / {r['keepOut']['shrunk']} | {s['petVsCostume']['minGapMm']} | {s['petVsBackground']['minGapMm']} | {r['bgDropped']} |")
md += ['', '## Costume P13 vs P14 (`tools/kit20.mjs`, cùng mọi bước, chỉ khác bảng)', '']
for o in ('P13', 'P14'):
    c = cos[o]
    md.append(f"- {o}: {len(c['palette']['codes'])} mã [{' '.join(c['palette']['codes'])}], Queen dùng {c['palette']['queenCodesUsed']}, byCode {json.dumps(c['palette']['byCode'])}")
md += ['', '## (b) Pet × option', '',
       '| pet | opt | codes (product) | pet mới | pet mượn (n) | ΔE76 ảnh TB / theo diện tích / p90 / >20 % | ΔE tối TB / diện tích (n) | ΔE model ép / +0 / tự do | viên nền / trang phục / pet | QC code-count / overlap / gap |', '|---|---|---|---|---|---|---|---|---|---|']
for p in pets:
    for o in OPTS:
        if o not in res[p]:
            continue
        r = res[p][o]
        sh = ' '.join(f"{x['code']}({x['n']})" for x in r['shared'])
        q = r['qc']
        md.append(f"| {p} | {o} | {r['product']} | {' '.join(r['new']) or '–'} | {sh} | {r['dE76img']} / {r['dE76area']} / {r['p90']} / {r['pctOver20']} | {r['dark']['dE76img']} / {r['darkArea']} ({r['dark']['n']}) | {r['model']['forced']} / {r['model']['forced0']} / {r['model']['free']} | {r['layers']['background']} / {r['layers']['costume']} / {r['layers']['pet']} | {q['code-count']['status']} / {q['overlap']['status']} / {q['gap']['status']} |")
md += ['', 'Gộp (mã tự do → mã ép, số viên) và viên to ≥ 5 mm của pet:', '']
for p in pets:
    for o in OPTS:
        if o in res[p]:
            r = res[p][o]
            big = ', '.join('%s %smm L%s ΔE%s' % (b['code'], b['phys'], b['L'], b['dE']) for b in r['big']) or '–'
            md.append(f"- {p} {o}: {json.dumps(r['merged'], ensure_ascii=False)}; to: {big}")
    for o2 in OPTS[1:]:
        if 'P13vs' + o2 not in res[p]:
            continue
        v = res[p]['P13vs' + o2]
        md.append(f"- {p} P13→{o2}: {v['changed']}/{v['matched']} viên đổi mã, xấu hơn > 5 ΔE {v['worse5']}, tốt hơn {v['better5']}, ΔE TB đổi {v['meanDeltaChanged']:+}; {json.dumps(v['pairs'], ensure_ascii=False)}")
md += ['', '## (c) P13 → P14: ΔE76 ảnh theo diện tích viên pet (thấp = giống ảnh hơn)', '', '| pet | P13 | P14 | Δ | P14g (--big-max-de 30) | Δ | đổi mã chính P13→P14 |', '|---|---|---|---|---|---|---|']
for p in pets:
    a, b, g = (res[p].get(o, {}).get('dE76area') for o in OPTS)
    pr = ', '.join(f'{k} {v}' for k, v in list(res[p].get('P13vsP14', {}).get('pairs', {}).items())[:3])
    md.append(f"| {p} | {a} | {b} | {b - a:+.2f} | {g if g is not None else '= P14 (không viên ≥ 5 mm)'} | {f'{g - a:+.2f}' if g is not None else ''} | {pr} |")
md += ['', 'Đọc kết quả:',
       '- P14 chỉ lấy 1 chỗ mã pet. Pet nào cần 2 mã riêng (corgi: L17 champagne + L16 vàng hổ phách) thì mất mã thứ 2 → gộp vào L16/L94 (ΔE TB viên đổi +9.5).',
       '- Mã đỏ to dùng chung Q114 8 mm hút viên to tối của pet: mũi + mắt đen corgi (D93/D77 khi tự do) thành 2 viên đỏ 8 mm (ΔE ảnh 75 / 65) vì bảng không có đen và cùng cỡ thắng thu nhỏ. `--big-max-de 30` thu về 2.8 mm như P13 (P14g).',
       '- Xám / đen (grey_cat, pug): P13 dùng chỗ mã thứ 2 cho xanh lá L26/L25 — k-NN (KIT-17) đoán lông xám tối là xanh lá vì catalog 2.8 mm không có xám. ΔE theo đích model thấp nhưng ΔE ảnh cao. P14 bỏ mã đó → ΔE ảnh tốt hơn; cái lợi đến từ việc bỏ 1 lựa chọn tồi của model, không phải từ Q114.',
       '- Trắng (white_cat): mã thứ 2 = Q081 4 mm trắng ↔ L94 2.8 trắng, gần như không đổi (+0.46).',
       '- Bảng chung không có đen, và pet chọn mã mới theo tổng lợi ΔE (fitPalette), nên 5 viên tối (mũi / mắt corgi) thua mảng lông: L93 đen 2.8 có trong catalog nhưng không được chọn ở cả P13 lẫn P14 → mũi / mắt lệch ΔE ≥ 60 ở mọi phương án. Đây là luật chọn mã pet, không phải P13 hay P14.']
open(os.path.join(D, 'summary.md'), 'w').write('\n'.join(md) + '\n')
print(json.dumps({p: {o: [res[p][o]['dE76img'], res[p][o]['dE76area'], res[p][o]['darkArea'], res[p][o]['new']] for o in OPTS if o in res[p]} for p in pets}, ensure_ascii=False))
