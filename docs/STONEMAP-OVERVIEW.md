# Stone Map: tổng quan hệ thống

Tài liệu cho captain (product owner) và kỹ sư mới. Nó trả lời 3 câu hỏi: **hệ thống hoạt động như nào, xử lý như nào, dùng kỹ thuật gì**.
Trạng thái tính đến bước nội bộ KIT-27. Tài liệu chia theo **chức năng / công đoạn pipeline**. Mã KIT-xx chỉ ghi trong ngoặc
"(nguồn: …)" để tra lại lịch sử.

Mọi con số dưới đây lấy từ các tài liệu được dẫn. Đường dẫn tính từ gốc repo `pearl_compare/`.

---

## 1. Sản phẩm và ràng buộc

### 1.1 Sản phẩm

Tranh pet cá nhân hoá. Một phần là ảnh in, phần còn lại đính đá/ngọc (partial drill). Mỗi tranh có 3 layer:

| Layer | Thay đổi theo đơn? | Cách map | Chi phí mỗi đơn |
|---|---|---|---|
| Nền (Starry) | Không, cố định | Template, map 1 lần, đính kín | $0 |
| Trang phục (Queen / King) | Không, cố định | Template, map 1 lần, captain/designer duyệt | $0 |
| Pet (mặt thú cưng) | Có, mỗi đơn | Tự động, model local | **$0 API** |

Thứ tự xếp chồng khi ghép: `nền < trang phục < pet`. (nguồn: KIT-16, docs/STONEMAP-PLAN.md §1–2)

Đầu ra mỗi đơn: bản đồ đá SVG sửa được, BOM, mockup, kết quả QC. (nguồn: README.md)

**Thước đo chính:** bản máy làm phải gần bản designer duyệt nhất, để **designer sửa ít nhất**. Đo bằng diff giữa bản máy và bản
duyệt (vị trí, mã, cỡ, hình). Đích là 0 chỉnh sửa. (nguồn: docs/STONEMAP-PLAN.md §0)

### 1.2 Ngân sách mã

| Quy tắc | Giá trị |
|---|---|
| Mỗi sản phẩm | lý tưởng ≤ 13 mã, cứng ≤ 15 |
| Hiện tại | 13 mã dùng chung cho nền + trang phục, chừa 2 mã cho pet (13 + 2 = 15) |
| Bảng mã chung hiện tại | `D1 Z16 L47 S057 X039 L23 5 L37 L4 M063 L94 6 W4`; Queen dùng 11 |

(nguồn: `yeu cau san xuat.txt`, KIT-18/23/27, `outputs/kit/kit27/report.json` → `palette`)

### 1.3 Kích thước vật lý và kích thước vẽ

- Va chạm, khe hở, độ phủ: tính theo cỡ **vật lý**. Khe mục tiêu **0.15–0.2 mm**. Khe < −0.05 mm coi là chồng (lỗi).
- SVG vẽ theo cỡ **reference**, nhỏ hơn: 2.8 → 2.2, 4 → 3.2, 5 → 4.2, 8 → 7.2; cỡ khác = vật lý − 0.8.
- `data-group = K_<code>_S<vật lý mm>`.

(nguồn: docs/KIT-DATA.md §1–2)

### 1.4 Ký hiệu

| Loại | Ký hiệu | Ghi chú |
|---|---|---|
| Đá | một chữ trong `A B C E F G J K N P R T U V Y` | không dùng chữ đầu series (L Z W D Q M S X H) và I, O, để tránh đọc nhầm (vd "M" bị hiểu là marquise) |
| Ngọc trai | số = cỡ mm (`5`, `6`, `10`) | |

Ký hiệu chỉ duy nhất trong một thiết kế. (nguồn: AGENTS.md, README.md)

### 1.5 Catalog

`requirements/DATA/data/stones_active_v2_catalog_corrected.csv`, 432 mã, nạp vào `kit/db/kit.sqlite`.

| Chữ đầu | Loại | Cỡ |
|---|---|---|
| `L` | tròn | 2.8 mm (chỉ **20 màu**, không có cam, xám) |
| `Z` | tròn | 4 mm |
| `W` | tròn | 5 mm |
| `D` | tròn | 6 mm |
| `Q` | tròn mài giác | 4–12 mm |
| `X` | tim / sao | vd X039 tim 12×12 (lớn nhất) |
| `M` | marquise | vd M063 6×12 |
| `S` | giọt | vd S057 6×10 |
| `H` | hoa | |
| số | ngọc trai | 5, 6, 7, 8, 10, 11, 12, 14 mm |

Chỉ dùng mã có trong catalog. Catalog có version (`catalogVersion` = hash nội dung), mỗi design ghim version nó dùng.
(nguồn: docs/KIT-DATA.md §3, README.md, `lib/kit/catalog.js`, `lib/stonemap/catalog.js`)

---

## 2. Sơ đồ pipeline tổng

```
             ┌──────────── TEMPLATE (map 1 lần / trang phục, $0 API, captain duyệt) ────────────┐
ảnh trang    │                                                                                  │
phục (AI vẽ) ─► mask trang phục ─► upscale ×4 ─► tách hạt (SAM2.1 + LoG) ─► chuỗi viền vàng     │
             │  (kit25_mask.py)   (Real-ESRGAN /   (kit20_segment.py)        (kit20_chain.py)    │
             │                     Lanczos)                │                                    │
             │                                             ▼                                    │
             │      vật liệu ─► hình (fit outline catalog, heart cue, petal, twin) ─► chuỗi hàng │
             │                                             │                                    │
             │                    ┌────────────────────────┴───────────────┐                    │
             │                    ▼                                        ▼                    │
             │          (A) CHI TIẾT 1:1                          (B) VÙNG PHỦ (fill)            │
             │      mỗi hạt vẽ = 1 viên                    detectFill → fill_regions.json        │
             │      Potts MRF gán mã                       (sửa tay, checked) → packRegion       │
             │      va chạm: nudge ≤ 0.2 / hạ 1 cỡ          hex 2.8 mm khe 0.15, đặt sau cùng     │
             │                    └───────────────┬────────────────────────┘                    │
             │                                    ▼                                             │
             │             lấp khe kín (§3g) → đổi mã theo màu cục bộ (§3h) → lượt lấp lỗ        │
             │                                    ▼                                             │
             │             bảng mã sản phẩm (greedy merge, ≤ 13, + crystal) ── nền Starry dùng chung│
             └────────────────────────────────────┬─────────────────────────────────────────────┘
                                                  ▼
ảnh pet ─► upscale ─► LoG đa cỡ ─► k-NN mã (học từ DB) ─► fitPalette (≤ +2 mã) ─► gỡ chồng ─► keepOut
(mỗi đơn)                                                                                    │
                                                  ▼                                          │
                         compose (BG < trang phục < pet, bỏ viên layer dưới khi va chạm) ◄───┘
                                                  ▼
                         design.json (stonemap-design/1) ─► QC registry (10 plugin)
                                                  ▼
                         map.svg · bom.csv/json (+10 %) · legend.png · mockup
                                                  ▼
                         review overlay (ảnh gốc + viền + ký hiệu) ─► viewer.html / tile self-audit
```

---

## 3. Từng công đoạn

### 3.1 Phóng ảnh (upscale ×4)

| | |
|---|---|
| Làm gì | Phóng ảnh trang phục / pet ×4 để hạt 2.8 mm đủ điểm ảnh cho tách hạt |
| Kỹ thuật | Real-ESRGAN (`realesrgan-ncnn-vulkan` + `realesrgan-x4plus`) local; thiếu binary thì Lanczos-3 |
| Số | Queen: 5016 px, 16.72 px/mm. ESRGAN 33–40 s / ảnh 1.2k px (GPU M4), Lanczos 1 s. Trên bench pet, Lanczos ≈ ESRGAN; chỉ có lợi khi ảnh < 5 px/mm (÷6: 61.6 → 64.9 / 64.8) |
| File | `lib/kit/upscale.js`; binary ở `~/.cache/realesrgan/` hoặc `tools/bin/` (không commit) |

(nguồn: KIT-17, docs/KIT-DATA.md §8, docs/KIT-20.md "Chạy")

### 3.2 Mask trang phục

Ảnh AI vẽ có nền ca-rô giả (không alpha). Vùng nền không bao giờ sinh đá. `tools/kit25_mask.py` tạo mask chung (alpha, hoặc cụm xám
nối viền). Template Queen: `kit/templates/queen_mask.png` (đen = nền, trắng = trang phục, đỏ = ô mặt pet).
(nguồn: docs/KIT-DATA.md §5, KIT-16, KIT-25)

### 3.3 Tách hạt (segmentation)

| | |
|---|---|
| Làm gì | Tìm từng hạt AI vẽ (instance) → 1 hạt = 1 ứng viên viên đá |
| Kỹ thuật | **SAM2.1-small automatic mask generation** trên ô 1024 px (bước 640); mask thuộc ô có lõi chứa tâm. Thêm hạt li ti bằng **LoG** (0.4–1.4 mm) |
| Đặc trưng mỗi mask | tâm, đường kính tương đương, trục dài/ngắn, góc xoay, Lab, độ lấp lánh, IoU với đường viền catalog (tròn / marquise / giọt / tim, quét xoay, cùng hình học `lib/kit/shapes.js`) |
| Chọn hình | hình có IoU cao nhất (hơn tròn ≥ 0.03, hoặc ≥ 0.01 khi dài/ngắn ≥ 1.25); tim to (≥ 11 mm) khi IoU tim ≥ 0.92 × IoU tròn |
| Sở hữu điểm ảnh | mask to trước; mask bị mask to hơn phủ ≥ 50 % bị bỏ |
| So sánh | SAM vs watershed + LoG trên GT ≥ 2 mm: recall 59.1 / 34.1, precision 53.6 / 40.0 → chọn SAM |
| Thời gian | Queen cả ảnh 48 ô: 1430 s; King 1295 s; Snowman 1744 s |
| File | `tools/kit20_segment.py`, venv `~/.cache/kit20/venv` (torch MPS, sam2), weights `~/.cache/kit20/sam2.1_hiera_small.pt` (không commit). SAM2 large treo máy 17 GB RAM |

(nguồn: KIT-20, docs/KIT-20.md "Các bước" 1)

### 3.4 Chuỗi viền vàng li ti

Viền vàng vẽ bằng hạt ~1 mm (139 / 166 hạt vàng GT < 2 mm), nhỏ hơn viên nhỏ nhất (2.8 mm), nên không thể 1 hạt = 1 viên.
- Kỹ thuật: vùng vàng → **đường tâm (centreline)** → điểm cách nhau **2.95 mm** (= 2.8 + 0.15) → viên vàng 2.8 mm.
- Thứ tự: đặt sau hạt to (≥ 4 mm / có hình), trước hạt nhỏ. Bỏ điểm nằm trong hạt vẽ không vàng; bỏ điểm là bóng giữa các ngọc
  (C* < 47, rộng < 1 mm, cách mép ngọc ≤ 1 mm).
- Số: 812 / 2179 điểm đặt được (trước khi đổi thứ tự: 125).
- File: `tools/kit20_chain.py` (`--step 2.95`).

(nguồn: KIT-20, KIT-21, KIT-22, KIT-23)

### 3.5 Phân loại vật liệu

Luật `MAT` trong `tools/kit20.mjs` (Lab):
- C* ≥ 45 → vàng (hue 55–100°, L ≥ 40) hoặc màu;
- L ≥ 65 → ngọc trai (C* ≥ 15, ít lấp lánh) hoặc pha lê trắng;
- còn lại → vàng / màu.

Ngọc vs đá trắng: phân biệt bằng **cỡ** (ngọc 5–7 mm, Z 4 mm, L 2.8 mm), không bằng độ mịn: Z94 trắng std 17.6 gần như ngọc 19.8.
Hạt đúng vật liệu 33.8 % → ~75 %. (nguồn: KIT-20, docs/KIT-DATA.md §6, docs/KIT-DB.md)

### 3.6 Phát hiện chuỗi hạt (hàng cùng cỡ)

| Bước | Luật |
|---|---|
| Cạnh | 2 hạt tròn cùng cỡ ±15 % (cỡ = trục dài), khoảng 0.6–1.5 × cỡ, cùng nhãn hoặc ΔE76 ≤ 20 |
| Nối chuỗi | bậc ≤ 2, góc đổi ≤ 45°, bước lệch ≤ 65 %; cho phép cỡ thu dần tới 1.45× (`--taper`) |
| Nhóm | hàng song song kề (cùng cỡ, cùng bước, ≥ 50 % hạt trong 1.6 bước) gộp nhóm |
| Bỏ phiếu | phiếu nhóm = Σ độ tin màu + 0.1 × tần suất vật liệu theo khoảng cỡ; cả nhóm 1 cỡ (trung vị) |
| Luật gradient ánh sáng | nhãn dọc chuỗi đúng 2 đoạn liền, đoạn trắng/ngọc có C* thấp hơn → do ánh sáng → cả chuỗi theo đoạn C* thấp |
| Vị trí | **giữ vị trí vẽ** (mặc định); đặt lại dọc chuỗi chỉ khi bật `--resample-min` |

Queen cả ảnh: 278 chuỗi, 187 nhóm, 1444 hạt trong chuỗi (lần đầu); sau khi cho thu cỡ dần: 333 chuỗi.
(nguồn: KIT-21, KIT-22)

### 3.7 Hình đặc biệt: motif, tim, cặp đối xứng

- **Motif cánh hoa → giọt / marquise.** Vòng 4–8 hạt giống nhau quanh 1 tâm khác màu/cỡ. Đo thân cánh trên ảnh ×4 trong hình quạt
  ±π/n. Tỉ lệ dài/rộng trung vị ≥ `--petal-ratio` 1.25 → cả vòng thành hình: **giọt** nếu cánh chạm tâm (≤ 1 mm), không thì
  **marquise**. Mọi cánh cùng bán kính, mũi giọt chỉ vào tâm. Motif cùng loại dùng chung 1 quyết định; vòng cánh ngắn → toàn tròn.
  Góc vòng đo quanh trọng tâm cánh (`--motif-gap 0.5`). Queen: motif 4 → 16; S057 7 → 18 viên.
  (nguồn: KIT-24, KIT-27)
- **Heart cue** (`lib/kit/shapecue.js` `heartCue`): cho hạt màu ≥ 8 mm mà SAM không gọi là tim. Trên mask màu (hue ±28°), bắn
  180 tia từ tâm; tim khi notch ≥ 0.2, rộng notch ≤ 80°, đối xứng thuỳ ≤ 0.11, mũi ≥ 0.95, thuỳ ±40° ≥ 0.85. Xoay = notch + 90°.
  Queen: tim vương miện từ tròn B → X039 12 mm. (nguồn: KIT-27)
- **Cặp đối xứng cục bộ** (`twinPairs` trong `lib/kit/symmetry.js`): trục cục bộ theo dải 2 mm, ước lượng từ trung điểm các cặp
  cùng hàng (histogram Gauss σ 6 mm quanh trục mask-lật). Cặp = khớp gương tốt nhất 2 chiều, lệch ≤ 0.35·d + 0.8 mm, cỡ ≤ 1.8×,
  ΔE ≤ 30. Mỗi cặp bỏ phiếu 1 vật liệu, hình + cỡ + góc (lật) của hạt to hơn, thêm 1 cạnh Potts gương. Queen: 34 cặp, đổi 8.
  (nguồn: KIT-27)

### 3.8 Gán mã: Potts MRF trên đồ thị viên

Thay các bước vá nhãn riêng lẻ bằng 1 bài toán tối ưu. (nguồn: KIT-23, `lib/kit/potts.js`)

```
E(l) = Σ_i U_i(l_i) + Σ_(i,j) w_ij · [l_i ≠ l_j]       node = viên, nhãn = mã trong bảng (mã ⇒ vật liệu/hình/cỡ)
```

| Thành phần | Chi tiết |
|---|---|
| Unary U | `stoneCost / 20` (ΔE tới màu catalog + hình) + α·(0.5 + conf) khi đổi vật liệu (α 3) + `--mrf-size`·\|ln(cỡ đo / cỡ mã)\| + phạt cỡ vượt chỗ trống tới láng giềng (1 + 2·mm). Hình → tròn +60/20. Ngọc luôn tròn |
| Pairwise w | contrast-sensitive: w = β·g_size·g_mat·exp(−ΔE76² / 2·12²); g_size = 1 khi tỉ lệ cỡ ≤ 1.2, 0 khi ≥ 1.25; g_mat 1 / 0.5 / 0.1 |
| Cạnh | láng giềng (D ≤ 0.75·(d_i + d_j)), cạnh chuỗi γ 2, cạnh motif vòng 1.5, cạnh gương (twin) |
| Giải | **alpha-expansion** (Boykov–Veksler–Zabih), mỗi bước 1 lát cắt nhỏ nhất bằng Dinic max-flow. Test brute-force đồ thị 6 nút: tối ưu 299/300, tệ nhất 1.06×; ICM tệ hơn ở 147/300 |
| Neo | viên có cạnh mạnh cùng nhãn chỉ được giữ đúng mã đó; va chạm → bỏ viên, không đổi sang mã khác (1369 viên bỏ thay vì lẫn mã) |

Kết quả: consistency (cặp láng giềng mạnh khác mã) 11.5 % → **1.0 %**; vật liệu GT 65.8 → 73.0 %. `--kit22` = cách gán cũ.

### 3.9 Mã cho cụm hạt to (big codes)

Hạt tròn không phải ngọc ≥ 5 mm mà mã rẻ nhất nhỏ hơn ≥ 1.5 mm được gom theo vật liệu + ΔE < 15. Cụm ≥ 5 hạt nhận mã catalog có
Σ trọng số·stoneCost thấp nhất, giữ cứng khi mã cũ ≤ 60 % cỡ trung vị cụm. Queen: đỏ 8–10 mm L4 2.8 → **W4 5 mm** (29 viên).
Tắt: `--no-big-codes`. (nguồn: KIT-27)

### 3.10 Hai chế độ: chi tiết 1:1 và vùng phủ

| | (A) Chi tiết | (B) Vùng phủ (fill) |
|---|---|---|
| Dùng cho | hạt to/có hình, chuỗi vàng, cột, motif, viền, vùng dày vẽ đều | vùng dày AI vẽ méo (hạt dính, cỡ dao động, nhỏ hơn catalog, vd đỏ Queen vẽ 2.22 mm < 2.8) |
| Cách đặt | mỗi hạt vẽ = 1 viên, giữ tâm vẽ | đóng gói lại procedural, **đặt sau cùng**, viên (A) là vật cản |
| File | `tools/kit20.mjs` | `lib/kit/fill.js` |

(nguồn: KIT-25)

**Phát hiện vùng phủ (`detectFill`).** Không dùng màu cố định. Đặc trưng mỗi hạt < 5 mm: số láng giềng, độ phủ cục bộ (≥ 0.55),
tỉ lệ 2D (≥ 0.2). Hạt dày → thành phần cùng vật liệu, ΔE ≤ 20, ≥ 15 hạt; thêm mầm thưa (cụm ≥ 6 hạt, ≥ 100 mm²).
Tín hiệu loại về (A):

| Luật | Ngưỡng |
|---|---|
| mỏng (chuỗi, hàng đơn) | twoD < 0.5 |
| vẽ đều | twoD < 0.8 và CV cỡ < 0.15, frag < 0.3, sub < 0.5 (vd cổ ngọc King: CV 0.11, frag 0.05) |
| hẹp | bề rộng < 1.6 hạt vẽ sau khi nở (đo trên lõi đã đóng; giữ nếu lõi ≥ 2 hạt và rộng ≥ 1.3) |

Vùng được **nở trên ảnh** (lưới 0.5 mm, BFS ΔE ≤ 20 so với màu mầm), bị chặn bởi mask, viên chi tiết, hạt khác vật liệu và điểm
chuỗi vàng. Lỗ > 100 mm² giữ thành `holes`. (nguồn: KIT-25, KIT-26)

**Cỡ vùng:** bước = trung vị khoảng cách láng giềng gần nhất; cỡ = cỡ catalog lớn nhất có cỡ + 0.15 ≤ bước × 1.05, không có thì
cỡ nhỏ nhất. Ngọc không vừa cỡ ngọc nào → **đá trắng 2.8 mm L94** (đúng DB Queen). Mọi vùng Queen / King / Snowman → 2.8 mm.

**Quy ước học từ DB** (`tools/kit25_fill_learn.mjs`): vùng phủ thật đều 2.8 mm, hex (nn3/nn1 ≈ 1.07, ψ6 0.58–0.59, không hàng),
khe 0.15 mm, không xen cỡ.

**Đóng gói (`packRegion`).** Raster 4 px/mm, trừ lỗ và đĩa vật cản. 3 bước: (1) 1 hàng biên theo contour (EDT = s/2); (2) lưới hex
theo `angleDeg`, chọn pha tốt nhất trong 12; (3) lấp lỗ raster. Bước = 2.95 mm hoặc `packPitchMm`. Tâm viên luôn trong mask.
Lượt cuối `packRegion({holesOnly: true})` lấp mọi lỗ còn chứa được 1 viên (`kit26.kin.holesLeft` Queen 0, King 0).

**File vùng sửa tay** `pearl-kit-fill-regions/1` (`kit/templates/queen_fill_regions.json`): mỗi vùng có `polygon`, `holes`,
`material`, `physMm`, `code`, `angleDeg`, `packPitchMm`, `enabled`. Captain sửa xong đặt `checked: true`; `--fill-detect` không
ghi đè file đã checked mà ghi `<out>/fill_regions.detected.json`. Queen hiện có 23 vùng (`checked: false`).

### 3.11 Lấp khe kín và đổi mã cục bộ

- **§3g khe kín** (`--gap-enclose 12`): hạt vẽ ≥ 4 mm bị rơi được đặt lại ở mã tròn cùng vật liệu lớn nhất vừa, ≥ 0.55× cỡ vẽ
  (Queen 9). Sau đó trên lưới 0.5 mm, đặt viên 2.8 mm nơi vừa và ≥ 12/16 tia chạm viên hoặc mép mask (Queen 149). Vùng in mở
  vẫn để trống (partial drill).
- **§3h đổi mã** (`--recode-gain 20`): viên phủ / khe / chi tiết đơn (không thuộc chuỗi, nhóm, motif, cánh, cặp) đổi sang mã cùng
  cỡ gần màu lõi hơn ≥ 20 ΔE (Queen 25 viên, vd viên trắng tràn lên dây đỏ).

(nguồn: KIT-27)

### 3.12 Va chạm vật lý

Khe ≥ 0.15 mm, tính theo cỡ vật lý. Hạt vẽ to / rõ đặt trước. Khi chồng:
1. **nudge** ≤ 0.2 mm (12 hướng, bước 0.1; `--nudge`);
2. hạ **1 cỡ catalog** cùng loại, cùng vật liệu (`--shrink-steps`), không đổi mã sang vật liệu khác;
3. không được thì bỏ viên.

Nudge 0.2 cứu 263 viên. Nudge 0.5 (trần captain) tăng recall nhưng giảm đúng cỡ → mặc định 0.2. Hạt nhỏ có tâm nằm trong hạt to
gấp ≥ 1.6× bị bỏ. Pet và ghép layer dùng cùng nguyên tắc (`lib/kit/pack.js`, `resolveOverlap`, `keepOut`).
(nguồn: KIT-22)

### 3.13 Bảng mã sản phẩm (palette)

| | |
|---|---|
| Thuật toán | greedy merge theo map_generator: mỗi viên bắt đầu ở mã catalog tốt nhất; mỗi vòng gộp cặp mã (a → b) rẻ nhất tới khi ≤ maxCodes |
| Chi phí gộp | (cỡ a / 2.8)² · [Σ(ΔE00²_mới − ΔE00²_cũ) + 25² · số viên nếu b nhỏ hơn a]; chỉ cùng loại (ngọc/đá) + cùng hình; ΔE00 TB > 20 → `merge_warnings` |
| Ràng buộc | bắt buộc 1 mã pha lê (crystal), pha lê không thành ngọc; cấm đổi vật liệu; mã khoá (`--lock`) không bị gộp |
| Chọn số mã | ít mã nhất mà lỗi vật liệu + hình nhỏ nhất; chỉ được vượt 13 vì lỗi đó; thêm mã chỉ vì cỡ khi sản phẩm vẫn ≤ 13 |
| Starry | dùng chung bảng (`preferCodes`); ΔE TB Starry hiện 10.3 |
| File | `lib/kit/palette.js` (`mergePalette`, `jointPalette`, `stoneCost`), `tools/product_palette.mjs`, `kit/templates/product_queen_starry_palette.json` |

Bảng "thêm mã → giảm lỗi" (3 ô GT Queen): union 9 → 12 mã làm sai vật liệu 37 → 1, ΔE TB 28.0 → 15.4.
(nguồn: KIT-18, KIT-20 "Số mã", KIT-23, `lib/kit/palette.js:128`)

### 3.14 Layer pet (mỗi đơn, $0 API)

| Bước | Kỹ thuật |
|---|---|
| Upscale | ×4 khi ảnh < 5 px/mm (ESRGAN, fallback Lanczos) |
| Dò hạt | LoG đa cỡ 2.8 / 4 mm + viên to (bigObjects) |
| Mã | **k-NN phần dư** (k 15, Lab + std + cỡ) học từ bảng `stones` (viên thật), leave-one-product-out; không dùng RGB gần nhất |
| Bảng mã | `productPalette` + `fitPalette`: chi phí = ΔE76 + 2·(mm bớt); thêm tối đa **+2 mã** ngoài bảng sản phẩm |
| Gỡ chồng | `resolveOverlap`: giữ viên to trước, khe ≥ −0.05 mm (không có bước này: 942 cặp chồng) |
| Giáp trang phục | `keepOut`: viên pet có khe < 0.15 mm với viên trang phục → thu về 2.8, vẫn sát thì bỏ |
| Ô mặt | mặt pet co vừa hộp ô đỏ của mask (contain), tâm trùng tâm ô |

Điểm bench (F1 tâm + đúng mã + đúng cỡ)/3: **46.5 → 66.1**; đúng mã 18/36 → 55/83 % (Snowman/Dachshund). 2 mã mới là đủ:
không cho mã mới thì ΔE ×2.4 và điểm −3.5. Queen pet: 312 viên, 8 mã (mới D93, L17), khe min pet ↔ trang phục 0.176 mm.
File: `lib/kit/pet.js`, `tools/pet_kit19.mjs`. (nguồn: KIT-17, KIT-19, docs/KIT-DATA.md §8–9)

### 3.15 Ghép layer, xuất file, QC

- **Compose** (`lib/stonemap/compose.js`): thứ tự BG < trang phục < pet; va chạm ở mép → bỏ viên layer dưới; viên `locked` (đã
  duyệt) không bị bỏ. Gán lại ký hiệu cho cả sản phẩm. Viên nền Starry trong ô mặt phải bỏ (872 viên khi thử Queen).
- **`design.json` `stonemap-design/1`** là nguồn sự thật: mỗi viên `{id, layer, code, shape, x_mm, y_mm, phys_mm, ref_mm, rot_deg,
  locked, source}` + `catalogVersion`, `symbols` (`lib/stonemap/design.js`, docs/STONEMAP.md).
- **SVG**: `pearl-kit-map/1` (`lib/kit/svgio.js`, docs/KIT-SVG.md; 3543 px = 300 mm, 11.81 px/mm; mỗi mã 1 `<g data-code>`,
  hình có `data-shape`, `data-rotation-deg`) và SVG sửa được của stonemap (`lib/stonemap/svg.js`, mỗi layer 1 `<g>`, mỗi viên
  `data-*`, đọc ngược cả transform Inkscape). Ghi rồi đọc lại Snowman 3233 viên / Dachshund 2147 viên: lệch 0.
- **BOM** (`lib/stonemap/bom.js`): ký hiệu → mã → thông tin catalog → số viên theo layer và tổng, **+10 % dự phòng**
  (`ceil(n·1.1)`); legend SVG/PNG.
- **QC registry** (`lib/stonemap/qc/`): mỗi kiểm định là 1 plugin `{id, level, run(design)}`. Hiện 10: `code-count` (> 15 lỗi,
  14–15 cảnh báo), `catalog`, `overlap`, `gap`, `symbols`, `layer-total`, `outside-region`, `merge-warnings`, `holes`, `delta-e`.
  Kit SVG còn có `checkDesign(readKitSvg(svg))`.
- **Mockup** (`lib/stonemap/render3d.js`): ảnh tĩnh có shading theo hình.

(nguồn: P0/P3, docs/STONEMAP-PLAN.md §2, README.md)

### 3.16 Soát kết quả: review overlay và viewer

- `tools/kit_review_overlay.mjs <map.svg> <ảnh nguồn> <out.svg>`: ảnh gốc làm nền (không che), mỗi viên = viền mảnh theo cỡ vẽ +
  ký hiệu ở tâm. Designer đối chiếu với hạt vẽ thật, không xem qua viên giả lập.
- `outputs/kit/review/viewer.html`: cuộn để zoom, kéo để di chuyển; bật/tắt ảnh gốc, ký hiệu, viền, từng mã; rê chuột xem
  mã/hình/cỡ. Mỗi mã có 1 thẻ: hình catalog đúng tỉ lệ tô màu catalog, cỡ vật lý và cỡ vẽ, 3 crop từ ảnh thiết kế (bấm để zoom
  tới viên), link tới trang ảnh catalog trong `outputs/kit/catalog/`.

---

## 4. Đánh giá và dữ liệu thật

### 4.1 Ground truth

| Nguồn | Nội dung | Dùng để |
|---|---|---|
| `kit/db/kit.sqlite` (dựng bằng `tools/build_kit_db.py`, schema docs/KIT-DB.md) | catalog, `size_map`, luật, BOM và **18 367 viên thật** (vị trí, mã, cỡ, đặc trưng ảnh) của Snowman, Dachshund, Queen, King, Starry | đáp án chính; học k-NN, học quy ước phủ |
| Đáp án tay 3 ô Queen 25 mm (`outputs/kit/queen_gt/`, `pearl-kit-gt/1`) | bản nháp VLM, captain sửa và đặt `checked: true` (hiện chưa) | chấm chi tiết ≥ 2 mm |

Phát hiện từ DB: màu SVG = màu catalog; màu ảnh lệch catalog ΔE76 19–30 (nên không gán theo RGB gần nhất); sản phẩm thật **không**
đối xứng gương (7.7 % Queen, 7.8 % King cặp gương cùng mã). SVG King/Queen/Starry cũ dùng mã ngoài catalog → không phải GT.
(nguồn: KIT-15, docs/KIT-DB.md, KIT-26)

### 4.2 Chỉ số

| Chỉ số | Định nghĩa |
|---|---|
| recall / precision | khớp tâm 1–1 tham lam, lệch < 0.5 × đường kính vật lý |
| vật liệu / cỡ / hình / mã | % đúng trên các cặp khớp |
| vùng phủ vs DB | recall, precision, vật liệu, cỡ, mã, độ phủ trong vùng (`tools/kit25_score_db.mjs`) |
| consistency | % cặp láng giềng mạnh (chuỗi / motif / spatial) cả 2 viên đều đặt mà khác mã |
| cặp gương | % cặp gương cùng mã (để so với DB 7.7 %) |
| điểm pet | (F1 tâm + đúng mã + đúng cỡ) / 3 |

Quy tắc: một thay đổi chỉ được giữ khi điểm tăng; ±0.1 là nhiễu. (nguồn: docs/KIT-DATA.md §7–8)

### 4.3 Vòng tự soát theo ô (tile self-audit)

1. Chia ảnh thành **78 ô 30 mm**, chồng 10 %; mỗi ô 1 ảnh nguồn | overlay, thước mm tuyệt đối (`tools/kit27_audit.mjs`, ~20 s).
2. Kiểm tự động (`tools/kit27_audit.py`, OpenCV): `bigMiss`, `shapeMis`, `colorDE`, `labelIncons`, `fillHole`, `emptyLarge`,
   `outside` → `tiles/index.json`, `auto_audit.json`.
3. Soát bằng mắt: 4 reviewer × ~20 ô, đọc mọi ô (Claude đọc PNG, $0 API) → `tile_audit.json`.
4. Sửa theo **nhóm nguyên nhân** bằng luật chung, không toạ độ (G1 big codes, G2 heart cue, G3 motif, G4 twin, G6 khe kín, G6b đổi mã).
5. Chạy lại và soát lại.

| Loại lỗi (high) | trước | sau |
|---|---|---|
| bigMissing | 41 | 23 |
| fillGap | 19 | 4 |
| wrongShape | 11 | 8 |
| labelInconsistent | 8 | 5 |
| wrongMaterialColor | 8 | 5 |
| **tổng high** | **87** | **48** |
| ô có lỗi high / ô không lỗi | 53 / 11 | 33 / 14 |
| auto: bigMiss high+med / fillHole / colorDE high | 61 / 90 / 37 | 43 / 49 / 24 |

Tổng số lỗi mọi mức không đổi (216 → 216): phần lớn do đỏ 8–10 mm chuyển từ bigMissing (high) sang wrongSize (med) khi thành W4 5 mm.
(nguồn: KIT-27, `outputs/kit/kit27/audit_summary.md`)

### 4.4 Diễn tiến số chính (Queen trừ khi ghi khác)

| Mốc | Cách làm | Số |
|---|---|---|
| DETECT thô (KIT-9) | dò hạt theo tầng + màu gần nhất | Snowman/Dachshund F1 tâm 40/47 %, đúng mã 18/36 %, ra 82–97 mã |
| Pet k-NN (KIT-17/19) | LoG + k-NN, ≤ +2 mã | điểm 46.5 → 66.1 |
| 1:1 lần đầu (KIT-20) | SAM, mỗi hạt 1 viên | viên GT ≥ 2 mm recall 39.8 / vật liệu 65.7 / cỡ 51.4; 1949 viên, phủ 43.1 % |
| Giữ vị trí vẽ (KIT-22) | nudge 0.2, hạ 1 cỡ | 43.2 / 65.8 / 52.6; consistency 11.5 % |
| Potts MRF (KIT-23) | alpha-expansion | 42.0 / 73.0 / 45.9; consistency **1.0 %** |
| Vùng phủ (KIT-25) | detectFill + packRegion | vùng phủ vs DB: recall 37.5 → 54.3, mã 44.6 → 57.0, cỡ 80.9 → 94.2, phủ 42.5 → 52.7 % (DB 51.9 %); mã vùng 14/17 |
| Phủ kín (KIT-26, không đối xứng) | mầm thưa, lấp lỗ | vùng phủ DB recall 51.8, mã 70.1; mã vùng 21/21; 0 lỗ |
| **Hiện tại (KIT-27)** | big codes, heart, twin, motif, §3g/§3h | 2583 viên, 13 mã (Queen 11), phủ 50.7 %; DB toàn ảnh recall 44.3 / prec 55.4; vùng phủ 53.0 / 55.6 / mã 70.6; vùng chi tiết 40.2 / mã 14.9; GT ≥ 4 mm recall 60.6; lỗi high 87 → 48 |
| King cùng code (KIT-27) | không tham số riêng | 2762 viên, DB recall 46.4 → 49.1, 13 mã |

Hàng captain (7 ngọc) giữ `5 5 - 5 5 5 5` từ KIT-22. Mọi lần chạy: check ok, $0 API, ~2 phút / lần (không tính SAM).
(nguồn: docs/KIT-DATA.md §7–9, docs/KIT-20.md)

---

## 5. Những gì đã thử và loại bỏ

| Hướng | Vì sao bỏ | Nguồn |
|---|---|---|
| Lấp lưới / hex cả trang phục | không bám hạt vẽ; đá to/hình lạ bị chia vụn, tim thành tròn. Nay: "không có hạt thì không có đá", hex chỉ dùng trong vùng phủ | KIT-16/18 → KIT-20, STONEMAP-PLAN §1 |
| Gán mã theo RGB gần nhất | chỉ đúng 18–36 % vì màu ảnh lệch catalog ΔE 19–30 → thay bằng k-NN học từ DB và cost palette | KIT-9, KIT-17 |
| VLM (Gemini) trong luồng mỗi đơn | tốt cho đá to (recall 75–91 %) nhưng đếm hạt nhỏ kém, chi phí khó kiểm (KIT-15 vượt 23 %). Nay chỉ là công cụ offline có trần USD | KIT-10/12c/13/15 |
| Đặt lại viên dọc chuỗi (re-spacing) | GT recall 39.8 → 36.4, viên lệch tâm vẽ tới ~2.3 mm → tắt, chỉ bật bằng `--resample-min` | KIT-21 → KIT-22 |
| Đối xứng gương toàn ảnh | DB thật chỉ 7.7 % cặp gương; bật làm DB vùng phủ recall 51.8 → 46.1, mã 70.1 → 63.7. Captain: không dùng được → **tắt mặc định**, `--sym` bật lại; thay bằng `twinPairs` cục bộ | KIT-26 → KIT-27 |
| Chuỗi theo hướng lông (ETF) cho pet | không tăng điểm bench (65.8 / 66.2) → tắt | KIT-17 |
| Mockup 3D bằng Blender | tạm dừng vì Blender làm máy lag; WIP ở nhánh `fm/pc-kit-3d` | KIT-3D (firstmate backlog) |
| SAM2 large | treo máy 17 GB RAM → dùng SAM2.1 small | KIT-20 |

---

## 6. Giới hạn còn lại và quyết định đang chờ

| Vấn đề | Chi tiết | Cần quyết |
|---|---|---|
| Tâm đỏ 8–10 mm | đang là W4 5 mm. Mã đỏ 8–10 mm riêng là mã thứ 14, làm mergeDown bỏ Z16 (vàng 4 mm, 37 viên) | chờ test pet để biết còn chỗ mã không |
| Cột rondelle vàng | 5.3 × 3.8 mm, bước 3.57 mm; viên tròn 4 mm cần bước 4.15; catalog không có oval → đang A 2.8 | giới hạn catalog |
| Hàng ngọc vẽ chồng | bước 4.7–5.3 mm cho ngọc 5.1–5.5 mm; hàng captain: cung 8.86 mm, 3 viên 5 mm cần ≥ 10.3 mm → 1 chỗ trống `5 5 - 5 5 5 5` | đặt lại cả hàng (`--resample-min`) hay chấp nhận lỗ |
| Starry ΔE | 8.85 → 10.3 vì giữ W4 + ngọc 6 làm L50 (xanh đậm) gộp vào L47 cho 2439 viên nền | chấp nhận hay đổi mã khác |
| Ngọc champagne ~6 mm | bị xếp vàng, MRF làm mượt cỡ về 2.8 | |
| Hình lạ | ngọc giọt lê, pha lê lá 2 thuỳ: catalog không có hình | |
| King | mã vùng phủ chỉ 2.7 % vì DB dùng L34 / L35 (không có trong catalog); consistency 3.0 % | thêm L34/L35/L5 vào catalog? |
| Queen đỏ thẫm | DB dùng L5 (không có trong catalog) | như trên |
| Sản phẩm khoan một phần (Snowman) | nền tuyết DB khoan thưa 30.6 %, ta khoan kín 52.7 % | `packPitchMm` ≈ 3.9 mm cho vùng đó, hay luật chung theo diện tích |
| Tim to | tim vẽ 19.3 mm và tim cổ áo ~25 mm, catalog tim lớn nhất X039 12×12 | giới hạn catalog |
| Đáp án tay | 3 ô GT và `queen_fill_regions.json` chưa `checked` | captain soát |

(nguồn: KIT-20 "Cần captain quyết", KIT-23, KIT-25, KIT-27 "Not fixed", `outputs/kit/kit27/audit_summary.md`)

---

## 7. Cách chạy

### 7.1 Môi trường

- Node ≥ 22.5 (`node:sqlite`), không có dependency npm. `npm test` = 8 bộ test, không mạng, $0.
- `.venv` (numpy, opencv-python) cho `tools/build_kit_db.py` và đọc JPEG.
- venv SAM: `~/.cache/kit20/venv` (torch MPS, sam2, opencv-headless, scikit-image, scipy) + `~/.cache/kit20/sam2.1_hiera_small.pt`.
- Real-ESRGAN: `~/.cache/realesrgan/` hoặc `tools/bin/` hoặc `REALESRGAN_BIN`.
- Không commit: binary, model, `.env`, `outputs/`, `requirements/`.

### 7.2 Lệnh chính

```sh
npm test                                              # 8 bộ test, $0
.venv/bin/python tools/build_kit_db.py               # dựng kit/db/kit.sqlite (~5 s)

# Template trang phục (Queen), từng bước
PYTORCH_ENABLE_MPS_FALLBACK=1 ~/.cache/kit20/venv/bin/python -u tools/kit20_segment.py --method sam --region all \
    --out outputs/kit/kit20/seg_sam_all.json          # ~20 phút
~/.cache/kit20/venv/bin/python tools/kit20_chain.py --region all --out outputs/kit/kit20/chain_all.json   # 3 s
node tools/kit20.mjs --seg outputs/kit/kit20/seg_sam_all.json --chain outputs/kit/kit20/chain_all.json \
    --fill-detect --fill-regions outputs/kit/kit27/fill_regions.json --out outputs/kit/kit27      # ~2 phút
#   rerun đọc file vùng đã sửa: bỏ --fill-detect
#   cờ: --sym | --sym-force | --sym-axis <mm>   (đối xứng toàn ảnh, mặc định tắt)
#       --no-fill --fill-eval <json>            (baseline chỉ chi tiết)
#       --no-big-codes --no-heart-cue --no-twin --no-gap-fill --no-recode --no-petal --kit22 --resample-min <mm> --nudge <mm>
#       --name/--img/--mask/--review-bg/--no-gt (ảnh khác, vd King)

# Tự soát theo ô
node tools/kit27_audit.mjs --svg outputs/kit/kit27/queen.svg --review outputs/kit/kit27/review.svg \
    --fill outputs/kit/kit27/fill_regions.json --out outputs/kit/kit27      # [--tile 30 --overlap 0.1]

# Chấm
node tools/kit25_score_db.mjs --svg outputs/kit/kit27/queen.svg --regions outputs/kit/kit27/fill_regions.json --product queen
node tools/bench_kit_real.mjs [--modes pet]

# Review overlay
node tools/kit_review_overlay.mjs <map.svg> <ảnh nguồn> <out.svg>

# Bảng mã, template, pet
node tools/product_palette.mjs [--method greedy|merge] [--crystal auto|<code>|none] [--lock L16|none]
node tools/starry_template.mjs
node tools/queen_template.mjs
node tools/pet_kit19.mjs
```

### 7.3 Xem kết quả

```sh
cd outputs && python3 -m http.server 5178
# http://<host>:5178/kit/review/viewer.html?f=../kit27/review.svg
# King: ?f=../kit27/king/review.svg
```

### 7.4 Repo

| Remote | Đường dẫn |
|---|---|
| GitHub | `anhbh-tech/stone_map` |
| GitLab | `hangminh/jewerydogs` |
| Nhánh | `features/initial_approach` |

### 7.5 Tài liệu chi tiết

| File | Nội dung |
|---|---|
| `docs/STONEMAP-PLAN.md` | kế hoạch, giai đoạn P0–P6, tiêu chí đạt |
| `docs/STONEMAP.md` | schema `design.json`, QC |
| `docs/KIT-20.md` | công đoạn trang phục 1:1, Potts, vùng phủ, tự soát (KIT-20 → KIT-27) |
| `docs/KIT-DATA.md` | quy ước sản phẩm thật, bench DETECT/pet |
| `docs/KIT-DB.md` · `docs/KIT-SVG.md` | schema DB, định dạng SVG |
| `outputs/kit/kit27/audit_summary.md` | bảng tự soát trước/sau |
| `AGENTS.md` | ghi chú kỹ thuật ngắn cho agent |
