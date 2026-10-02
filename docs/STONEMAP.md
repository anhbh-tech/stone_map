# STONEMAP (SM-P0: nền móng)

Kế hoạch: `docs/STONEMAP-PLAN.md`. Code: `lib/stonemap/`, test: `node tools/test_stonemap.mjs` (trong `npm test`, $0 API, ~0.3 s).
Chỉ import `lib/kit/*` (OVERLAP_TOL, rgbToLab/de2000), không sửa.

## design.json, nguồn sự thật duy nhất (`lib/stonemap/design.js`)

```
{ format: 'stonemap-design/1', id, canvas: { w_mm, h_mm }, catalogVersion,
  layers: [{ id: 'bg'|'costume'|'pet', stones: [{ id, layer, code, shape, x_mm, y_mm, phys_mm, ref_mm, rot_deg, locked, source }] }],
  symbols: { code: sym },
  expected?: { total, byCode },   // BOM sản phẩm (cho QC layer-total)
  meta? }
```

- Toạ độ là tâm viên, đo bằng mm từ góc trên-trái.
- `phys_mm` là cỡ vật lý; với đá không tròn đây là cạnh dài, trục dài dọc khi `rot_deg = 0`. `ref_mm` là cỡ vẽ.
- Layer đúng thứ tự `bg < costume < pet`.
- `validate(d)` trả lỗi cấu trúc: id trùng, layer lạ/sai thứ tự, số không hợp lệ, tâm ngoài canvas, mã chưa có ký hiệu.
- `counts(d)` trả `{ total, codes, byCode, byLayer }`. `diff(a, b)` so theo id viên.

## Catalog (`lib/stonemap/catalog.js`)

- Bọc `kit/db/kit.sqlite`, gồm cả 432 mã thuộc 7 shape: tròn 148, marquise 74, giọt 116, tim 39, hoa 35, sao 17, hồng 3.
- `catalogVersion = 'cat-' + sha1(bảng catalog sắp theo mã)[:12]`, hiện tại là `cat-51b4105591b8`.
- Đá không tròn: `physW×physH` / `refW×refH` lấy từ catalog, ví dụ M011 3×6 vẽ 2.6×5.2.
- Đá tròn: `ref` lấy theo `size_map`; thiếu dòng thì dùng vật lý − 0.8 (ngọc trai 7 → 6.2).
- `assignSymbols(counts, cat, fixed)`:
  - đá nhận 1 chữ trong `A B C E F G J K N P R T U V Y` (bỏ chữ đầu series L Z W D Q M S X H và I O), mã nhiều viên nhận chữ trước;
  - ngọc trai nhận số đúng bằng cỡ;
  - ký hiệu duy nhất trong design; ký hiệu đã chốt hợp luật thì giữ nguyên;
  - quá 15 mã đá thì báo lỗi.

## SVG sửa được (`lib/stonemap/svg.js`)

- `viewBox` đơn vị mm. `<desc id="stonemap">` chứa header JSON: id, canvas, catalogVersion, symbols, expected.
- Mỗi layer là 1 `<g id="layer-<id>" data-layer>`.
- Mỗi viên là `<g data-id data-code data-layer data-shape data-phys data-ref data-locked data-source transform="translate(x y) rotate(r)">`, bên trong có:
  - hình vẽ ở cỡ REF, đúng shape: tròn / marquise / giọt / tim / sao / hoa / hồng;
  - `<text>` ký hiệu, giữ thẳng đứng.
- `readSvg` đọc ngược lại design: mã, cỡ, layer lấy từ `data-*`; vị trí và góc lấy từ transform.
  - Hỗ trợ `translate`, `rotate(a cx cy)`, `scale`, `matrix`, và cộng thêm transform của layer.
  - Nhờ đó kéo hay xoay viên trong Inkscape rồi nhập lại vẫn ra toạ độ đúng (có test).

## QC plugin (`lib/stonemap/qc/`)

- Mỗi file `*.js` (trừ `index.js`) là 1 kiểm định, dạng `export default { id, level, title, run(design, ctx) → findings[] }`.
- `runQc(design, ctx)` trả `{ status, checks[] }`; status là mức nặng nhất trong các mức `pass < info < warn < error`.
- Thêm kiểm định = thêm 1 file, hoặc gọi `register()`.

| id | luật |
|---|---|
| `code-count` | ≤ 13 mã: pass; 14–15: warn; > 15: error (bảng `rules`) |
| `catalog` | mã có trong catalog; shape, cỡ vật lý, cỡ vẽ (size_map) khớp; version design = version catalog |
| `overlap` | khe mép-mép VẬT LÝ < −0.05 mm là chồng (error). Mọi shape (tròn chính xác, khác theo đa giác), xét cả khác layer |
| `gap` | khe tới viên gần nhất: phân bố 5 bin (info), viên sát < 0.15 mm (chưa chồng) báo warn |
| `symbols` | đá = 1 chữ hoa (sai: error; chữ ngoài bộ 15: warn), ngọc trai = cỡ, không trùng |
| `layer-total` | viên đúng layer chứa nó; Σ layer = BOM (tổng và từng mã) |
| `holes` | stub: `ctx.mask` → điểm trong mask còn trống đủ đặt 1 viên 2.8 mm (warn); không có mask → info |
| `delta-e` | stub: `ctx.mockup` + `ctx.preview` (RGBA cùng cỡ) → ΔE00 trung bình, warn khi > 10; thiếu ảnh → info |

## Adapter sản phẩm thật (`lib/stonemap/import.js`)

`importProduct('snowman' | 'dachshund' | …)` đọc bảng `stones` và chuyển thành design 1 layer `bg`:
- id lấy từ `position_id`, `locked: true`, `source: 'db:<product>'`;
- mm làm tròn tới 1e-4;
- ký hiệu giữ nguyên như sản phẩm thật, kể cả chỗ phạm luật;
- `expected` lấy từ bảng `bom`.

## Kết quả trên 2 sản phẩm thật (output: `outputs/stonemap/<p>.svg|.design.json|.qc.json`)

| | Snowman | Dachshund |
|---|---|---|
| viên / mã | 3233 / 15 | 2147 / 12 |
| round-trip design → svg → design | **0 lệch** (0 thiếu, 0 thừa, 0 đổi), cả ký hiệu + BOM, lần 2 ổn định | **0 lệch** |
| code-count | **warn** (15 > 13) | pass (12) |
| catalog | pass (cả 15 mã, cỡ vẽ đúng size_map) | pass |
| layer-total | pass, 3233 = BOM, 15 mã khớp | pass, 2147 = BOM |
| overlap | **error: 8 cặp** (16 viên), sâu nhất 0.22 mm (L26/L4 2.8 mm); có 1 cặp Z94 4 mm / L94 0.16 mm | **error: 13 cặp** (26 viên), sâu nhất 0.18 mm (L4/L4); 1 cặp D4 6 mm / L25 0.085 mm |
| gap: chồng / sát / đúng 0.15–0.2 / rộng 0.2–0.5 / rời > 0.5 | 16 / 562 / 883 / 802 / 970, trung vị 0.24 mm → warn (562 viên sát) | 26 / 1346 / 119 / 385 / 271, trung vị 0.148 mm → warn (1346 viên sát) |
| symbols | **error 4 mã** dùng số cho đá: L4 '4', L26 '2', W16 '6', Q114 '1'; warn: Z94 'X', Q121 'H' | **error 4 mã**: L16 '3', L4 '4', L1 '1', D1 '2'; warn: Q114 'D', W4 'H' |
| holes / delta-e | info (chưa có mask / ảnh) | info |

Đối chiếu với dữ liệu trong DB:
- Phân bố khe tự tính khớp cột `nn1_gap_mm`. Dachshund trùng tuyệt đối. Snowman lệch 1 viên ở biên 0.5 mm, do làm tròn 1e-4.
- Số viên chồng khớp DB: 16 / 26 viên có khe < −0.05 mm.
- Các lỗi ký hiệu trùng đúng các mã có `bom.spec_symbol_ok = 0`.
- Hai sản phẩm thật vẫn phạm 3 luật: chồng, ký hiệu số cho đá, khe sát. Đây là chất liệu để kiểm QC, không phải đáp án.
