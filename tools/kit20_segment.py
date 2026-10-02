"""KIT-20 tách từng hạt vẽ trong ảnh trang phục (mỗi hạt = 1 viên, không lấp lưới).

Dùng (venv riêng ngoài repo: torch + sam2 + opencv + scikit-image, model ~/.cache/kit20/sam2.1_hiera_small.pt (large: --sam-ckpt …_large.pt --sam-cfg configs/sam2.1/sam2.1_hiera_l.yaml), không commit):
  ~/.cache/kit20/venv/bin/python tools/kit20_segment.py --method sam|ws --img outputs/kit/kit20/up4.png \
      --mask kit/templates/queen_mask.png --region gt|all --out outputs/kit/kit20/seg_<method>_<region>.json

  sam = SAM2 automatic mask generator trên ô 1024 px (chồng 384 px), mỗi viên thuộc ô có lõi chứa tâm
  ws  = đối chứng: tâm hạt bằng LoG đa thang trên L*, watershed trên −L* trong đĩa 1.3 r quanh tâm
Ra: { ppm, canvasPx 3543, method, region, instances: [{ x, y (px 3543), dMm, wMm, hMm, rotDeg, shape, solidity, ellIoU, L, a, b,
      Lstd, spec, edge, chroma, score, src }] } — vật liệu / cỡ / mã do tools/kit20.mjs quyết.
"""
import argparse, json, math, os, sys, time
import numpy as np
import cv2

CANVAS_MM, OUT_PX = 300.0, 3543
GT_TILES = ['heart', 'pearls', 'cape']


def load_rgb(p):
    im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
    if im.shape[2] == 4:
        im = im[:, :, :3]
    return cv2.cvtColor(im, cv2.COLOR_BGR2RGB)


def costume_mask(p, w, h):
    m = cv2.imread(p, cv2.IMREAD_COLOR)
    m = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
    b, g, r = m[:, :, 0].astype(int), m[:, :, 1].astype(int), m[:, :, 2].astype(int)
    return (r > 200) & (g > 200) & (b > 200)  # trắng = trang phục (đen nền, đỏ ô mặt pet)


def lab_of(rgb):
    f = rgb.astype(np.float32) / 255.0
    return cv2.cvtColor(f, cv2.COLOR_RGB2Lab)  # L 0-100, a, b


def outline(shape, w, h, n=96):
    """như lib/kit/shapes.js outline(): điểm cục bộ (u ngang, v dọc trục dài, mũi giọt / tim về +v)"""
    pts = []
    if shape == 'marquise':
        R = (h * h / 4 + w * w / 4) / w
        d = R - w / 2
        m = n // 2
        half = [(max(0.0, math.sqrt(max(0.0, R * R - v * v)) - d), v) for v in [-h / 2 + h * i / m for i in range(m + 1)]]
        pts = half + [(-x, y) for x, y in reversed(half[1:-1])]
    elif shape == 'teardrop':
        r = w / 2
        c = -h / 2 + r
        L = h / 2 - c
        a = math.acos(min(1.0, r / L))
        for i in range(n - 1):
            t = math.pi / 2 + a + (2 * math.pi - 2 * a) * i / (n - 2)
            pts.append((r * math.cos(t), c + r * math.sin(t)))
        pts.append((0.0, h / 2))
    elif shape == 'heart':
        raw = []
        for i in range(n):
            t = 2 * math.pi * i / n
            raw.append((16 * math.sin(t) ** 3, -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))))
        xs, ys = [p[0] for p in raw], [p[1] for p in raw]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        pts = [(((x - x0) / (x1 - x0) - 0.5) * w, ((y - y0) / (y1 - y0) - 0.5) * h) for x, y in raw]
    else:
        pts = [((w / 2) * math.cos(2 * math.pi * i / n), (h / 2) * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return pts


def fit_shapes(cnt):
    """IoU mask với đường viền catalog (elip / marquise / giọt / tim), xoay theo trục dài (giọt, tim: thử cả quét góc) →
    (shape, iou, rotDeg, long, short, ious{})"""
    x, y, bw, bh = cv2.boundingRect(cnt)
    pad = 4
    m = np.zeros((bh + 2 * pad, bw + 2 * pad), np.uint8)
    cv2.drawContours(m, [cnt - [x - pad, y - pad]], -1, 1, -1)
    M = cv2.moments(m, True)
    cx, cy = M['m10'] / M['m00'], M['m01'] / M['m00']
    ys, xs = np.nonzero(m)
    A = m.sum()
    # trục dài từ moment bậc 2
    mu20, mu02, mu11 = M['mu20'] / M['m00'], M['mu02'] / M['m00'], M['mu11'] / M['m00']
    phi = 0.5 * math.atan2(2 * mu11, mu20 - mu02)  # góc trục chính so với trục x
    base = math.degrees(phi) - 90  # rot: trục v cục bộ (0, 1) xoay rot → hướng (−sin, cos); trục chính dọc theo đó
    def iou_for(shape, rot, extra=1.0):
        t = math.radians(rot)
        c, sn = math.cos(t), math.sin(t)
        u = (xs - cx) * c + (ys - cy) * sn
        v = -(xs - cx) * sn + (ys - cy) * c
        w, h = (u.max() - u.min() + 1) * extra, (v.max() - v.min() + 1) * extra
        if w < 2 or h < 2:
            return 0.0, w, h
        if shape == 'marquise' and w >= h:
            return 0.0, w, h
        P = outline(shape, w, h)
        oc, ov = (u.max() + u.min()) / 2, (v.max() + v.min()) / 2  # tâm khung
        pts = np.array([[cx + (pu + oc) * c - (pv + ov) * sn, cy + (pu + oc) * sn + (pv + ov) * c] for pu, pv in P], np.float32)
        r = np.zeros_like(m)
        cv2.fillPoly(r, [np.round(pts).astype(np.int32)], 1)
        inter = np.logical_and(r, m).sum()
        return inter / (A + r.sum() - inter), w, h
    res = {}
    for shape in ('round', 'marquise', 'teardrop', 'heart'):
        rots = [base, base + 90] if shape == 'round' else [base, base + 180] if shape == 'marquise' else [base + k for k in range(0, 360, 10)] if shape == 'heart' else [base, base + 180]
        best = max(((iou_for(shape, r)[0], r) for r in rots), key=lambda z: z[0])
        res[shape] = best
    return res, iou_for, cx + x - pad, cy + y - pad


def shape_of(cnt, ppm):
    """contour → (shape, wMm, hMm, rotDeg, solidity, ellIoU). rotDeg = góc trục dài so với trục y (như data-rotation-deg)."""
    area = cv2.contourArea(cnt)
    hull = cv2.convexHull(cnt)
    ha = max(cv2.contourArea(hull), 1e-6)
    sol = area / ha
    if len(cnt) < 5:
        d = 2 * math.sqrt(area / math.pi) / ppm
        return 'round', d, d, 0.0, sol, 1.0, {}
    (cx, cy), (ew, eh), ang = cv2.fitEllipse(cnt)
    major, minor = max(ew, eh), min(ew, eh)
    # trục dài: fitEllipse trả góc của trục ew; đưa về góc trục dài so với trục y ảnh
    theta = ang if eh >= ew else ang + 90.0
    theta = ((theta + 90) % 180) - 90
    x, y, w, h = cv2.boundingRect(cnt)
    canvas = np.zeros((h + 4, w + 4), np.uint8)
    cv2.drawContours(canvas, [cnt - [x - 2, y - 2]], -1, 1, -1)
    ell = np.zeros_like(canvas)
    cv2.ellipse(ell, ((cx - x + 2, cy - y + 2), (ew, eh), ang), 1, -1)
    inter, uni = np.logical_and(canvas, ell).sum(), np.logical_or(canvas, ell).sum()
    eiou = inter / max(uni, 1)
    asp = major / max(minor, 1e-6)
    shape = 'round'
    # chiếu contour lên trục dài: bề rộng ở 2 đầu (15 % chiều dài) so với bề rộng lớn nhất → nhọn / tròn
    t = math.radians(theta)
    ux, uy = math.sin(t), -math.cos(t)  # hướng trục dài (góc so với trục y, y ảnh hướng xuống)
    pts = cnt.reshape(-1, 2).astype(np.float64) - [cx, cy]
    u = pts @ np.array([ux, uy])
    v = pts @ np.array([-uy, ux])
    L = u.max() - u.min()

    def width_at(frac_from_min):
        u0 = u.min() + frac_from_min * L
        sel = np.abs(u - u0) < 0.04 * L + 0.5
        return (v[sel].max() - v[sel].min()) if sel.sum() >= 2 else 0.0

    wmax = minor
    e1, e2 = width_at(0.12) / max(wmax, 1e-6), width_at(0.88) / max(wmax, 1e-6)
    if asp >= 1.45:
        if e1 < 0.55 and e2 < 0.55:
            shape = 'marquise'
        elif min(e1, e2) < 0.55 and max(e1, e2) >= 0.62:
            shape = 'teardrop'
            if e2 < e1:  # mũi nhọn về phía u nhỏ → quay 180 để rot chỉ hướng mũi
                theta = ((theta + 180 + 90) % 360) - 90
        else:
            shape = 'oval'
    else:
        # tim: lõm rõ ở 1 đầu (khuyết lồi sâu) + gần vuông
        deep = 0.0
        try:
            defects = cv2.convexityDefects(cnt, cv2.convexHull(cnt, returnPoints=False)) if len(cnt) > 8 else None
            if defects is not None and len(defects):
                deep = defects.reshape(-1, 4)[:, 3].max() / 256.0 / max(major, 1e-6)
        except cv2.error:
            pass
        if deep > 0.08 and sol < 0.95 and major / ppm >= 3.5:
            shape = 'heart'
            # mũi tim = phía đối diện chỗ lõm: hướng lõm → tâm = hướng mũi = (−sin rot, cos rot)
            d = defects.reshape(-1, 4)
            fx, fy = cnt.reshape(-1, 2)[d[d[:, 3].argmax(), 2]]
            dx, dy = cx - fx, cy - fy
            theta = math.degrees(math.atan2(-dx, dy))
    # KIT-20: khớp đường viền catalog thay luật (luật cũ giữ làm dự phòng khi mask quá nhỏ)
    if area >= 30 * 30 / 4:
        res, iou_for, _, _ = fit_shapes(cnt)
        r_iou = res['round'][0]
        best = max(res.items(), key=lambda kv: kv[1][0])
        sh, (bi, rot) = best
        asp = major / max(minor, 1e-6)
        # hình catalog thắng tròn rõ (+0.03), hoặc hạt dài (≥ 1.25) thắng sát (+0.01); tim vẽ (khuyết nông, mask gồm viền) khớp tim
        # catalog kém hơn: hạt to (≥ 11 mm) có IoU tim ≥ 0.92 × IoU tròn → tim (hạt tròn thật: tỉ lệ ~0.7)
        if sh != 'round' and not (bi >= r_iou + 0.03 or (asp >= 1.25 and bi >= r_iou + 0.01)):
            sh, (bi, rot) = 'round', res['round']
        if 2 * math.sqrt(area / math.pi) / ppm >= 11 and res['heart'][0] >= 0.92 * r_iou and sh in ('round', 'heart'):
            sh, (bi, rot) = 'heart', res['heart']
        _, w, h = iou_for(sh, rot)
        rot = ((rot + 180) % 360) - 180
        if sh == 'marquise':
            rot = ((rot + 90) % 180) - 90
        return (sh if sh != 'round' else ('oval' if max(w, h) / max(min(w, h), 1) >= 1.45 else 'round')), max(w, h) / ppm, min(w, h) / ppm, float(rot), float(sol), float(r_iou), {k: round(v[0], 3) for k, v in res.items()}
    return shape, major / ppm, minor / ppm, float(theta), float(sol), float(eiou), {}


def features(mask_full_crop, rgb_crop, lab_crop, ox, oy, ppm, src, score):
    """mask (bool, toạ độ crop) → dict đặc trưng hoặc None"""
    m8 = mask_full_crop.astype(np.uint8)
    cnts, _ = cv2.findContours(m8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        return None
    cnt = max(cnts, key=cv2.contourArea)
    area = cv2.contourArea(cnt)
    if area < 20:
        return None
    M = cv2.moments(cnt)
    cx, cy = M['m10'] / M['m00'], M['m01'] / M['m00']
    shape, wmm, hmm, rot, sol, eiou, fits = shape_of(cnt, ppm)
    inner = cv2.erode(m8, np.ones((3, 3), np.uint8), iterations=max(1, int(0.12 * math.sqrt(area / math.pi))))
    sel = inner.astype(bool) if inner.sum() >= 12 else mask_full_crop
    Lc = lab_crop[:, :, 0][sel]
    ac, bc = lab_crop[:, :, 1][sel], lab_crop[:, :, 2][sel]
    gray = cv2.cvtColor(rgb_crop, cv2.COLOR_RGB2GRAY)
    x, y, w, h = cv2.boundingRect(cnt)
    ed = cv2.Canny(gray[y:y + h, x:x + w], 60, 140) > 0
    edge = float((ed & sel[y:y + h, x:x + w]).sum() / max(sel[y:y + h, x:x + w].sum(), 1))
    # màu đại diện: trung vị ab, L trung vị (bỏ điểm sáng chói)
    return {
        'x': (ox + cx) * OUT_PX / (CANVAS_MM * ppm), 'y': (oy + cy) * OUT_PX / (CANVAS_MM * ppm),
        'dMm': 2 * math.sqrt(area / math.pi) / ppm, 'wMm': wmm, 'hMm': hmm, 'rotDeg': rot, 'shape': shape,
        'solidity': sol, 'ellIoU': eiou,
        'L': float(np.median(Lc)), 'a': float(np.median(ac)), 'b': float(np.median(bc)),
        'Lp90': float(np.percentile(Lc, 90)), 'Lp10': float(np.percentile(Lc, 10)),
        'Lstd': float(Lc.std()), 'spec': float((Lc > 90).mean()), 'edge': edge,
        'chroma': float(np.median(np.hypot(ac, bc))), 'score': float(score), 'src': src,
        'areaPx': float(area), 'fits': fits, 'fill': float(mask_full_crop.sum() / max(area, 1)),
    }


def micro_blobs(lab, fgc, ppm, args):
    """hạt li ti (viền hạt vàng ~1-2.5 mm) SAM không tách: LoG thang nhỏ trên L*, mỗi blob = mask tròn bán kính LoG, điểm thấp (sau SAM)."""
    from skimage.feature import blob_log
    L = cv2.GaussianBlur(lab[:, :, 0], (0, 0), 0.8) / 100.0
    rmin, rmax = 0.4 * ppm, 1.4 * ppm
    out = []
    H, W = L.shape
    for y, x, sg in blob_log(L * fgc, min_sigma=rmin / math.sqrt(2), max_sigma=rmax / math.sqrt(2), num_sigma=8, threshold=args.micro_thr, overlap=0.3):
        r = sg * math.sqrt(2)
        y, x = int(y), int(x)
        if not fgc[y, x]:
            continue
        m = np.zeros((H, W), np.uint8)
        cv2.circle(m, (x, y), max(2, int(round(r))), 1, -1)
        out.append((m.astype(bool), 0.3, 'log'))
    return out


def bead_like(f):
    if not ((0.8 if f['src'] == 'log' else 1.2) <= f['dMm'] <= 20 and f['fill'] >= 0.85):
        return False
    if f['shape'] == 'heart':
        return f['solidity'] >= 0.8
    if f['shape'] in ('round', 'oval'):
        return f['solidity'] >= 0.88 and f['ellIoU'] >= 0.8
    return f['solidity'] >= 0.86


def resolve(masks, crop, lab, fgc, x0, y0, ppm, args):
    """Mask SAM chồng nhau → mỗi pixel thuộc đúng 1 hạt. To trước: mask bị hạt to hơn đã nhận chiếm ≥ 50 % = mảnh của hạt to (mặt giác,
    điểm sáng, hạt nhỏ nằm trong lòng) → bỏ. Mask to là CỤM (≥ 3 hạt nhỏ giống hạt ≥ 2.2 mm nằm ≥ 80 % trong nó, phủ ≥ 50 %; không phải tim) → bỏ mask to.
    Hai mask gần trùng (IoU ≥ 0.7): giữ điểm SAM cao hơn. → [(mask riêng, đặc trưng)]"""
    cand = []
    for m, sc, src in masks:
        m = m & fgc
        if m.sum() < 20:
            continue
        f = features(m, crop, lab, x0, y0, ppm, src, sc)
        if f and bead_like(f):
            cand.append([m, f, int(m.sum())])
    cand.sort(key=lambda c: -c[2])
    # gần trùng: giữ điểm cao
    dropped = set()
    for i in range(len(cand)):
        if i in dropped:
            continue
        for j in range(i + 1, len(cand)):
            if j in dropped or cand[j][2] < 0.7 * cand[i][2]:
                if cand[j][2] < 0.7 * cand[i][2]:
                    break
                continue
            inter = np.logical_and(cand[i][0], cand[j][0]).sum()
            if inter / (cand[i][2] + cand[j][2] - inter) >= 0.7:
                dropped.add(j if cand[i][1]['score'] >= cand[j][1]['score'] else i)
                if i in dropped:
                    break
    cand = [c for k, c in enumerate(cand) if k not in dropped]
    owner = np.zeros(fgc.shape, bool)
    out = []
    for i, (m, f, a) in enumerate(cand):
        if owner[m].sum() >= 0.5 * a:
            continue
        if f['shape'] != 'heart':
            inner = [c for c in cand[i + 1:] if c[1]['dMm'] >= 2.2 and c[2] < 0.6 * a and np.logical_and(c[0], m).sum() >= 0.8 * c[2]]
            if len(inner) >= 3:
                u = np.zeros_like(m)
                for c in inner:
                    u |= c[0]
                if (u & m).sum() >= 0.5 * a:
                    f['cluster'] = len(inner)
                    continue
        own = m & ~owner
        owner |= m
        f['ownedFrac'] = float(own.sum() / a)
        out.append((m, f))
    return out


def tiles_for(region, W, H, fg, ppm, gt_dir, tile=1024, stride=640):
    """→ [(x0, y0, x1, y1, core (cx0, cy0, cx1, cy1))] toạ độ ảnh up4"""
    out = []
    if region == 'gt':
        for t in GT_TILES:
            g = json.load(open(os.path.join(gt_dir, f'{t}.json')))['tile']
            s = W / OUT_PX
            cx, cy = (g['x'] + g['w'] / 2) * s, (g['y'] + g['h'] / 2) * s
            x0, y0 = int(max(0, min(W - tile, cx - tile / 2))), int(max(0, min(H - tile, cy - tile / 2)))
            m = 8 * ppm  # lõi = ô GT + 8 mm
            out.append((x0, y0, x0 + tile, y0 + tile, (g['x'] * s - m, g['y'] * s - m, (g['x'] + g['w']) * s + m, (g['y'] + g['h']) * s + m), t))
        return out
    ys, xs = np.where(fg)
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    half = (tile - stride) / 2
    y = by0 - half
    while y < by1:
        x = bx0 - half
        while x < bx1:
            x0, y0 = int(max(0, min(W - tile, x))), int(max(0, min(H - tile, y)))
            core = (x + half, y + half, x + half + stride, y + half + stride)
            if fg[int(max(0, core[1])):int(min(H, core[3])), int(max(0, core[0])):int(min(W, core[2]))].any():
                out.append((x0, y0, x0 + tile, y0 + tile, core, f'{int(x)}_{int(y)}'))
            x += stride
        y += stride
    return out


def run_sam(crop, args):
    from sam2.build_sam import build_sam2
    from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
    import torch
    if not hasattr(run_sam, 'gen'):
        dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
        model = build_sam2(args.sam_cfg, args.sam_ckpt, device=dev)
        run_sam.gen = SAM2AutomaticMaskGenerator(model, points_per_side=args.pps, points_per_batch=args.ppb, pred_iou_thresh=args.iou,
                                                 stability_score_thresh=args.stab, box_nms_thresh=0.7, crop_n_layers=0,
                                                 min_mask_region_area=40, multimask_output=True)
    import torch
    with torch.inference_mode():
        res = run_sam.gen.generate(crop)
    return [(r['segmentation'], r['predicted_iou'] * r['stability_score'], 'sam') for r in res]


def run_ws(crop, lab, fgc, ppm, args):
    from skimage.feature import blob_log
    from skimage.segmentation import watershed
    L = cv2.GaussianBlur(lab[:, :, 0], (0, 0), 1.2) / 100.0
    rmin, rmax = 1.1 * ppm, 9.0 * ppm  # bán kính hạt 1.1-9 mm
    blobs = blob_log(L * fgc, min_sigma=rmin / math.sqrt(2), max_sigma=rmax / math.sqrt(2), num_sigma=18, threshold=args.log_thr, overlap=0.5)
    out = []
    H, W = L.shape
    markers = np.zeros(L.shape, np.int32)
    rr = []
    for i, (y, x, s) in enumerate(blobs):
        y, x = int(y), int(x)
        if not fgc[y, x]:
            continue
        markers[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = len(rr) + 1
        rr.append((x, y, s * math.sqrt(2)))
    if not rr:
        return out
    lab_ws = watershed(-L, markers, mask=fgc.astype(bool), compactness=0.001)
    for i, (x, y, r) in enumerate(rr):
        R = int(1.35 * r) + 2
        x0, y0, x1, y1 = max(0, x - R), max(0, y - R), min(W, x + R + 1), min(H, y + R + 1)
        reg = lab_ws[y0:y1, x0:x1] == i + 1
        yy, xx = np.mgrid[y0:y1, x0:x1]
        reg &= (xx - x) ** 2 + (yy - y) ** 2 <= (1.35 * r) ** 2
        if reg.sum() < 20:
            continue
        # bỏ khe tối trong vùng: ngưỡng Otsu trên L trong vùng
        v = (L[y0:y1, x0:x1][reg] * 255).astype(np.uint8)
        thr, _ = cv2.threshold(v, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        reg &= (L[y0:y1, x0:x1] * 255) >= thr * 0.85
        n, lbl = cv2.connectedComponents(reg.astype(np.uint8))
        if n > 2:
            ly, lx = min(max(y - y0, 0), reg.shape[0] - 1), min(max(x - x0, 0), reg.shape[1] - 1)
            keep = lbl[ly, lx] if lbl[ly, lx] else np.bincount(lbl[reg]).argmax()
            reg = lbl == keep
        full = np.zeros(L.shape, bool)
        full[y0:y1, x0:x1] = reg
        out.append((full, float(blobs[i][2]) if i < len(blobs) else 0.0, 'ws'))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--method', default='sam')
    ap.add_argument('--img', default='outputs/kit/kit20/up4.png')
    ap.add_argument('--mask', default='kit/templates/queen_mask.png')
    ap.add_argument('--region', default='gt')
    ap.add_argument('--gt', default='outputs/kit/queen_gt')
    ap.add_argument('--out', required=True)
    ap.add_argument('--sam-ckpt', default=os.path.expanduser('~/.cache/kit20/sam2.1_hiera_small.pt'))
    ap.add_argument('--sam-cfg', default='configs/sam2.1/sam2.1_hiera_s.yaml')
    ap.add_argument('--pps', type=int, default=32)
    ap.add_argument('--ppb', type=int, default=16)  # điểm / lô: 64 lô × 3 mask × 1024² float ≈ 0.8 GB → 16 cho máy 16 GB
    ap.add_argument('--iou', type=float, default=0.7)
    ap.add_argument('--stab', type=float, default=0.85)
    ap.add_argument('--log-thr', type=float, default=0.04)
    ap.add_argument('--tile', type=int, default=1024)
    ap.add_argument('--stride', type=int, default=640)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--micro', type=int, default=1)  # 1 = thêm hạt li ti LoG (0.8-2.8 mm) chỗ SAM chưa có
    ap.add_argument('--micro-thr', type=float, default=0.05)
    ap.add_argument('--cache', default='outputs/kit/kit20/cache')  # mask thô từng ô (npz) — chỉnh gỡ chồng không phải chạy lại SAM
    args = ap.parse_args()
    t0 = time.time()
    rgb = load_rgb(args.img)
    H, W = rgb.shape[:2]
    ppm = W / CANVAS_MM
    fg = costume_mask(args.mask, W, H)
    tiles = tiles_for(args.region, W, H, fg, ppm, args.gt, args.tile, args.stride)
    if args.limit:
        tiles = tiles[:args.limit]
    inst = []
    for k, (x0, y0, x1, y1, core, name) in enumerate(tiles):
        crop = np.ascontiguousarray(rgb[y0:y1, x0:x1])
        lab = lab_of(crop)
        fgc = fg[y0:y1, x0:x1]
        t1 = time.time()
        cf = os.path.join(args.cache, f'{args.method}_{name}_{x0}_{y0}.npz') if args.cache else None
        if cf and os.path.exists(cf):
            z = np.load(cf)
            bits, sc = z['bits'], z['score']
            masks = [(np.unpackbits(bits[i])[:crop.shape[0] * crop.shape[1]].reshape(crop.shape[:2]).astype(bool), float(sc[i]), args.method) for i in range(len(sc))]
        else:
            masks = run_sam(crop, args) if args.method == 'sam' else run_ws(crop, lab, fgc, ppm, args)
            if cf:
                os.makedirs(args.cache, exist_ok=True)
                np.savez_compressed(cf, bits=np.stack([np.packbits(m.reshape(-1)) for m, _, _ in masks]) if masks else np.zeros((0, 1), np.uint8), score=np.array([sc for _, sc, _ in masks]))
        n0 = len(inst)
        if args.micro and args.method == 'sam':
            masks = masks + micro_blobs(lab, fgc, ppm, args)
        kept = resolve(masks, crop, lab, fgc, x0, y0, ppm, args)
        for m, f in kept:
            # tâm phải nằm trong lõi ô (mỗi viên đúng 1 ô); viên chạm mép ô (không phải mép ảnh) bỏ — ô bên cạnh có đủ
            ys, xs = np.nonzero(m)
            cx, cy = xs.mean() + x0, ys.mean() + y0
            if not (core[0] <= cx < core[2] and core[1] <= cy < core[3]):
                continue
            if (xs.min() == 0 and x0 > 0) or (ys.min() == 0 and y0 > 0) or (xs.max() == m.shape[1] - 1 and x1 < W) or (ys.max() == m.shape[0] - 1 and y1 < H):
                continue
            f['tile'] = name
            inst.append(f)
        print(f'tile {k + 1}/{len(tiles)} {name}: {len(masks)} mask → {len(inst) - n0} giữ, {time.time() - t1:.1f} s', file=sys.stderr, flush=True)
    json.dump({'schema': 'pearl-kit20-seg/1', 'method': args.method, 'region': args.region, 'img': args.img, 'ppm': ppm, 'canvasPx': OUT_PX,
               'params': {k: v for k, v in vars(args).items() if k not in ('out',)}, 'tiles': len(tiles), 'seconds': round(time.time() - t0, 1),
               'instances': inst}, open(args.out, 'w'))
    print(f'{len(inst)} hạt (chưa gỡ chồng) → {args.out} · {time.time() - t0:.0f} s', file=sys.stderr)


if __name__ == '__main__':
    main()
