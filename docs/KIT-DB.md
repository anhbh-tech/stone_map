# KIT-DB — cơ sở dữ liệu tham chiếu cho thuật toán map đá

Dựng lại: `.venv/bin/python tools/build_kit_db.py` (~5 s, cần `requirements/DATA` + `requirements/FIle Map đá`).
Kết quả `kit/db/kit.sqlite` (đọc trong node: `new (require('node:sqlite').DatabaseSync)('kit/db/kit.sqlite')`),
JSON từng bảng `kit/db/<bảng>.json` (trừ `stones`), bản sao nguồn gốc ở `kit/db/source/` (CSV/JSON/TXT y nguyên).
Quy ước rút ra: `docs/KIT-DATA.md`.

## Bảng

| bảng | nguồn | khoá | nội dung |
|---|---|---|---|
| `catalog` | `stones_active_v2_catalog_corrected.csv` | stone_code | 432 mã, **đủ 30 cột gốc dạng TEXT** (size vật lý/reference, màu chuẩn, họ màu, series, shape, nguồn, độ tin cậy, quy tắc mã) |
| `size_map` | `reference_sizes_v1.csv` | physical_mm | vật lý → reference (cỡ vẽ trong SVG), status CONFIRMED/DERIVED |
| `code_manifest` | `catalog_code_manifest_v39.json` | code | 434 mã của manifest, `in_catalog_csv` = có dòng trong `catalog` |
| `rules` | `yeu cau san xuat.txt` | key | luật sản xuất dạng JSON + văn bản gốc |
| `products` | 5 SVG | id | snowman, dachshund (`compliant=1`, sản phẩm thật) · king, queen, starry (`compliant=0`, mẫu cũ) — canvas, px/mm, đường dẫn ảnh, số viên/mã, độ phủ vật lý |
| `bom` | SVG + catalog | product, code | mã → ký hiệu, loại ký hiệu, size vật lý/reference, số viên, có trong catalog, màu catalog vs màu SVG, `spec_symbol_ok` |
| `stones` | SVG + ảnh sạch + catalog | — | 18 367 viên, mỗi viên 1 dòng (cột dưới) |

### `stones`
- Từ SVG: `position_id, code, symbol, symbol_kind (letter/digit/other), shape, cx_px, cy_px, x_mm, y_mm, physical_mm` (từ `data-group … _S<mm>`), `reference_mm, svg_w_mm, svg_h_mm, rotation_deg, group_name, svg_edge_hex, svg_fill_hex, svg_inner_ratio, font_px, text_dx_px, text_dy_px`.
- Từ catalog: `in_catalog, catalog_series, catalog_hex, catalog_family, catalog_physical_mm, size_matches_catalog`.
- Từ ảnh sạch (`_3` / `Dachshund 2`), đĩa bán kính 0.35×size vật lý quanh tâm: `img_mean_hex, img_std` (độ lệch xám = độ lấp lánh), `img_sat` (bão hoà HSV), `img_peak` (xám p98 = đốm sáng), `de76_img_vs_catalog, de76_svgfill_vs_catalog`.
- Hình học: `nn1_mm` (tâm tới tâm gần nhất), `nn1_gap_mm` (khe vật lý), `n_touch` (số viên khe < 0.6 mm), `n_within_2pitch`.

## Phát hiện từ DB (đối chứng cho thuật toán)
- SVG thật tô `svg_fill_hex` **đúng bằng** `catalog_hex` (ΔE 0.0 ở snowman/dachshund/king/queen; starry lệch 23.4) → màu trong SVG xuất ra = màu catalog, không phải màu lấy từ ảnh.
- Màu ảnh tại tâm đá lệch màu catalog trung bình ΔE76 19.1 (snowman) / 29.9 (dachshund) → không thể gán mã chỉ bằng "màu gần nhất" theo RGB catalog; cần học ánh xạ màu-ảnh → mã từ bảng `stones` (ví dụ k-NN theo `img_mean_hex` + size).
- Size vật lý khớp catalog 100% (0 sai lệch) ở 2 sản phẩm thật.
- Đặc trưng ảnh theo series (snowman | dachshund): ngọc trai std 19.8/21.7, sat 57/71, peak 253; Z (4 mm, đa số trắng Z94) std 17.6, sat 48 — **giống ngọc trai** → trắng-mịn chưa đủ để nhận ngọc trai, phải dùng **size** (ngọc 5–7 mm, Z 4 mm, L 2.8 mm). Đá Q mài giác: std 54–57, sat 203–216.
- Khoảng cách tâm gần nhất: L 3.20 mm (n_touch 1.9), Z 4.29 (1.6), ngọc 5 mm 4.64 (3.3), ngọc 7 mm 7.86 (0.2), Q 10 mm 10.7.
- Viên có xoay ≠ 0: snowman 33 %, dachshund 75 % (đá tròn nên chỉ ảnh hưởng hướng chữ).
- Chữ: font trung bình 25–28 px, lệch tâm text (−8.5, +9.3) px, vòng trong = 0.87 × vòng ngoài — giống nhau ở cả 5 file.
- Mẫu cũ: king 8, queen 4, starry 11 mã không có trong catalog.

## Truy vấn mẫu
```sql
SELECT code, symbol, count FROM bom WHERE product='snowman' ORDER BY count DESC;
SELECT catalog_series, physical_mm, avg(img_std), avg(img_sat) FROM stones WHERE product IN ('snowman','dachshund') GROUP BY 1,2;
SELECT * FROM catalog WHERE series='PEARL';
```
