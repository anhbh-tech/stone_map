#!/usr/bin/env python3
"""Build kit/db from requirements/DATA (+ old samples) — the reference database for the KIT algorithm.

Run: .venv/bin/python tools/build_kit_db.py
Writes kit/db/kit.sqlite + kit/db/*.json + copies the source CSV/JSON/TXT to kit/db/source/.
Schema and meaning of every field: docs/KIT-DB.md.
"""
import csv, json, math, os, re, shutil, sqlite3, collections
import numpy as np
import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQ = os.path.join(ROOT, 'requirements')
DATA = os.path.join(REQ, 'DATA')
OUT = os.path.join(ROOT, 'kit', 'db')

# product id → (svg, clean image, symbols image, kind, compliant, note)
PRODUCTS = {
    'snowman': ('DATA/Output/Painting Kit/Snowman Sparkling Pearl Diamond Painting Kit - Snowman & Hot Cocoa reference_symbols_only.svg',
                'DATA/Output/Painting Kit/Snowman Sparkling Pearl Diamond Painting Kit - Snowman & Hot Cocoa 3.png',
                'DATA/Output/Painting Kit/Snowman Sparkling Pearl Diamond Painting Kit - Snowman & Hot Cocoa 1.jpg',
                'painting', 1, 'real product, new catalog'),
    'dachshund': ('DATA/Output/Ornament/Dog Christmas Suncatcher Diamond Art Hanging Ornament Kit reference_symbols_only.svg',
                  'DATA/Output/Ornament/Dog Christmas Suncatcher Diamond Art Hanging Ornament Kit - Dachshund 2.png',
                  'DATA/Output/Ornament/Dog Christmas Suncatcher Diamond Art Hanging Ornament Kit - Dachshund 1.png',
                  'ornament', 1, 'real product, new catalog'),
    'king': ('FIle Map đá/Royal King Pearl Diamond Painting Kit - Navy Gold Regalia_reference_symbols_only.svg',
             'FIle Map đá/Royal King Pearl Diamond Painting Kit - Navy Gold Regalia_3.png',
             'FIle Map đá/Royal King Pearl Diamond Painting Kit - Navy Gold Regalia_1.png',
             'painting-layer', 0, 'old sample: off-catalog codes, digit symbols for stones'),
    'queen': ('FIle Map đá/Royal Queen Pearl Diamond Painting Kit - Red Gold Regalia_reference_symbols_only.svg',
              'FIle Map đá/Royal Queen Pearl Diamond Painting Kit - Red Gold Regalia_3.jpg',
              'FIle Map đá/Royal Queen Pearl Diamond Painting Kit - Red Gold Regalia_1.png',
              'painting-layer', 0, 'old sample: off-catalog codes, digit symbols for stones'),
    'starry': ('FIle Map đá/Starry Night Pearl Diamond Painting Kit - Royal Arch_reference_symbols_only.svg',
               'FIle Map đá/Starry Night Pearl Diamond Painting Kit - Royal Arch_3.jpg',
               'FIle Map đá/Starry Night Pearl Diamond Painting Kit - Royal Arch_1.png',
               'painting-layer', 0, 'old sample: off-catalog codes, digit symbols for stones'),
}

RE_G = re.compile(r'<g transform="matrix\(([^)]*)\)">(<ellipse [^>]*/>)(<ellipse [^>]*/>)</g>\s*(<text [^>]*>[^<]*</text>)')
RE_A = re.compile(r'([\w:-]+)="([^"]*)"')


def attrs(tag):
    return dict(RE_A.findall(tag))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_lab(rgb):
    px = np.uint8([[rgb[::-1]]])
    L, a, b = cv2.cvtColor(px, cv2.COLOR_BGR2LAB)[0, 0].astype(float)
    return L * 100 / 255, a - 128, b - 128


def de76(p, q):
    return math.dist(to_lab(p), to_lab(q))


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def load_csv(path):
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def main():
    os.makedirs(os.path.join(OUT, 'source'), exist_ok=True)
    src = {
        'stones_active_v2_catalog_corrected.csv': 'DATA/data/stones_active_v2_catalog_corrected.csv',
        'stones_active_v1.csv': 'DATA/data/stones_active_v1.csv',
        'reference_sizes_v1.csv': 'DATA/data/reference_sizes_v1.csv',
        'catalog_code_manifest_v39.json': 'DATA/data/catalog_code_manifest_v39.json',
        'catalog_manifest.json': 'DATA/data/catalog_reference_images/catalog_manifest.json',
        'production_rules.txt': 'DATA/yeu cau san xuat.txt',
    }
    for dst, s in src.items():
        shutil.copyfile(os.path.join(REQ, s), os.path.join(OUT, 'source', dst))

    dbp = os.path.join(OUT, 'kit.sqlite')
    if os.path.exists(dbp):
        os.remove(dbp)
    db = sqlite3.connect(dbp)

    # --- catalog: every CSV column verbatim (TEXT) + typed copies
    cat = load_csv(os.path.join(REQ, src['stones_active_v2_catalog_corrected.csv']))
    cols = list(cat[0].keys())
    db.execute('CREATE TABLE catalog (%s, PRIMARY KEY(stone_code))' % ', '.join('"%s" TEXT' % c for c in cols))
    db.executemany('INSERT INTO catalog VALUES (%s)' % ','.join('?' * len(cols)), [[r[c] for c in cols] for r in cat])
    catalog = {r['stone_code']: r for r in cat}

    sizes = load_csv(os.path.join(REQ, src['reference_sizes_v1.csv']))
    db.execute('CREATE TABLE size_map (physical_mm REAL PRIMARY KEY, reference_mm REAL, status TEXT, rule TEXT, notes TEXT)')
    db.executemany('INSERT INTO size_map VALUES (?,?,?,?,?)',
                   [(float(r['physical_diameter_mm']), float(r['reference_diameter_mm']), r['status'], r['rule'], r['notes']) for r in sizes])

    man = json.load(open(os.path.join(REQ, src['catalog_code_manifest_v39.json']), encoding='utf-8'))
    db.execute('CREATE TABLE code_manifest (code TEXT PRIMARY KEY, in_catalog_csv INTEGER, manifest_version TEXT)')
    db.executemany('INSERT OR IGNORE INTO code_manifest VALUES (?,?,?)',
                   [(c, int(c in catalog), man.get('version')) for c in man['codes']])

    rules_txt = open(os.path.join(REQ, src['production_rules.txt']), encoding='utf-8').read()
    rules = {
        'max_codes_target': 13, 'max_codes_hard': 15,
        'stone_symbol': 'uppercase letter, must map to a real catalog code',
        'pearl_symbol': 'digit(s) = pearl diameter in mm',
        'symbols_scope': 'per design (same code may have different symbols in different designs)',
        'source_text': rules_txt,
    }
    db.execute('CREATE TABLE rules (key TEXT PRIMARY KEY, value TEXT)')
    db.executemany('INSERT INTO rules VALUES (?,?)', [(k, json.dumps(v, ensure_ascii=False)) for k, v in rules.items()])

    # --- products and per-stone rows
    db.execute('''CREATE TABLE products (id TEXT PRIMARY KEY, kind TEXT, compliant INTEGER, note TEXT,
        canvas_mm REAL, viewbox_px REAL, px_per_mm REAL, svg TEXT, clean_image TEXT, symbols_image TEXT,
        n_stones INTEGER, n_codes INTEGER, physical_coverage REAL)''')
    stone_cols = ['product', 'position_id', 'code', 'symbol', 'symbol_kind', 'shape', 'cx_px', 'cy_px', 'x_mm', 'y_mm',
                  'physical_mm', 'reference_mm', 'svg_w_mm', 'svg_h_mm', 'rotation_deg', 'group_name',
                  'svg_edge_hex', 'svg_fill_hex', 'svg_inner_ratio', 'font_px', 'text_dx_px', 'text_dy_px',
                  'in_catalog', 'catalog_series', 'catalog_hex', 'catalog_family', 'catalog_physical_mm', 'size_matches_catalog',
                  'img_mean_hex', 'img_std', 'img_sat', 'img_peak', 'de76_img_vs_catalog', 'de76_svgfill_vs_catalog',
                  'nn1_mm', 'nn1_gap_mm', 'n_touch', 'n_within_2pitch']
    db.execute('CREATE TABLE stones (%s)' % ', '.join(stone_cols))
    db.execute('''CREATE TABLE bom (product TEXT, code TEXT, symbol TEXT, symbol_kind TEXT, physical_mm REAL, reference_mm REAL,
        count INTEGER, in_catalog INTEGER, catalog_hex TEXT, svg_fill_hex TEXT, spec_symbol_ok INTEGER, PRIMARY KEY(product, code))''')

    summary = {}
    for pid, (svgp, cleanp, symp, kind, compliant, note) in PRODUCTS.items():
        svg = open(os.path.join(REQ, svgp), encoding='utf-8').read()
        root = attrs(svg[svg.find('<svg'):svg.find('>', svg.find('<svg'))])
        vb = float(root['viewBox'].split()[2])
        canvas_mm = float(root['width'].rstrip('m'))
        ppm = vb / canvas_mm
        img = cv2.imread(os.path.join(REQ, cleanp), cv2.IMREAD_COLOR)
        if img.shape[0] != int(vb):
            img = cv2.resize(img, (int(vb), int(vb)), interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        rows = []
        for m in RE_G.finditer(svg):
            o, i, t = attrs(m.group(2)), attrs(m.group(3)), attrs(m.group(4))
            text = re.search(r'>([^<]*)</text>', m.group(4)).group(1)
            code = o['data-stone-code']
            grp = o.get('data-group', '')
            phys = num(grp.split('_S')[-1]) if '_S' in grp else None
            cx, cy = float(o['data-center-x-source-px']), float(o['data-center-y-source-px'])
            w = float(o['data-width-mm'])
            c = catalog.get(code)
            sym = o['data-symbol']
            rows.append(dict(product=pid, position_id=o['data-position-id'], code=code, symbol=sym,
                             symbol_kind='digit' if sym.isdigit() else ('letter' if sym.isalpha() and sym.isupper() else 'other'),
                             shape=o.get('data-shape'), cx_px=cx, cy_px=cy, x_mm=cx / ppm, y_mm=cy / ppm,
                             physical_mm=phys, reference_mm=num(o.get('data-reference-width-mm')) or w,
                             svg_w_mm=w, svg_h_mm=float(o['data-height-mm']), rotation_deg=float(o['data-rotation-deg']),
                             group_name=grp, svg_edge_hex=o['fill'].upper(), svg_fill_hex=i['fill'].upper(),
                             svg_inner_ratio=float(i['rx']) / float(o['rx']), font_px=num(t['font-size'].rstrip('px')),
                             text_dx_px=float(t['x']) - cx, text_dy_px=float(t['y']) - cy,
                             in_catalog=int(c is not None), catalog_series=c and c['series'],
                             catalog_hex=c and c['color_hex_reference'].upper(), catalog_family=c and c['color_family'],
                             catalog_physical_mm=c and num(c['physical_diameter_mm'])))
        P = np.array([[r['x_mm'], r['y_mm']] for r in rows])
        phys = np.array([r['physical_mm'] or r['svg_w_mm'] for r in rows])
        D = np.sqrt(((P[:, None] - P[None]) ** 2).sum(-1))
        np.fill_diagonal(D, 1e9)
        gap = D - (phys[:, None] + phys[None]) / 2
        H, W = gray.shape
        for k, r in enumerate(rows):
            j = int(D[k].argmin())
            r['nn1_mm'] = float(D[k, j])
            r['nn1_gap_mm'] = float(gap[k].min())
            r['n_touch'] = int((gap[k] < 0.6).sum())
            r['n_within_2pitch'] = int((D[k] < 2 * (phys[k] + 0.2)).sum())
            r['size_matches_catalog'] = None if r['catalog_physical_mm'] is None else int(abs(r['catalog_physical_mm'] - phys[k]) < 0.05)
            # image sample: disc of radius 0.35 × physical diameter around the centre
            rad = max(1, int(round(0.35 * phys[k] * ppm)))
            x0, y0 = int(round(r['cx_px'])), int(round(r['cy_px']))
            ys, xs = np.ogrid[-rad:rad + 1, -rad:rad + 1]
            disc = xs * xs + ys * ys <= rad * rad
            ya, yb, xa, xb = max(0, y0 - rad), min(H, y0 + rad + 1), max(0, x0 - rad), min(W, x0 + rad + 1)
            dm = disc[ya - (y0 - rad):yb - (y0 - rad), xa - (x0 - rad):xb - (x0 - rad)]
            patch = img[ya:yb, xa:xb][dm]
            mean = patch.mean(0)[::-1]
            rgb = tuple(int(round(v)) for v in mean)
            r['img_mean_hex'] = '#%02X%02X%02X' % rgb
            r['img_std'] = float(gray[ya:yb, xa:xb][dm].std())
            r['img_sat'] = float(hsv[ya:yb, xa:xb][dm][:, 1].mean())
            r['img_peak'] = float(np.percentile(gray[ya:yb, xa:xb][dm], 98))
            r['de76_img_vs_catalog'] = de76(rgb, hex_rgb(r['catalog_hex'])) if r['catalog_hex'] else None
            r['de76_svgfill_vs_catalog'] = de76(hex_rgb(r['svg_fill_hex']), hex_rgb(r['catalog_hex'])) if r['catalog_hex'] else None
        db.executemany('INSERT INTO stones VALUES (%s)' % ','.join('?' * len(stone_cols)), [[r[c] for c in stone_cols] for r in rows])

        area = float((np.pi * (phys / 2) ** 2).sum())
        canvas_area = canvas_mm ** 2 * (math.pi / 4 if kind == 'ornament' else 1)
        bom = collections.OrderedDict()
        for r in rows:
            b = bom.setdefault(r['code'], dict(r, count=0))
            b['count'] += 1
        for code, b in bom.items():
            is_pearl = b['catalog_series'] == 'PEARL' or (b['catalog_series'] is None and code.isdigit())
            ok = (b['symbol'] == code) if is_pearl else (b['symbol_kind'] == 'letter')
            db.execute('INSERT INTO bom VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                       (pid, code, b['symbol'], b['symbol_kind'], b['physical_mm'], b['reference_mm'], b['count'],
                        b['in_catalog'], b['catalog_hex'], b['svg_fill_hex'], int(ok)))
        db.execute('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                   (pid, kind, compliant, note, canvas_mm, vb, ppm, svgp, cleanp, symp, len(rows), len(bom), area / canvas_area))
        summary[pid] = dict(stones=len(rows), codes=len(bom), coverage=round(area / canvas_area, 4),
                            off_catalog=sorted(c for c, b in bom.items() if not b['in_catalog']))

    db.commit()
    # JSON exports for node (lib/kit/*): one file per table
    db.row_factory = sqlite3.Row
    for tbl in ('catalog', 'size_map', 'code_manifest', 'rules', 'products', 'bom'):
        data = [dict(r) for r in db.execute('SELECT * FROM %s' % tbl)]
        json.dump(data, open(os.path.join(OUT, tbl + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for pid in PRODUCTS:
        data = [dict(r) for r in db.execute('SELECT * FROM stones WHERE product=?', (pid,))]
        json.dump(data, open(os.path.join(OUT, 'stones_%s.json' % pid), 'w', encoding='utf-8'), ensure_ascii=False)
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
