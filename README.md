# Stone Map: map đá cho tranh pet personalized

Hệ thống nhận một thiết kế gồm 3 layer: **background**, **trang phục** và **pet**. Từ đó nó sinh ra 3 thứ:

- **bản đồ đá SVG** để xưởng đính đá, sửa được;
- **BOM**: danh sách mã đá và số lượng theo từng layer;
- **mockup** để khách xem trước.

Ràng buộc sản xuất được lấy từ `requirements/DATA/yeu cau san xuat.txt`:
- Mỗi thiết kế dùng **lý tưởng 13 mã, tối đa 15 mã**.
- Ký hiệu: đá là chữ in hoa, ngọc trai là số bằng cỡ (mm).
- Chỉ dùng mã có trong catalog.

Thước đo chính là **bản máy làm phải đúng nhất có thể so với bản designer duyệt**, để designer phải sửa ít nhất.

> Tách ra từ phòng thí nghiệm nội bộ `pearl_compare` (chỉ giữ phần map đá). Dữ liệu `requirements/` không nằm trong repo: đặt thư mục đó ở gốc repo (hoặc symlink) trước khi dựng DB hay chạy template.

---

## Trạng thái (`features/initial_approach`)

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| P0 | `design.json` 3 layer, catalog có version, QC dạng plugin, SVG đọc và ghi 2 chiều | ✅ Ghi rồi đọc lại Snowman/Dachshund thật **không lệch viên nào** |
| P1 | Template background Starry (đính kín) và trang phục Queen (map 1 lần) | 🟡 Starry: 11.759 viên, phủ 80,5%. Queen: KIT-20 xong bản đầu (mỗi hạt vẽ thành 1 viên, SAM2), chờ chốt tim 19 mm / viền vàng ~1 mm / ngọc < 5 mm |
| P2 | Layer pet mỗi order, không gọi API | 🟡 Điểm bench 46,5 → 66,1; pet chỉ thêm ≤ 2 mã mới |
| P3 | Ghép 3 layer, đếm theo layer, BOM + legend, mockup | 🟡 Có pipeline; chờ template Queen bản KIT-20 |
| P4–P6 | Màn QC designer, delivery link + CRM, mở rộng | ⏸ Chưa làm |

Kế hoạch chi tiết: [`docs/STONEMAP-PLAN.md`](docs/STONEMAP-PLAN.md).

---

## Cài đặt

| Thành phần | Yêu cầu | Dùng cho |
|---|---|---|
| Node.js | ≥ 22.5 (cần `node:sqlite`; đã chạy trên 26.7) | Toàn bộ pipeline và test. Không có dependency npm. |
| Python venv `.venv` | `numpy`, `opencv-python` | `tools/build_kit_db.py` (dựng DB), đọc JPEG (`tools/pixels.py`) |
| `rsvg-convert` | `brew install librsvg` | Render glyph và legend PNG |
| Real-ESRGAN (tùy chọn) | `realesrgan-ncnn-vulkan` + model `realesrgan-x4plus` trong `~/.cache/realesrgan/` hoặc `tools/bin/`, hoặc đặt `REALESRGAN_BIN` | Upscale ×4. Thiếu thì tự dùng Lanczos (bench cho thấy kết quả gần bằng) |
| SAM2 (tùy chọn, KIT-20) | torch (MPS) + checkpoint SAM2-small trong `~/.cache` | Tách từng hạt cho template trang phục |

```bash
python3 -m venv .venv && .venv/bin/pip install numpy opencv-python
.venv/bin/python tools/build_kit_db.py      # dựng kit/db/kit.sqlite (~5 s) từ requirements/DATA
npm test                                     # 3 bộ test (kit, place, stonemap), không mạng, không tốn API
```

Không commit: binary, model, `.env` (API key), `outputs/`, `requirements/`. Tất cả đã nằm trong `.gitignore`.

### Dữ liệu đầu vào (`requirements/`, không nằm trong git)

```
requirements/
  DATA/data/stones_active_v2_catalog_corrected.csv   catalog 432 mã (màu, cỡ, shape)
  DATA/data/reference_sizes_v1.csv                   cỡ vật lý → cỡ vẽ
  DATA/yeu cau san xuat.txt                          luật sản xuất
  DATA/1..5.png, Output/                             2 sản phẩm thật (Snowman, Dachshund) = ground truth
  FIle Map đá/                                       mẫu SVG cũ King/Queen/Starry (chỉ tham khảo định dạng, KHÔNG đúng spec)
  Trang phục Queen.png, Trang phục King.png          ảnh trang phục cố định (AI vẽ sẵn hạt, nền caro giả)
  BG.png                                             background Starry
```

---

## Khái niệm cốt lõi

- **Cỡ vật lý và cỡ vẽ (reference)**
  - Va chạm, khe hở và độ phủ đều tính theo cỡ **vật lý**. Khe mục tiêu là 0.15–0.2 mm.
  - SVG vẽ theo cỡ **reference**, nhỏ hơn cỡ vật lý: 2.8 → 2.2, 4 → 3.2, 5 → 4.2, 8 → 7.2; các cỡ khác lấy vật lý − 0.8.
- **Catalog**
  - Chữ đầu mã cho biết loại đá:

    | Chữ đầu | Loại |
    |---|---|
    | `L` | tròn 2.8 mm |
    | `Z` | tròn 4 mm |
    | `W` | tròn 5 mm |
    | `D` | tròn 6 mm |
    | `Q` | tròn mài giác |
    | `M` | marquise |
    | `S` | giọt |
    | `X` | tim / sao |
    | `H` | hoa |

  - Ngọc trai có mã là số, bằng đường kính.
  - Catalog có version: `catalogVersion` là hash nội dung, nên mỗi design ghim đúng catalog nó đã dùng.
- **Ký hiệu**
  - Đá dùng `A B C E F G J K N P R T U V Y`. Không dùng chữ trùng chữ đầu series (L Z W D Q M S X H) và I O để tránh đọc nhầm.
  - Ngọc trai dùng số bằng cỡ, ví dụ `5`, `10`.
  - Ký hiệu chỉ duy nhất trong phạm vi một thiết kế.
- **Màu ảnh khác màu catalog**: lệch ΔE76 khoảng 19–30. Vì vậy **không gán mã theo màu gần nhất**; mã được học từ dữ liệu thật (k-NN trên bảng `stones`).
- **Layer**: thứ tự vẽ là `bg < costume < pet`. Ở chỗ hai layer đè nhau thì bỏ viên của layer dưới; viên `locked` (đã được người duyệt) không bao giờ bị bỏ.

Chi tiết quy ước rút ra từ sản phẩm thật: [`docs/KIT-DATA.md`](docs/KIT-DATA.md). Schema DB: [`docs/KIT-DB.md`](docs/KIT-DB.md).

---

## Kiến trúc

```
catalog (kit.sqlite, có version) ─┐
template BG (Starry, map 1 lần) ──┤
template trang phục (Queen…) ─────┼─► compose ─► design.json ─► QC (10 plugin) ─► map.svg · bom.csv/json · legend.png · mockup
layer pet (mỗi order, $0 API) ────┘
```

| Thư mục / file | Vai trò |
|---|---|
| `lib/stonemap/design.js` | Schema `stonemap-design/1`, `validate`, `counts` (theo layer và tổng), `diff` |
| `lib/stonemap/catalog.js` | Bọc `kit.sqlite`, đủ 7 shape, `catalogVersion`, `assignSymbols` |
| `lib/stonemap/svg.js` | Xuất SVG sửa được (mỗi layer một `<g>`, mỗi viên có `data-*`) và đọc ngược về `design.json`, kể cả transform của Inkscape |
| `lib/stonemap/qc/` | Registry kiểm định: số mã, mã có trong catalog, chồng viên, khe hở, ký hiệu, tổng theo layer, viên ngoài vùng, cảnh báo gộp mã, lỗ trống, ΔE |
| `lib/stonemap/compose.js` | Ghép 3 layer, xử lý va chạm ở mép, gán lại ký hiệu cho cả sản phẩm |
| `lib/stonemap/bom.js` | BOM: symbol → mã → thông tin catalog → số viên theo layer, cộng 10% dự phòng; xuất legend |
| `lib/stonemap/render3d.js` | Mockup tĩnh có shading theo shape |
| `lib/kit/detect.js` | Dò hạt theo tầng cỡ ≥ 8 → 5–7 → 2.8–4 mm, tách nền caro giả (`backgroundMask`) |
| `lib/kit/select.js` | `mapCostume` / `mapStarry`: phủ kín vùng, làm mượt mã bằng Potts/ICM |
| `lib/kit/pet.js` | Layer pet: upscale → LoG đa cỡ → mã bằng k-NN phần dư → giới hạn mã |
| `lib/kit/shapes.js` | Đường viền và khe hở cho đá hình (tim, marquise, giọt) |
| `lib/kit/upscale.js` | Gọi Real-ESRGAN hoặc fallback Lanczos |
| `lib/kit/vlm.js` | (Offline, có trả phí) VLM gán vùng, đá to và đáp án tay. **Không dùng trong luồng mỗi order** |
| `kit/db/kit.sqlite` | Catalog, `size_map`, luật, BOM và **18.367 viên thật** (vị trí, mã, cỡ, đặc trưng ảnh) |
| `kit/templates/` | Template đã dựng: `starry_*`, `queen_*` (mask: đen = nền, trắng = trang phục, đỏ = ô mặt pet), `product_queen_starry_palette.json` |

---

## Lệnh thường dùng

| Việc | Lệnh |
|---|---|
| Test toàn bộ ($0) | `npm test` |
| Dựng lại DB tham chiếu | `.venv/bin/python tools/build_kit_db.py` |
| Template Starry đính kín | `node tools/starry_template.mjs` |
| Template Queen (sửa tay `kit/templates/queen_big.json` rồi chạy lại) | `node tools/queen_template.mjs` |
| Bảng mã chung nền + trang phục (gộp greedy) | `node tools/product_palette.mjs` |
| Layer pet trên ô mặt Queen | `node tools/pet_kit19.mjs` |
| Chấm DETECT / PET với sản phẩm thật | `node tools/bench_kit_real.mjs [--modes pet]` |
| Chấm template với đáp án tay Queen (KIT-15) | `node tools/score_template_gt.mjs` · `node tools/queen_gt.mjs build` |
| Trang phục Queen, mỗi hạt vẽ = 1 viên (KIT-20: SAM2 + chuỗi vàng, xem `docs/KIT-20.md`) | `python tools/kit20_segment.py` → `python tools/kit20_chain.py` → `node tools/kit20.mjs --seg … --chain …` |
| Ảnh soát ký hiệu (ảnh gốc + viền mảnh + ký hiệu, không thay bằng viên giả) | `node tools/kit_review_overlay.mjs <map.svg> <ảnh nguồn> <out.svg>` |
| VLM (trả phí, có trần USD trong `outputs/kit-vlm/calls.jsonl`) | `node --env-file=.env tools/vlm_tiers.mjs big\|mid\|count\|label <ảnh> --run` |

Biến môi trường:
- `GEMINI_API_KEY` (chỉ cho công cụ VLM offline) nằm trong `.env`, **không commit**.
- `PEARL_VENV_PY` (python có OpenCV), `REALESRGAN_BIN`.

---

## Soát kết quả

- Kết quả ghi ra `outputs/` (không có trong git).
- Xem bằng server file: `cd outputs && python3 -m http.server 5178`.
- Viewer SVG phóng to được: `http://localhost:5178/kit/review/viewer.html?f=<file.svg>`.
  - Cuộn để zoom, kéo để di chuyển.
  - Bật tắt được ảnh gốc, ký hiệu, viền và từng mã.
  - Rê chuột lên viên để xem mã, hình, cỡ.
- Ảnh soát luôn giữ **ảnh gốc làm nền**, ký hiệu đặt đúng tâm hạt. Designer đối chiếu trực tiếp, không xem qua viên giả lập.

---

## Kết quả đo hiện tại

| Hạng mục | Số liệu |
|---|---|
| Ghi rồi đọc lại SVG sản phẩm thật | Snowman 3.233 viên / 15 mã, Dachshund 2.147 / 12: lệch 0 viên |
| Baseline KIT-9 (DETECT thô) | F1 tâm 40/47%, đúng mã 18/36%, 82–97 mã |
| Pet (KIT-17) | điểm (F1 + mã + cỡ)/3: 46,5 → 66,1; đúng mã 55/83% |
| Background Starry | 11.759 viên 2.8 mm, phủ 80,5% (trần lục giác ~82%), 5 mã |
| Bảng mã chung nền + Queen | 17 → 11–12 mã (gộp greedy, có thêm mã pha lê) |
| Trang phục Queen, mỗi hạt = 1 viên (KIT-20, toàn ảnh) | 3.465 hạt → 1.949 viên, phủ 43%, 13 mã chung; trên 3 ô đáp án (hạt ≥ 2 mm): recall 39,8%, precision 56,5%, vật liệu 65,7%, cỡ 51,4%, hình 88,6% |

Lịch sử thí nghiệm và bảng trước/sau: `docs/KIT-DATA.md` §7–8, `docs/STONEMAP.md`, `docs/KIT-RESEARCH.md`.

---

## Vấn đề đã biết

- Hạt vàng li ti của trang phục (~1–1,5 mm) nhỏ hơn viên nhỏ nhất của catalog (2.8 mm). Cần chốt: thay bằng chuỗi 2.8 mm thưa hơn, hay để phần này in.
- Catalog 2.8 mm chỉ có 20 màu, không có cam và xám, nên một số vùng lệch màu (ΔE 9–21).
- Đáp án tay KIT-15 (`outputs/kit/queen_gt/`) vẫn là bản nháp do VLM tạo, chưa được designer soát (`checked:false`).
- Các SVG King/Queen/Starry cũ dùng mã không có trong catalog, nên **không phải ground truth**.

---

## Tài liệu

| File | Nội dung |
|---|---|
| `docs/STONEMAP-PLAN.md` | Kế hoạch hệ thống mới, các giai đoạn, tiêu chí đạt |
| `docs/STONEMAP.md` | Schema `design.json`, catalog, QC, SVG, kết quả QC trên sản phẩm thật |
| `docs/KIT-DATA.md` | Quy ước sản phẩm thật, benchmark |
| `docs/KIT-DB.md` | Schema `kit.sqlite` |
| `docs/KIT-SVG.md` | Định dạng SVG `pearl-kit-map/1` |
| `docs/KIT-RESEARCH.md` | Paper và hướng nghiên cứu (mosaic, stippling, LoG, flow) |
