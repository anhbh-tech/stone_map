# KIT stone-map SVG — `pearl-kit-map/1`

Writer/reader: `lib/kit/svgio.js` (`writeKitSvg(doc)`, `readKitSvg(svg)`, `normalizeDoc(doc)`).
Produced by the KIT lab (`/kit.html`, `POST /api/kit-lab/run` → `lib/kit/detect.js` `buildKit`).
Tests: `tools/test_kit.mjs` (write → read identical, byte-identical rewrite, the 3 sample files read as 6691 / 3066 / 3230 stones).

The sample files `*_reference_symbols_only.svg` are only a **format** reference (how one stone is written), not ground truth for placement.

## Document (what `readKitSvg` returns, what `writeKitSvg` takes)

```
{ schema: 'pearl-kit-map/1',
  canvas:  { widthMm, heightMm, pxPerMm, widthPx, heightPx },     // pxPerMm 11.81 → 300 mm = 3543 px
  params:  { mode, canvasWmm, canvasHmm, stoneMm, gapMm, accentMm, maxColors, sensitivity?, dropBg },
  source:  { name, sha1, widthPx, heightPx, frame: { scale, x, y } } | null,   // frame: map px = x + scale · image px
  createdAt, stats,                                                 // see "Stats" below
  palette: [{ code, symbol, rgb, dMm, edge, text, fontPx }],       // one entry per code; a code has ONE size
  bom:     [{ code, symbol, dMm, count }],                          // sorted by count desc, then code
  layers:  [{ id, name, count }],
  stones:  [{ id, symbol, code, x, y, dMm, rot, group, layer }],   // x, y = map px of the centre; ordered by layer
  legacy }                                                          // read only: true = file had no metadata
```

`normalizeDoc` is the canonical form: numbers rounded to 1e-6, `edge` = fill × 0.42, `text` = `#111111` on light fills (luma > 145) else `#FFFFFF`, `fontPx` from the sample sizes (2.2 → 25, 3.2 → 35, 4.2 → 47, 5.2 → 60, 7.2 → 79 px at 11.81 px/mm), `group` = `K_<code>_S<physical mm>` (sample sizes 2.2 → S2.8, 3.2 → S4, 4.2 → S5, 5.2 → S6, 7.2 → S8; other draw sizes via the catalog `size_map`, `lib/kit/catalog.js`), unused palette entries dropped, stones stably sorted by layer (the order the file is written in).

## File layout

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="300mm" height="300mm" viewBox="0 0 3543 3543" data-schema="pearl-kit-map/1" data-px-per-mm="11.81">
<title>Pearl kit map 300×300 mm — 6544 viên, 80 mã</title>
<desc>…sizes, layers, source name + sha1, mode, time…</desc>
<metadata id="pearl-kit-meta" data-schema="pearl-kit-map/1"><![CDATA[{ schema, canvas, params, palette, bom, layers, source, createdAt, stats }]]></metadata>
<g id="S2.2" data-layer="S2.2" inkscape:groupmode="layer" inkscape:label="Đá 2.2mm"> …stones… </g>
<g id="S3.2" …> … </g>
<g id="LEGEND" data-layer="LEGEND" inkscape:groupmode="layer" inkscape:label="Legend (ngoài canvas)"> … </g>
</svg>
```

- Root `width`/`height` are millimetres (print size); `viewBox` is map px. `data-px-per-mm` is authoritative; without it the reader uses `viewBox width / width mm`.
- Metadata holds everything except the stones (they are in the markup). In the JSON, `]]>` is escaped as `]]>`.
- One Inkscape layer per stone size (`S<dMm>`). The reader takes layer ids from `data-layer`.
- `LEGEND` sits to the right of the canvas (x = canvas width + 10 mm): one `<g data-legend-code>` row per BOM entry (disc + symbol, then `code rgb size ×count`). Browsers clip it; Inkscape shows it beside the page. The reader skips it.

## One stone (unchanged from the sample files)

```xml
<g transform="matrix(a b -b a X Y)"><ellipse cx="0" cy="0" rx="r" ry="r" fill="EDGE" data-position-id="P00003" data-symbol="8"
  data-stone-code="L74" data-shape="round" data-center-x-source-px="X" data-center-y-source-px="Y" data-width-mm="2.200000"
  data-height-mm="2.200000" data-rotation-deg="-90.000000" id="P00003" data-group="K_L74_S2.8" data-reference-width-mm="2.2"
  data-reference-height-mm="2.2"/><ellipse cx="0" cy="0" rx="0.87r" ry="0.87r" fill="RGB" /></g>
<text x="X − advance/2" y="Y + 0.36·fontPx" font-family="Arial" font-weight="700" font-size="25.000px" fill="TEXT" data-position-id="P00003">8</text>
```

`a = pxPerMm·cos(rot)`, `b = pxPerMm·sin(rot)`, `r = dMm/2` (mm, scaled by the matrix). This is byte-for-byte what `toKitSvg` (KIT-1, `lib/kit/svg.js`) writes, so `parseKitSvg` reads the new files as well.

## Reading old files

A file with no `<metadata>` is read as legacy: canvas from `width`/`height` mm + `viewBox`, a layer is any `<g id>` without `transform` (the samples have one, `REFERENCE_MAP`), and the palette comes from the first stone of each code (inner fill = `rgb`, outer = `edge`, text fill, font size). The reader fails when the text does not match its stone (`data-position-id` / `data-symbol`), when it reads fewer stones than there are `data-position-id` ellipses, or on an unknown schema.

## Stats (`stats` in metadata, shown in kit.html)

| key | meaning |
|---|---|
| `stones`, `sizes`, `codes`, `colors` | count, `{dMm: n}`, palette codes, colour clusters (a code = colour × size: `C01`, `C01@4.2`) |
| `nnMm`, `gapMm` | p10/median/p90 nearest centre distance and edge gap (mm) |
| `violations` | pairs with `overlap` (gap < −0.05 mm) and `tooClose` (gap < `gapMm` − 0.1); `minGapMm` |
| `isolatedPct` | % stones with no touching neighbour (gap < 1.5 mm) of the same code |
| `emptyPct` | % of the mask (0.5 mm grid) farther than `gapMm` from every stone edge |
| `check.deltaE00`, `check.ssim` | render vs input, both on white, blurred σ = 1 stone step, mean ΔE00 and SSIM (luminance) inside the mask; render `flat` (PLACE, solid discs) or `clean` (DETECT, KIT-1 shaded pearls); ≤ 700 px |
| `density` | `coverage` = stone area / mask area, `hexCoverage` = π d² / (2√3 (d + gap)²), `ratio` = coverage / hex |
| `work` + `measuredMm` (DETECT) | detector scale info and the histogram of measured bead sizes before snapping |
| `big` (DETECT) | KIT-12a large smooth objects kept as ONE stone (`bigObjects`): `count`, `sizes` (physical mm histogram), `flagged` = ovals (catalog has no oval series; size = largest round ≤ √(a·b)) and `oversize` (> 1.15 × largest catalog size) with axes, for the captain |
| `tiers` (DETECT) | stones per size tier (1 = ≥ 8 mm, 2 = 5–7 mm, 3 = 2.8–4 mm, physical) and material (`gold` / `pearl` / `white` / `color`, `materialOf`); `work.tiers` = totals, `work.countHints` = per-crop `{hint, before, after}` when `params.countHints` was given |
| `place` (PLACE) | engine (`kit-2 place`, `kit-2 placeStones`, or `hex-stub`) and its params/stats |

Mask: alpha ≥ 128 if the image has alpha; else with `dropBg` the pixels that differ from the top-left colour by > 12; else the whole image.
