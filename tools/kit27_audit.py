# KIT-27 kiểm tra tự động theo viên / vật thể (gọi bởi tools/kit27_audit.mjs, không gọi API).
# Vào: stones.json (viên đã xuất + vật thể SAM + vùng phủ, toạ độ canvas px), ảnh nguồn cỡ canvas, mask trang phục.
# Ra: items.json = danh sách lỗi nghi ngờ {type, x, y, sev, ...} toạ độ canvas px; tools/kit27_audit.mjs gom theo tile.
#   bigMiss     vật thể SAM ≥ 4 mm (đặc, rõ) không có viên nào cỡ ≥ 55 % ở gần
#   shapeMis    vật thể SAM hình tim (≥ 4 mm) / giọt / hạt (≥ 5 mm), chắc, mà viên gần nhất (không phải ngọc trai) khác hình
#   colorDE     màu ảnh trong lõi viên gần 1 mã khác trong bảng (cùng hình + cỡ) hơn mã gán ≥ dE (ΔE76 Lab)
#   fillHole    điểm trong vùng phủ còn chứa được 1 viên cỡ vùng (tâm trong mask)
#   emptyLarge  vùng trong mask không viên, chứa được đĩa ≥ 6 mm (in / bỏ sót — mức thấp, sản phẩm thật khoan 1 phần)
#   outside     tâm viên ngoài mask trang phục (nền / ô mặt)
#   labelIncons 2 viên chạm nhau cùng hình + cỡ, màu ảnh gần như nhau (ΔE < 6) mà khác mã
import json, math, sys
import cv2
import numpy as np
from scipy.spatial import cKDTree

src, img_f, mask_f, out_f = sys.argv[1:5]
D = json.load(open(src))
ppm = D['ppm']
img = cv2.imread(img_f)
H, W = img.shape[:2]
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
lab[..., 0] *= 100 / 255
lab[..., 1:] -= 128
mk = cv2.imread(mask_f)
if mk.shape[:2] != (H, W):
    mk = cv2.resize(mk, (W, H), interpolation=cv2.INTER_NEAREST)
b, g, r = [mk[..., i].astype(int) for i in range(3)]
costume = (r > 150) & (g > 150) & (b > 150)


def hex_lab(h):
    c = np.uint8([[[int(h[5:7], 16), int(h[3:5], 16), int(h[1:3], 16)]]])
    L = cv2.cvtColor(c, cv2.COLOR_BGR2LAB).astype(np.float32)[0, 0]
    return np.array([L[0] * 100 / 255, L[1] - 128, L[2] - 128])


def core_lab(x, y, rpx):
    x0, x1, y0, y1 = max(0, int(x - rpx)), min(W, int(x + rpx) + 1), max(0, int(y - rpx)), min(H, int(y + rpx) + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    yy, xx = np.mgrid[y0:y1, x0:x1]
    sel = (xx - x) ** 2 + (yy - y) ** 2 <= rpx * rpx
    px = lab[y0:y1, x0:x1][sel]
    return np.median(px, axis=0) if len(px) else None


def inside(x, y):
    xi, yi = int(round(x)), int(round(y))
    return 0 <= xi < W and 0 <= yi < H and bool(costume[yi, xi])


stones = D['stones']
pal = {p['code']: p for p in D['palette']}
PL = {q: hex_lab(p['rgb']) for q, p in pal.items()}
S = np.array([[s['x'], s['y']] for s in stones])
tree = cKDTree(S)
phys = np.array([s['physMm'] for s in stones])
items = []

# viên: màu, ngoài mask
cl = []
for i, s in enumerate(stones):
    c = core_lab(s['x'], s['y'], max(2.0, 0.3 * min(s['physMm'], s.get('wMm') or s['physMm']) * ppm))
    cl.append(c)
    if not inside(s['x'], s['y']):
        items.append({'type': 'outside', 'x': s['x'], 'y': s['y'], 'sev': 'high', 'id': s['id'], 'code': s['code']})
    p = pal.get(s['code'])
    if c is not None and p:
        # hạt bóng / vàng ánh kim lệch catalog tự nhiên → chỉ báo khi 1 mã khác trong bảng gần màu ảnh hơn rõ (≥ dE / dEHigh)
        de = float(np.linalg.norm(c - PL[s['code']]))
        # chỉ mã trong bảng cùng hình + cỡ vật lý (mỗi mã catalog có 1 cỡ: vàng 2.8 mm không thể đổi sang Z16 4 mm)
        alt = [q for q, e in pal.items() if e.get('shape', 'round') == s.get('shape', 'round') and abs((e.get('physMm') or 0) - (p.get('physMm') or 0)) < 0.05] or [s['code']]
        best = min(alt, key=lambda q: np.linalg.norm(c - PL[q]))
        gain = de - float(np.linalg.norm(c - PL[best]))
        s['dE'] = de
        if gain >= D['params']['dE']:
            items.append({'type': 'colorDE', 'x': s['x'], 'y': s['y'], 'sev': 'high' if gain >= D['params']['dEHigh'] else 'low', 'id': s['id'], 'code': s['code'], 'better': best, 'dE': round(de, 1), 'gain': round(gain, 1)})

# nhãn không nhất quán: cặp chạm nhau cùng hình + cỡ, màu ảnh gần nhau, khác mã
seen = set()
for i, j in tree.query_pairs(r=8 * ppm):
    a, c = stones[i], stones[j]
    if a['code'] == c['code'] or (a.get('shape') or 'round') != (c.get('shape') or 'round') or abs(a['physMm'] - c['physMm']) > 0.05:
        continue
    if math.dist((a['x'], a['y']), (c['x'], c['y'])) > 1.25 * a['physMm'] * ppm or cl[i] is None or cl[j] is None:
        continue
    de = float(np.linalg.norm(cl[i] - cl[j]))
    if de < 6:
        items.append({'type': 'labelIncons', 'x': (a['x'] + c['x']) / 2, 'y': (a['y'] + c['y']) / 2, 'sev': 'med' if a['physMm'] >= 4 else 'low', 'ids': [a['id'], c['id']], 'codes': [a['code'], c['code']], 'physMm': a['physMm'], 'dE': round(de, 1)})

# vật thể SAM lớn: bỏ sót / sai hình
seg = sorted(D['seg'], key=lambda o: -o['dMm'])
taken = []
for o in seg:
    d = o['dMm']
    if d < 4 or not inside(o['x'], o['y']):
        continue
    sh = o.get('shape') or 'round'
    solid = (o.get('solidity') or 0) >= 0.9 and (o.get('score') or 0) >= 0.85
    if not solid:
        continue
    if any(math.dist((o['x'], o['y']), t) < 0.5 * d * ppm for t in taken):
        continue  # SAM trùng (mask lồng nhau): giữ cái lớn nhất
    taken.append((o['x'], o['y']))
    near = tree.query_ball_point((o['x'], o['y']), r=max(0.5 * d, 1.5) * ppm)
    big = [k for k in near if phys[k] >= 0.55 * d]
    if not big:
        items.append({'type': 'bigMiss', 'x': o['x'], 'y': o['y'], 'sev': 'high' if d >= 6 else 'med', 'dMm': round(d, 1), 'shape': sh,
                      'near': [stones[k]['code'] + '/' + str(stones[k]['physMm']) for k in near[:4]]})
        continue
    k = min(big, key=lambda k: math.dist((o['x'], o['y']), S[k]))
    ks = stones[k].get('shape') or 'round'
    # ngọc trai luôn tròn (SAM ra giọt/hạt do vệt sáng / bóng đổ) → không tính
    if (pal.get(stones[k]['code']) or {}).get('kind') == 'pearl':
        continue
    # giọt / hạt < 5 mm trên nền hạt cườm trắng = SAM gộp 2 hạt (soát tile KIT-27) → chỉ tính từ 5 mm; tim từ 4 mm
    if sh in ('teardrop', 'marquise') and d < 5:
        continue
    if sh in ('heart', 'teardrop', 'marquise') and ks != sh and (o.get('ellIoU') or 0) < 0.97:
        items.append({'type': 'shapeMis', 'x': o['x'], 'y': o['y'], 'sev': 'high' if sh == 'heart' or d >= 6 else 'med', 'dMm': round(d, 1), 'samShape': sh, 'mapShape': ks, 'id': stones[k]['id'], 'code': stones[k]['code']})

# lỗ trong vùng phủ + vùng trống lớn: lưới 0.5 mm, khoảng cách tới mép viên gần nhất
step = 0.5 * ppm
gx, gy = np.meshgrid(np.arange(step / 2, W, step), np.arange(step / 2, H, step))
P = np.c_[gx.ravel(), gy.ravel()]
inm = costume[np.clip(P[:, 1].astype(int), 0, H - 1), np.clip(P[:, 0].astype(int), 0, W - 1)]
P = P[inm]
dist, idx = tree.query(P, k=16)  # đủ để viên to tâm xa nhưng mép gần vẫn được tính
edge = np.min(dist - (phys[idx] / 2) * ppm, axis=1) / ppm  # mm tới mép viên gần nhất
dmask = cv2.distanceTransform(costume.astype(np.uint8), cv2.DIST_L2, 5)
dm = dmask[P[:, 1].astype(int).clip(0, H - 1), P[:, 0].astype(int).clip(0, W - 1)] / ppm  # mm tới mép mask
gap = D['params']['gapMm']


def clusters(sel, kind, sev, extra):
    pts = P[sel]
    if not len(pts):
        return
    t = cKDTree(pts)
    lab_ = -np.ones(len(pts), int)
    for i in range(len(pts)):
        if lab_[i] >= 0:
            continue
        st, lab_[i] = [i], i
        while st:
            u = st.pop()
            for v in t.query_ball_point(pts[u], r=step * 1.5):
                if lab_[v] < 0:
                    lab_[v] = i
                    st.append(v)
    for c in np.unique(lab_):
        m = pts[lab_ == c]
        cx, cy = m.mean(axis=0)
        items.append({'type': kind, 'x': float(cx), 'y': float(cy), 'sev': sev, 'areaMm2': round(len(m) * 0.25, 1), **extra})


for f in D['fill']:
    if len(f['polygon']) < 3:
        continue
    fm = np.zeros((H, W), np.uint8)
    cv2.fillPoly(fm, [np.round(np.array(f['polygon'])).astype(np.int32)], 1)
    inF = fm[P[:, 1].astype(int).clip(0, H - 1), P[:, 0].astype(int).clip(0, W - 1)] > 0
    R = f['physMm'] / 2
    clusters(inF & (edge >= R + gap) & (dm >= R * 0.8), 'fillHole', 'high', {'region': f['id']})
clusters((edge >= 3 + gap) & (dm >= 3), 'emptyLarge', 'low', {})

json.dump({'items': items, 'stoneDE': [round(s.get('dE', -1), 1) for s in stones]}, open(out_f, 'w'))
print(json.dumps({t: sum(1 for i in items if i['type'] == t) for t in sorted({i['type'] for i in items})}))
