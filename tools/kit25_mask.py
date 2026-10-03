"""KIT-25 mask trang phục tổng quát cho ảnh không có mask vẽ tay (vd requirements/Trang phục King.png): 3543 px, trắng = trang phục,
đen = nền. Có kênh alpha → alpha ≥ 128. Không có (nền caro vẽ sẵn) → màu nền = các cụm Lab xám (C* ≤ --chroma, ≥ 10 % mẫu) trong 4 cụm của dải mép ảnh (ô caro sáng / tối),
nền = điểm xám (C* thấp) có L trong khoảng L các màu nền ± --de, nối được ra mép ảnh; đóng / mở hình thái, lấp lỗ trong trang phục.
Không màu / toạ độ riêng ảnh.
  ~/.cache/kit20/venv/bin/python tools/kit25_mask.py --src "<ảnh>" --out outputs/kit/kit25/king/mask.png
"""
import argparse
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--size', type=int, default=3543)
ap.add_argument('--de', type=float, default=8.0)
ap.add_argument('--chroma', type=float, default=10.0, help='C* tối đa của màu nền')
ap.add_argument('--border', type=float, default=0.02, help='dải mép lấy mẫu nền (tỉ lệ cạnh)')
a = ap.parse_args()

im = cv2.imread(a.src, cv2.IMREAD_UNCHANGED)
h, w = im.shape[:2]
if im.ndim == 3 and im.shape[2] == 4:
    fg = im[:, :, 3] >= 128
    how = 'alpha'
else:
    lab = cv2.cvtColor(im[:, :, :3].astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)
    b = max(4, int(a.border * min(w, h)))
    edge = np.concatenate([lab[:b].reshape(-1, 3), lab[-b:].reshape(-1, 3), lab[:, :b].reshape(-1, 3), lab[:, -b:].reshape(-1, 3)])
    _, lb, cen = cv2.kmeans(edge.astype(np.float32), 6, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.1), 3, cv2.KMEANS_PP_CENTERS)
    share = np.bincount(lb.ravel(), minlength=6) / len(lb)
    cen = [c for c, s_ in zip(cen, share) if np.hypot(c[1], c[2]) <= a.chroma and s_ >= 0.05]  # màu nền = cụm mép xám (caro), trang phục chạm mép bị loại
    # nền = xám (C* ≤ C* cụm nền + 4) với L trong [min, max] L cụm nền ± de (gồm cả viền khử răng cưa giữa 2 ô caro)
    chroma = np.hypot(lab[:, :, 1], lab[:, :, 2])
    Ls = [c[0] for c in cen]
    bgc = ((chroma <= max(np.hypot(c[1], c[2]) for c in cen) + 4) & (lab[:, :, 0] >= min(Ls) - a.de) & (lab[:, :, 0] <= max(Ls) + a.de)).astype(np.uint8)
    bgc = cv2.morphologyEx(bgc, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))  # bỏ đốm sáng lẻ trên hạt
    n, lbl = cv2.connectedComponents(bgc, connectivity=4)
    touch = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
    bg = np.isin(lbl, list(touch))
    fg = ~bg
    how = f'checker {[[round(float(v), 1) for v in c] for c in cen]}'
fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
# lấp lỗ (nền không nối ra mép) + bỏ mảnh < 0.2 % ảnh
inv = (1 - fg).astype(np.uint8)
n, lbl = cv2.connectedComponents(inv, connectivity=4)
touch = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
fg = (~np.isin(lbl, list(touch))).astype(np.uint8)
n, lbl, st, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
keep = np.zeros(n, bool); keep[1:] = st[1:, cv2.CC_STAT_AREA] >= 0.002 * w * h
fg = keep[lbl]
out = cv2.resize(fg.astype(np.uint8) * 255, (a.size, a.size), interpolation=cv2.INTER_NEAREST)
cv2.imwrite(a.out, cv2.merge([out, out, out]))
print(f'mask: {how}, trang phục {100 * fg.mean():.1f} % → {a.out}')
