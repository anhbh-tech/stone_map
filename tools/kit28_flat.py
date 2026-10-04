# KIT-28 (a): tách layer từ ảnh final phẳng của pipeline v2/v3 có được không? (0 API, chỉ đọc ~/pearl_compare/outputs)
# Ảnh final royal-starry = cảnh lifestyle, tranh nằm trong khung tứ giác QUAD (px template 2048, outputs/templates/royal-starry_*) →
# nắn tứ giác về chữ nhật (tranh dọc 787×1122) → cover-fit vào ô vuông 300 mm như renderLayers (cắt giữa) → so với mẫu trang phục
# KIT (Trang phục Queen.png + kit/templates/queen_mask.png: đen nền / trắng trang phục / đỏ ô mặt) trong vùng trắng.
#   ~/.cache/kit20/venv/bin/python tools/kit28_flat.py [--out outputs/kit/kit28]
import glob, json, os, sys
import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(ROOT, 'outputs', 'kit', 'kit28')
SRC = os.path.expanduser('~/pearl_compare/outputs')
REQ = os.environ.get('KIT_REQ', os.path.expanduser('~/pearl_compare/requirements'))
QUAD = np.float32([[821, 531], [1608, 530], [1612, 1652], [821, 1654]])  # royal-starry_2026-09-30T09-08-08-750Z_mask.png, px 2048
N = 1254

tpl = cv2.imread(os.path.join(REQ, 'Trang phục Queen.png'))
starry = cv2.resize(cv2.imread(os.path.join(REQ, 'BG.png')), (N, N), interpolation=cv2.INTER_AREA)  # nền Starry (cùng khung 300 mm)
mk = cv2.resize(cv2.imread(os.path.join(ROOT, 'kit', 'templates', 'queen_mask.png')), (N, N), interpolation=cv2.INTER_NEAREST)
b, g, r = [mk[..., i].astype(int) for i in range(3)]
costume, face, bg = (r > 150) & (g > 150) & (b > 150), (r > 150) & (g < 100) & (b < 100), (r < 100) & (g < 100) & (b < 100)


def lab(im):
    L = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32)
    L[..., 0] *= 100 / 255
    L[..., 1:] -= 128
    return L


def hues(L, sel):
    a, bb = L[..., 1][sel], L[..., 2][sel]
    C, h = np.hypot(a, bb), np.degrees(np.arctan2(bb, a)) % 360
    col = C >= 20
    # đỏ: h 0–45 / 330–360 (a > 0), xanh dương: h 230–300 (b < 0, a ≈ 0)
    return {'red': round(float(np.mean(col & ((h < 45) | (h > 330)))) * 100, 1), 'blue': round(float(np.mean(col & (h > 230) & (h < 300))) * 100, 1)}


TL, SL = lab(tpl), lab(starry)
rows = []
for f in sorted(glob.glob(os.path.join(SRC, '*_final_royal-starry.jpg'))):
    im = cv2.imread(f)
    s = im.shape[1] / 2048
    pw, ph = 787, 1122
    M = cv2.getPerspectiveTransform(QUAD * s, np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]]))
    paint = cv2.warpPerspective(im, M, (pw, ph))
    y0 = (ph - pw) // 2
    sq = cv2.resize(paint[y0:y0 + pw], (N, N), interpolation=cv2.INTER_AREA)  # cover-fit vuông, cắt giữa
    PL = lab(sq)
    dE, dS = np.linalg.norm(PL - TL, axis=2), np.linalg.norm(PL - SL, axis=2)
    rows.append({'final': os.path.basename(f), 'px': im.shape[1], 'paintingAspect': round(pw / ph, 3), 'squareCropLostPct': round((1 - pw / ph) * 100, 1),
                 'costume': {'meanDE76': round(float(dE[costume].mean()), 1), 'pctDE_gt20': round(float(np.mean(dE[costume] > 20)) * 100, 1), 'final': hues(PL, costume)},
                 'faceSlot': {'meanDE76': round(float(dE[face].mean()), 1)}, 'background': {'meanDE76_vsStarry': round(float(dS[bg].mean()), 1), 'final': hues(PL, bg)}})
    if len(rows) == 1 or 'T06-30-07' in f:
        over = sq.copy()
        cnt, _ = cv2.findContours(costume.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(over, cnt, -1, (255, 255, 255), 3)
        cf, _ = cv2.findContours(face.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(over, cf, -1, (0, 0, 255), 4)
        t2 = tpl.copy(); cv2.drawContours(t2, cf, -1, (0, 0, 255), 4)
        cv2.imwrite(os.path.join(OUT, 'flat_' + os.path.basename(f)[:24] + '.jpg'), cv2.resize(np.hstack([t2, over]), (1254, 627)), [cv2.IMWRITE_JPEG_QUALITY, 85])
ref = {'template': {'costume': hues(TL, costume)}, 'starry': {'background': hues(SL, bg)}}
agg = {k: round(float(np.median([r[k.split('.')[0]][k.split('.')[1]] for r in rows])), 1) for k in ['costume.meanDE76', 'costume.pctDE_gt20', 'faceSlot.meanDE76', 'background.meanDE76_vsStarry']}
agg['costumeRedPct'] = round(float(np.median([r['costume']['final']['red'] for r in rows])), 1)
agg['costumeBluePct'] = round(float(np.median([r['costume']['final']['blue'] for r in rows])), 1)
res = {'note': 'final v3 royal-starry → nắn khung QUAD → cover-fit vuông (cắt giữa) → so Trang phục Queen.png theo queen_mask.png; ΔE76 theo px 1254', 'n': len(rows), 'reference': ref, 'median': agg, 'finals': rows}
json.dump(res, open(os.path.join(OUT, 'flat_check.json'), 'w'), indent=1)
print(json.dumps({'n': len(rows), 'reference': ref, 'median': agg}))
