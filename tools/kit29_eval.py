# KIT-29: chấm pet theo ẢNH cho 4 pet × P13/P14 (luật pet mới) so với KIT-28 + compare_P13_P14.png + summary.md, 0 API.
#   ~/.cache/kit20/venv/bin/python tools/kit29_eval.py [outputs/kit/kit29] [outputs/kit/kit28]
# ΔE76 ảnh như tools/kit28_eval.py (trung vị Lab ảnh trong đĩa 0.35 × cỡ vật lý ↔ màu catalog, theo diện tích viên);
# lạc màu = viên pet ΔE76 ảnh > 30; xanh chroma = px ô mặt của work.jpg có G − max(R, B) > 40 (nền cutout lộ ra).
import json, os, re, sys
import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'outputs', 'kit', 'kit29')
D28 = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'outputs', 'kit', 'kit28')
K = 3543 / 300
RE = re.compile(r'<g id="s-[^"]*" data-id="([^"]*)" data-code="([^"]*)" data-layer="([^"]*)" data-shape="([^"]*)" data-phys="([^"]*)"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\)')
PETS = [l.split('|')[0] for l in open(os.path.join(D, 'pets.txt')).read().split('\n') if l.strip()]
OPTS = ['P13', 'P14']
mk = cv2.imread(os.path.join(ROOT, 'kit', 'templates', 'queen_mask.png'))


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
    im = cv2.imread(os.path.join(dirp, 'work.jpg'))
    L = lab_img(im)
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
        c = np.median(L[y0:y1, x0:x1][(xx - x) ** 2 + (yy - y) ** 2 <= r * r], axis=0)
        st.append({'code': code, 'phys': phys, 'L': float(c[0]), 'dE': float(np.linalg.norm(c - fill[code]))})
    dE, wA = np.array([s['dE'] for s in st]), np.array([s['phys'] ** 2 for s in st])
    dark = np.array([s['L'] < 35 for s in st])
    m = cv2.resize(mk, (W, H), interpolation=cv2.INTER_NEAREST).astype(int)
    slot = (m[..., 2] > 150) & (m[..., 1] < 100) & (m[..., 0] < 100)
    b, g, rr = [im[..., i].astype(int) for i in range(3)]
    green = slot & (g - np.maximum(rr, b) > 40)
    sizes = {}
    for s in st:
        sizes[s['phys']] = sizes.get(s['phys'], 0) + 1
    return {'stones': len(st), 'dE76area': round(float((dE * wA).sum() / wA.sum()), 2), 'p90': round(float(np.percentile(dE, 90)), 1),
            'offColour': int((dE > 30).sum()), 'darkArea': round(float((dE * wA)[dark].sum() / wA[dark].sum()), 1) if dark.any() else None,
            'greenSlotPct': round(float(green.sum() / slot.sum()) * 100, 2), 'sizes': {str(k): v for k, v in sorted(sizes.items())},
            'added': rep['palette']['petAdded'], 'byCode': rep['layers']['pet']['byCode'], 'select': (rep.get('kit29') or {}).get('select'),
            'chroma': (rep.get('kit29') or {}).get('chroma'), 'qc': {k: v['status'] for k, v in rep['qc'].items()}, 'product': rep['palette']['product']}


res = {p: {o: {'kit29': run(os.path.join(D, f'{p}_{o}')), 'kit28': run(os.path.join(D28, f'{p}_{o}')) if os.path.exists(os.path.join(D28, f'{p}_{o}', 'report.json')) else None}
           for o in OPTS} for p in PETS}
json.dump(res, open(os.path.join(D, 'eval.json'), 'w'), indent=1)


# ── compare_P13_P14.png: 4 hàng (pet) × 2 cột (P13 | P14), crop ô mặt của mockup (nửa phải face.png); compare_kit28_kit29.png: KIT-28 | KIT-29 × P13/P14
def mock_half(dirp):
    f = cv2.imread(os.path.join(dirp, 'face.png'))
    w = (f.shape[1] - 8) // 2
    return f[:, w + 8:]


def label(im, txt, sub=''):
    im = im.copy()
    for t, y, s in ((txt, 34, 1.0), (sub, 66, 0.7)):
        if t:
            cv2.putText(im, t, (10, y), cv2.FONT_HERSHEY_SIMPLEX, s, (0, 0, 0), 5, cv2.LINE_AA)
            cv2.putText(im, t, (10, y), cv2.FONT_HERSHEY_SIMPLEX, s, (255, 255, 255), 2, cv2.LINE_AA)
    return im


def grid(cols, name):
    rows = []
    for p in PETS:
        cells = []
        for rules, o in cols:
            dp = os.path.join(D if rules == 'kit29' else D28, f'{p}_{o}')
            e = res[p][o][rules]
            cells.append(label(mock_half(dp), f'{p} {o}' + ('' if rules == 'kit29' else ' (KIT-28)'), f"+{' '.join(e['added'])}  dE {e['dE76area']}  >30: {e['offColour']}"))
        h = min(c.shape[0] for c in cells)
        rows.append(np.hstack(sum([[c[:h], np.full((h, 8, 3), 255, np.uint8)] for c in cells], [])[:-1]))
    w = min(r.shape[1] for r in rows)
    cv2.imwrite(os.path.join(D, name), np.vstack(sum([[r[:, :w], np.full((8, w, 3), 255, np.uint8)] for r in rows], [])[:-1]))


grid([('kit29', 'P13'), ('kit29', 'P14')], 'compare_P13_P14.png')
grid([('kit28', 'P13'), ('kit29', 'P13'), ('kit28', 'P14'), ('kit29', 'P14')], 'compare_kit28_kit29.png')

# ── summary.md
cost = {o: json.load(open(os.path.join(D, f'costume_{o}', 'report.json'))) for o in OPTS}
md = ['# KIT-29 — luật mã pet + P14 trang phục không mất cánh hoa', '',
      '$0 API. `tools/kit20.mjs` (rescue), `tools/kit28_compose.mjs --rules kit29`, `tools/kit29_eval.py`. Ảnh: `compare_P13_P14.png` (ô mặt, 4 hàng × P13 | P14), `compare_kit28_kit29.png` (KIT-28 | KIT-29 × P13 / P14).', '',
      '## Trang phục P13 vs P14', '', '| mã | ' + ' | '.join(OPTS) + ' |', '|---|' + '---|' * len(OPTS)]
for c in sorted(set().union(*[cost[o]['palette']['byCode'] for o in OPTS]), key=lambda c: -cost['P13']['palette']['byCode'].get(c, 0)):
    md.append(f'| {c} | ' + ' | '.join(str(cost[o]['palette']['byCode'].get(c, 0)) for o in OPTS) + ' |')
md += ['', 'Rescue P14: ' + '; '.join(f"{f['from']}→{f['to']} @({f['x'] / K:.0f},{f['y'] / K:.0f}) mm trả {len(f['frees'])} {'/'.join(sorted(set(f['frees'])))}" for f in cost['P14']['kit29']['rescue']['forced']), '',
       '## Pet: ΔE76 ảnh theo diện tích (thấp = giống ảnh), lạc màu (> 30), xanh chroma trong ô mặt', '',
       '| pet | bảng | mã pet thêm | ΔE76 diện tích | p90 | lạc màu | ΔE vùng tối | cỡ viên | xanh ô mặt % | KIT-28: thêm / ΔE / lạc / xanh % |', '|---|---|---|---|---|---|---|---|---|---|']
for p in PETS:
    for o in OPTS:
        a, b = res[p][o]['kit29'], res[p][o]['kit28']
        old = f"{' '.join(b['added'])} / {b['dE76area']} / {b['offColour']} / {b['greenSlotPct']}" if b else '–'
        md.append(f"| {p} | {o} | {' '.join(a['added'])} | {a['dE76area']} | {a['p90']} | {a['offColour']} | {a['darkArea']} | {' '.join(f'{k}×{v}' for k, v in a['sizes'].items())} | {a['greenSlotPct']} | {old} |")
md += ['', '## Chọn mã thêm (ΔE ảnh × diện tích giảm được, hỗ trợ = % diện tích pet (viên tối ×3) mà mã hợp hue và ΔE ≤ mã gần nhất catalog + 12, cần ≥ 2 %)', '']
for p in PETS:
    for o in OPTS:
        s = res[p][o]['kit29']['select']
        if s:
            md.append(f"- {p} {o}: " + ' · '.join('vòng %d: %s' % (i + 1, ', '.join('%s %s(%s %%)%s' % (t['code'], t['gain'], t['support'], '' if t['ok'] else ' ✗') for t in r['top'][:4])) for i, r in enumerate(s['rounds'])) + f" · gate đổi {s['gated']} viên, không mã hợp {s.get('noFit', 0)}")
open(os.path.join(D, 'summary.md'), 'w').write('\n'.join(md) + '\n')
print(json.dumps({p: {o: {k: res[p][o]['kit29'][k] for k in ('added', 'dE76area', 'offColour', 'greenSlotPct', 'sizes')} for o in OPTS} for p in PETS}))
