# KIT — quy ước sản phẩm thật (từ `requirements/DATA`)

Nguồn chuẩn: `requirements/DATA` (catalog + 2 sản phẩm thật Snowman 300 mm, Dachshund ornament 245 mm).
3 SVG cũ King/Queen/Starry trong `requirements/FIle Map đá` **không** tuân spec — chỉ là tham khảo định dạng.

## 1. Kiểu sản phẩm: partial drill
- Tranh = ảnh in + đá dán **một phần**. Độ phủ đá vật lý: Snowman 29.6 %, Dachshund 32.1 %.
- Đá chỉ nằm ở vùng được chọn (thân/mũ/khăn người tuyết, lông chó, nơ, quả châu, viền). Vùng còn lại (cành thông, bầu trời, quả thông, mũi chó) để **in**, không dán.
- Trong vùng có đá: tâm đá đặt **đúng tâm hạt mà ảnh AI vẽ**, thành chuỗi theo hàng hạt / hướng lông (flow). Láng giềng chạm (khe < 0.6 mm): 0→805, 1→704, 2→780, 3→615, ≥4→329 viên (Snowman) — chủ yếu là chuỗi 1–3 láng giềng, không phải lưới lục giác kín.
- Viên 2.8 mm: khoảng cách láng giềng gần nhất trung vị 3.02 mm (Snowman) / 2.95 mm (Dachshund); láng giềng thứ 3–4 ở 3.8–4.7 mm (giữa các hàng có khe in).
- Khe vật lý tới viên gần nhất: trung vị 0.24 / 0.15 mm; chồng (< −0.05 mm) chỉ 8 / 13 cặp → coi chồng là lỗi.

## 2. Kích thước: vật lý vs vẽ trong SVG
- `data-group = K_<code>_S<vật lý mm>`; ellipse trong SVG vẽ bằng **reference** = nhỏ hơn: 2.8→2.2, 4→3.2, 5→4.2, 8→7.2 (CONFIRMED, `data/reference_sizes_v1.csv`); còn lại = vật lý − 0.8 (DERIVED).
- Mọi tính toán va chạm/độ phủ dùng **vật lý**. Chỉ khi xuất SVG mới vẽ reference.
- Dải size dùng thật: 2.8 (đa số), 4, 5, 6, 7, 8, 10 mm.

## 3. Mã đá và màu: catalog
- `data/stones_active_v2_catalog_corrected.csv` (432 mã) — RGB chuẩn `color_r/g/b_reference`, size `physical_diameter_mm`.
- Mã tròn: `L`=2.8, `Z`=4, `W`=5, `D`=6 mm (+ hậu tố = họ màu); `Q`= tròn mài giác 4–12 mm; **ngọc trai**: mã = số = đường kính (5,6,7,8,10,11,12,14).
- Có hình khác (M marquise, S giọt, X tim/sao, H hoa/hồng) nhưng 2 sản phẩm thật chỉ dùng **tròn**.
- Chỉ được dùng mã có trong catalog. (SVG cũ dùng L33/L35/D42/Q200… không có trong catalog.)

## 4. Ký hiệu (`yeu cau san xuat.txt`)
- Mỗi thiết kế ≤ 13 mã (tối đa 15). Snowman 15, Dachshund 12.
- Ký hiệu **theo từng thiết kế** (L94 = G ở Snowman, khác ở file khác).
- Đá: CHỮ IN HOA rõ to. Ngọc trai: SỐ = cỡ (5 → "5", 7 → "7").
- Sản phẩm thật vẫn lẫn vài số cho đá (Snowman L4="4", L26="2", W16="6", Q114="1"; Dachshund L16="3", L4="4", L1="1", D1="2") → ta theo spec: chữ cho đá, số chỉ cho ngọc trai; không trùng ký hiệu trong một thiết kế.
- Cỡ chữ SVG theo size (Snowman 21–23 px cho 2.8 mm).

## 5. Ảnh đầu vào thực tế
- Ảnh khách/AI gen (ví dụ `requirements/Trang phục King.png`, 1254² RGB, **không alpha**) có **ô caro giả trong suốt vẽ chết** (2 mức xám ~250–255 và tối hơn, ô ~11–12 px), cả ở ngoài viền lẫn lỗ bên trong (lỗ cổ áo).
- Phải tách nền caro (và nền đen/trắng phẳng) **trước** khi dò hạt; vùng nền không bao giờ sinh đá.

## 6. Ngọc trai vs đá mài giác (nhìn ảnh)
- Ngọc trai: trắng/kem, bão hoà thấp, gradient tròn mềm, 1 đốm sáng mềm, không cạnh giác; size lớn hơn hạt nền (5–8 mm).
- Đá tròn L/Z/W/D/Q: màu bão hoà hoặc kim loại, lấp lánh, có đốm sáng sắc/nhiều mặt giác.
- Hạt trắng nhỏ trong ảnh (lớp tuyết, thân người tuyết) là đá L trắng 2.8 mm (L94, L1) hoặc Z94 4 mm, không phải ngọc trai; ngọc trai chỉ ở hạt to rời 5–7 mm.
- Đo trên ảnh (docs/KIT-DB.md): Z94 trắng mịn gần như ngọc trai (std 17.6 vs 19.8) → phân biệt bằng **size**, không bằng độ mịn.
- Dữ liệu từng viên: `kit/db/kit.sqlite` (docs/KIT-DB.md).

## 7. Benchmark DETECT / PLACE trên sản phẩm thật (KIT-9)
`node tools/bench_kit_real.mjs` (~30 s, không gọi API, không nằm trong `npm test`). Ảnh vào là ảnh sạch (Snowman `3.png`, Dachshund `2.png`), đáp án lấy từ bảng `stones`. Chạy `buildKit` với tham số mặc định + `canvasWmm` của sản phẩm, giống `/api/kit-lab/run`. Kết quả đầy đủ ghi ở `outputs/kit/bench_real.json`.
- Tâm khớp 1–1 tham lam khi lệch < 0.5 × đường kính vật lý. Size so theo vật lý (reference → vật lý qua `size_map`). Mã đo trên các cặp khớp theo 2 cách: (a) mỗi cụm màu được gán mã thật chiếm đa số trong cụm = cận trên, (b) màu cụm → mã gần nhất (ΔE76 `catalog_hex`) trong BOM thật, ưu tiên mã cùng size.
- Độ phủ dùng cùng mẫu số với `products.physical_coverage` (tranh: canvas²; ornament tròn: π/4·canvas²). F1 vùng có đá: so `stoneField` của KIT-1 (đĩa + closing 3 mm) giữa bản đồ ra và bản đồ thật.

| sản phẩm · chế độ | viên ra / thật | tâm P / R / F1 % | lệch TB mm | đúng size % (mốc toàn 2.8) | đúng mã % (a) / (b) | số mã ra / thật | độ phủ ra / thật % | F1 vùng % (P / R) |
|---|---|---|---|---|---|---|---|---|
| snowman · DETECT | 8168 / 3233 | 28.1 / 70.9 / 40.2 | 0.76 | 53.1 (77.1) | 64.1 / 18.4 | 97 / 15 | 85.0 / 29.6 | 71.9 (57.5 / 95.8) |
| snowman · PLACE | 7488 / 3233 | 27.7 / 64.2 / 38.7 | 0.93 | 73.2 (73.3) | 55.1 / 52.8 | 17 / 15 | 51.3 / 29.6 | 72.5 (56.9 / 100) |
| dachshund · DETECT | 5649 / 2147 | 32.0 / 84.2 / 46.4 | 0.81 | 84.9 (94.6) | 69.5 / 36.0 | 82 / 12 | 82.9 / 32.1 | 87.2 (78.7 / 97.8) |
| dachshund · PLACE | 2999 / 2147 | 40.2 / 56.2 / 46.9 | 0.97 | 91.6 (92.0) | 51.7 / 48.8 | 14 / 12 | 39.3 / 32.1 | 86.9 (77.6 / 98.7) |

Nhận xét:
- **Cả 2 chế độ đều chưa có partial drill.** Đá rải gần hết vùng ảnh: F1 vùng chỉ đạt nhờ recall ~96–100 %, precision vùng chỉ 57–79 %. DETECT phủ 83–85 %, gấp 2.6–2.9 lần đáp án. Cần thêm bước chọn vùng có đá / vùng để in trước khi dò.
- **DETECT tìm ra nhiều tâm đúng (recall 71–84 %) nhưng dư viên**, ra 2.5 lần số viên thật. Size đoán kém hơn mốc "toàn 2.8 mm": đếm dư viên 4–6 mm (snowman: 1223 viên 4 mm, thật 552).
- **PLACE chỉ đặt viên chính**, không có viên 5/7/8/10 mm. Vì vậy size đúng ≈ mốc toàn 2.8. Tâm lệch gần 1 mm do PLACE đặt theo lưới, không bám tâm hạt trong ảnh.
- **Mã:** DETECT ra 82–97 cụm, vượt xa 12–15 mã thật. Màu cụm → catalog gần nhất chỉ đúng 18–36 %, khớp với kết luận ΔE 19–30 ở KIT-DB. PLACE ra 14–17 mã, đúng 49–53 %.

## 8. Luồng thú cưng không gọi API (KIT-17)
`lib/kit/upscale.js` (Real-ESRGAN `realesrgan-ncnn-vulkan` + `realesrgan-x4plus` qua child_process, thiếu binary thì Lanczos-3; binary/model ở `~/.cache/realesrgan/` hoặc `tools/bin/`, không commit) → `lib/kit/pet.js` `runPet` (phóng ×4 khi ảnh < 5 px/mm → `detectBeads` 2.8 / 4 mm + viên to → mã từng viên bằng k-NN học từ bảng `stones`, leave-one-product-out → ≤ 13 mã). Chấm bằng **một điểm**: `node tools/bench_kit_real.mjs --modes pet [--input orig|low|lanczos|esrgan|low6|lanczos6|esrgan6]`, ĐIỂM = (F1 tâm + đúng mã (b) + đúng size) / 3, trung bình Snowman + Dachshund. Mode pet gán mã BOM cho từng viên, nên (b) là mã ra == mã thật. Mốc KIT-9 = 46.5.

Từng bước, ảnh gốc. Ô ghi F1 / mã (b) / size, %. Một thay đổi chỉ được giữ khi điểm tăng; mức ±0.1 coi là nhiễu.

| bước | ĐIỂM | snowman | dachshund | giữ |
|---|---|---|---|---|
| KIT-9 DETECT (mốc, §7) | 46.5 | 40.2 / 18.4 / 53.1 | 46.4 / 36.0 / 84.9 | mốc |
| DETECT hiện tại (KIT-12a, chia tầng) | 56.4 | 38.7 / 31.6 / 72.1 | 49.7 / 53.5 / 92.3 | mốc mới |
| pet: LoG 2.8/4/5 mm + màu gần nhất | 60.5 | 39.7 / 44.8 / 68.2 | 49.8 / 68.6 / 92.0 | ✓ |
| + mã k-NN phần dư (k 15, Lab + std + size; học từ sản phẩm kia) | 63.6 | 39.7 / 48.6 / 68.2 | 49.8 / 82.7 / 92.0 | ✓ |
| ↳ thử: k-NN bỏ phiếu mã 61.1 · k 7: 63.3 · k 30: 63.4 · bỏ std: 63.3 · wSize 20: 63.6 | | | | ✗ |
| cỡ 2.8 / 4 mm (bỏ 5 mm) | 65.8 | 39.8 / 54.4 / 75.7 | 50.1 / 82.7 / 92.0 | ✓ |
| + viên to (bigObjects, KIT-12a) | 66.0 | 40.1 / 54.4 / 75.6 | 50.3 / 83.0 / 92.5 | ✓ |
| ↳ thử: + ngọc trai 64.7 · ngưỡng 0.7: 66.1 (nhiễu) · overlap 1.0: 63.1 (trên 2.8/4/5) | | | | ✗ |
| + viên ≥ 5 mm chọn size + mã cùng lúc (ΔE + 2·mm bớt), màu gần nhất | 66.1 | 40.1 / 54.8 / 76.0 | 50.3 / 83.0 / 92.5 | ✓ (sửa mũi Queen) |
| ↳ thử chuỗi ETF: kéo về dòng 65.8 · lấp khe 65.8 · bỏ viên lẻ 66.2 (F1 giảm ở cả 2) | | | | ✗ (tắt) |

Có / không phóng ảnh: low = ảnh sạch thu ÷3 (3.9 px/mm, như ảnh 1254 px) hoặc ÷6 (2 px/mm), rồi phóng ×4.

| cấu hình | gốc | ÷3 | ÷3 Lanczos ×4 | ÷3 ESRGAN ×4 | ÷6 | ÷6 Lanczos ×4 | ÷6 ESRGAN ×4 |
|---|---|---|---|---|---|---|---|
| DETECT mặc định | 56.4 | 56.1 | 57.0 | 54.6 | 55.6 | 59.0 | 55.6 |
| pet 2.8/4/5 + màu gần nhất | 60.5 | 60.2 | 60.0 | 60.0 | | | |
| pet 2.8/4/5 + k-NN | 63.6 | 63.3 | 63.1 | 63.2 | | | |
| **pet cuối** | **66.1** | 65.5 | 65.5 | 65.7 | 61.6 | 64.9 | 64.8 |

Nhận xét:
- **Mã là phần tăng nhiều nhất.** (b) 18.4 / 36.0 → 54.8 / 83.0. k-NN học phần dư catalog − màu ảnh, nên hạt trông cam trong ảnh ra L16 vàng; màu gần nhất sẽ ra L74. F1 tâm gần như đứng yên (40 / 50): precision chỉ 27–36 % vì vùng in vẫn bị dò (partial drill, §7). Muốn tăng F1 phải có mặt nạ vùng dán đá (KIT-10/16) hoặc số đếm từ KIT-13.
- **Phóng ảnh chỉ có lợi khi ảnh nhỏ.** Ở 3.9 px/mm, Lanczos và ESRGAN chỉ chênh ±0.2. Ở 2 px/mm (hạt 2.8 mm ≈ 5.5 px) thì 61.6 → 64.9 / 64.8. Lanczos (1 s) ≈ ESRGAN (33–40 s / ảnh 1.2k px, GPU M4); ESRGAN đúng mã Snowman hơn (57.2 so với 54.8) nhưng Dachshund kém hơn. `runPet` phóng khi < 5 px/mm, mặc định dùng ESRGAN, thiếu binary thì Lanczos.
- **Chuỗi theo hướng (ETF) không tăng điểm.** Bench không có tiêu chí thẳng dòng; đặt đá theo dòng là việc thẩm mỹ, cần một thước đo riêng nếu captain muốn.
- **Queen, mặt thú cưng** (`node tools/pet_queen.mjs`, bbox tạm 330,150 → 940,720 px trên ảnh 1254; ô mặt thật của mẫu: §9): 1628 viên (2.8 mm: 979, 4 mm: 635, 5 mm: 6, 6 mm: 8), 15 mã (13 + 2 mã viên to), ESRGAN 40 s, tổng 46 s. Mắt và mũi thành 1 viên D93 đen 6 mm (catalog 12 mm chỉ có Q152 nâu vàng). Lông cam ra L16 / Z16, trắng ra L94 / Z94. Ảnh zoom (ảnh phóng | đá): `outputs/kit/kit17/queen_pet_zoom.jpg`, toàn mặt: `queen_pet_overview.jpg`.

## 9. Pet trên ô mặt thật + bảng mã chung (KIT-19)
`node tools/pet_kit19.mjs` (~1 phút, 0 API) → `outputs/kit/kit19/`: `pet.design.json` (stonemap-design/1, layer `pet`, `validate` = 0 lỗi), `pet.svg`, `zoom_{collar,crown,side,face}.jpg` (ảnh | trang phục + pet, ô 36 mm), `overview.jpg`, `report.json`.
- **Khung.** `Mẫu Queen.png` không cùng khung với `Trang phục Queen.png` (trang phục mẫu to và thấp hơn), nên mask đỏ đặt thẳng lên ảnh mẫu sẽ cắt ngang mõm. Tool đặt mặt pet vào ô như một đơn thật: hộp mặt `--face` (mặc định 348,306 → 850,697 px trên ảnh 1254) được co cho vừa hộp ô đỏ (contain, ×0.853), tâm trùng tâm ô. Ngoài ô là ảnh trang phục.
- **Bảng mã.** `productPalette()` (lib/kit/pet.js) đọc `kit/templates/product_queen_starry_palette.json` (KIT-18). Chưa có file đó thì tạm lấy hợp mã của costume chain và starry: **17 mã**, đã quá trần 15 trước khi thêm pet. Trong đó 9 mã là đá tròn mà pet dùng được (Q111 Z16 L16 L94 L4 L47 L50 L37 L23); mã hình và ngọc trai không vào bom của pet.
- **Chọn mã.** `fitPalette` cho mỗi viên mã có chi phí nhỏ nhất, chi phí = ΔE76(đích, catalog) + 2·(mm bớt). Viên không bao giờ to hơn cỡ đo; 4 mm thiếu màu thì xuống 2.8. Thêm tối đa `maxNew` mã ngoài bảng, chọn tham lam theo tổng ΔE giảm được.
- **Gỡ chồng.** `resolveOverlap` (opt `noOverlap`): giữ viên to trước, rồi theo score ở 2.8 mm, sau đó trả viên 4 mm về 4 mm nếu còn chỗ; khe ≥ −0.05 mm (ngưỡng QC overlap). Không có bước này thì pet Queen có 942 cặp chồng, trung vị khe −0.66 mm (DETECT đo hạt 2.8 thành 4 mm).
- **Giáp trang phục.** `keepOut`: viên pet có khe vật lý < 0.15 mm (geom `edgeGap`, mọi shape) với viên costume chain ∪ print thì thu về 2.8 mm; vẫn sát thì bỏ.

Queen (ESRGAN 43 s, tổng 58 s):

| | kết quả |
|---|---|
| ô mặt | 6568 mm², hộp 103.4,79.8 → 205.9,169.0 mm |
| pet | dò 688 → 312 viên (2.8 mm: 306, 4 mm: 4, 6 mm: 2), phủ ≈ 30 % (Queen thật: 266 viên / 16 % trong hộp mặt, dán một phần) |
| mã | 8 (L16 156, L94 120, L17 21, L37 6, Z16 4, D93 2, L47 2, L4 1); mới: **D93** (mắt/mũi đen 6 mm), **L17** |
| ΔE76 TB | tự do (mọi mã tròn, 18 mã dùng) **6.67** → ép bảng + 2 mã **6.91** → ép bảng + 0 mã **7.88**; ép đổi mã 33 viên, đổi cỡ 22 |
| sản phẩm | 17 + 2 = **19 mã > 15** (vì bảng tạm, chờ KIT-18) |
| giáp costume | bỏ 25, thu 0; khe min pet ↔ costume **0.176 mm**, 0 cặp < 0.15 |
| QC pet | overlap pass (0 chồng), code-count pass, symbols pass, gap warn (145 viên khe −0.05..0.15) |
| QC costume + pet | overlap error 12 cặp: cả 12 nằm trong costume chain (KIT-16), không cặp nào pet ↔ costume |
| Starry | 872 viên nền nằm trong ô mặt: khi ghép sản phẩm phải bỏ nền trong ô |

Bench giới hạn mã (`node tools/bench_kit_real.mjs --modes pet --palette top:N | queen-starry [--max-new 2]`; top:N = N mã nhiều viên nhất của BOM thật, queen-starry = bảng tạm ∩ BOM; ΔE = tự do → ép):

| cấu hình | không gỡ chồng | `noOverlap` khe ≥ 0 |
|---|---|---|
| tự do (BOM thật) | 66.1 | 63.5 |
| top:11 + 2 | 66.9 (ΔE 8.95 → 8.95 / 10.08 → 10.08) | 63.9 |
| queen-starry + 2 (snowman 5 + L26,L1; dachshund 3 + L1,L25) | 66.1 (ΔE 8.95 → 9.14 / 10.08 → 10.08) | 62.6 |
| queen-starry + 0 | 62.6 (ΔE 8.95 → 21.67 / 10.08 → 22.89) | 59.3 |

Nhận xét:
- **2 mã mới là đủ.** Ép bảng có 2 mã mới thì ΔE gần như không đổi. Không cho mã mới thì ΔE tăng ×2.4 và điểm −3.5.
- **Gỡ chồng làm điểm giảm, nhưng bắt buộc.** `noOverlap` −2.6 điểm (F1 snowman 40.1 → 43.7, dachshund 50.3 → 46.0). Bench thưởng cho dò thừa chồng lên nhau, còn thiết kế xuất ra phải 0 chồng. Mặc định của `PET` vẫn tắt (để bench KIT-17 so được); `pet_kit19` bật.
- **Thử, không giữ:** giữ cỡ đo trước (`noOverlap: 'size'`): 63.1; khe ≥ 0.15: 62.7; lấp lỗ bằng 2.8 mm: dày hơn sản phẩm thật nên bỏ.
