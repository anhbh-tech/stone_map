"""KIT-20 chuỗi / viền hạt vàng li ti (msg 014 a: vùng cùng màu-vật liệu).

Hạt vàng vẽ ~1 mm (139 / 166 hạt vàng GT < 2 mm) không thể mỗi hạt 1 viên (viên nhỏ nhất 2.8 mm): lấy vùng vàng
(hue 55-100°, C* ≥ 30, L* ≥ 40, như MAT trong tools/kit20.mjs) trong trang phục, bỏ đốm < 0.8 mm bề ngang, lấy đường
giữa (skeleton) rồi đặt điểm cách nhau --step mm (mặc định 3.0 = viên 2.8 + khe 0.2, như border 'chain' KIT-16) dọc
đường giữa. Ra { schema: 'pearl-kit20-chain/1', points: [{ x, y (px 3543), L, a, b, widthMm }] } — tools/kit20.mjs --chain
đặt viên vàng 2.8 ở đó sau mọi hạt khác (va chạm thì bỏ).

  ~/.cache/kit20/venv/bin/python tools/kit20_chain.py --region gt|all --out outputs/kit/kit20/chain_<region>.json
"""
import argparse, json, math, os, time
import numpy as np
import cv2
from skimage.morphology import skeletonize

CANVAS_MM, OUT_PX = 300.0, 3543
GT_TILES = ['heart', 'pearls', 'cape']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--img', default='outputs/kit/kit20/up4.png')
    ap.add_argument('--mask', default='kit/templates/queen_mask.png')
    ap.add_argument('--region', default='gt')
    ap.add_argument('--gt', default='outputs/kit/queen_gt')
    ap.add_argument('--out', required=True)
    ap.add_argument('--step', type=float, default=3.0)
    ap.add_argument('--min-width', type=float, default=0.8)
    ap.add_argument('--max-width', type=float, default=4.0)
    a = ap.parse_args()
    t0 = time.time()
    bgr = cv2.imread(a.img, cv2.IMREAD_COLOR)
    H, W = bgr.shape[:2]
    ppm = W / CANVAS_MM
    lab = cv2.cvtColor(bgr.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)
    L, A, B = lab[:, :, 0], lab[:, :, 1], lab[:, :, 2]
    C, hue = np.hypot(A, B), (np.degrees(np.arctan2(B, A)) + 360) % 360
    m = cv2.imread(a.mask, cv2.IMREAD_COLOR)
    m = cv2.resize(m, (W, H), interpolation=cv2.INTER_NEAREST)
    cost = (m[:, :, 0] > 200) & (m[:, :, 1] > 200) & (m[:, :, 2] > 200)
    gold = cost & (hue >= 55) & (hue <= 100) & (C >= 30) & (L >= 40)
    # đóng khe tối giữa các hạt li ti (bóng giữa 2 hạt) để chuỗi liền
    k = max(3, int(round(0.4 * ppm)) | 1)
    gold = cv2.morphologyEx(gold.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0
    gold &= cost
    region = np.zeros_like(gold)
    if a.region == 'gt':
        for t in GT_TILES:
            g = json.load(open(os.path.join(a.gt, f'{t}.json')))['tile']
            s = W / OUT_PX
            region[int(g['y'] * s):int((g['y'] + g['h']) * s), int(g['x'] * s):int((g['x'] + g['w']) * s)] = True
    else:
        region[:] = True
    gold &= region
    dist = cv2.distanceTransform(gold.astype(np.uint8), cv2.DIST_L2, 5)
    sk = skeletonize(gold) & (dist >= a.min_width / 2 * ppm) & (dist <= a.max_width / 2 * ppm)
    ys, xs = np.nonzero(sk)
    # đặt điểm dọc đường giữa: duyệt theo thứ tự nối (BFS trên skeleton), nhận điểm cách mọi điểm đã nhận ≥ step
    step = a.step * ppm
    on = {(int(y), int(x)) for y, x in zip(ys, xs)}
    seen, pts, cell = set(), [], {}
    cs = step

    def ok(y, x):
        cy, cx = int(y // cs), int(x // cs)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for (py, px) in cell.get((cy + dy, cx + dx), ()):
                    if (py - y) ** 2 + (px - x) ** 2 < step * step:
                        return False
        return True

    # bắt đầu từ đầu mút (1 láng giềng) để chuỗi được rải đều từ một đầu
    def nb(p):
        y, x = p
        return [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (y + dy, x + dx) in on]
    order = sorted(on, key=lambda p: (len(nb(p)) != 1, p))
    for s0 in order:
        if s0 in seen:
            continue
        q = [s0]
        seen.add(s0)
        while q:
            p = q.pop(0)
            if ok(*p):
                pts.append(p)
                cell.setdefault((int(p[0] // cs), int(p[1] // cs)), []).append(p)
            for n in nb(p):
                if n not in seen:
                    seen.add(n)
                    q.append(n)
    r = max(1, int(0.5 * ppm))
    out = []
    for (y, x) in pts:
        sl = (slice(max(0, y - r), y + r + 1), slice(max(0, x - r), x + r + 1))
        g = gold[sl]
        out.append({'x': round(x / W * OUT_PX, 2), 'y': round(y / H * OUT_PX, 2), 'L': round(float(np.median(L[sl][g])), 1), 'a': round(float(np.median(A[sl][g])), 1),
                    'b': round(float(np.median(B[sl][g])), 1), 'widthMm': round(float(2 * dist[y, x] / ppm), 2)})
    json.dump({'schema': 'pearl-kit20-chain/1', 'region': a.region, 'params': vars(a), 'goldMm2': round(float(gold.sum()) / ppm ** 2), 'skeletonPx': int(sk.sum()),
               'points': out, 'seconds': round(time.time() - t0, 1)}, open(a.out, 'w'))
    print(f'chain/{a.region}: vùng vàng {gold.sum() / ppm ** 2:.0f} mm², {len(out)} điểm cách {a.step} mm, {time.time() - t0:.0f} s → {a.out}')


if __name__ == '__main__':
    main()
