# KIT-20 — mỗi hạt vẽ = 1 viên (Trang phục Queen)

Ảnh `requirements/Trang phục Queen.png` → tách từng hạt vẽ (instance) → mỗi hạt 1 viên catalog. Không lấp lưới, không Potts:
không có hạt thì không có đá. 0 API, model chạy local.

## Chạy

```sh
# 1. ×4 (lib/kit/upscale.js, Real-ESRGAN local) → outputs/kit/kit20/up4.png (5016 px, 16.72 px/mm)
# 2. tách hạt — venv riêng ngoài repo: ~/.cache/kit20/venv (uv: torch MPS, sam2, opencv-headless, scikit-image, scipy),
#    model ~/.cache/kit20/sam2.1_hiera_small.pt (large treo máy 17 GB RAM); không commit
PYTORCH_ENABLE_MPS_FALLBACK=1 ~/.cache/kit20/venv/bin/python -u tools/kit20_segment.py --method sam --region gt|all \
    --out outputs/kit/kit20/seg_sam_<region>.json          # 3 ô GT ~2 phút, cả ảnh 48 ô ~20 phút
~/.cache/kit20/venv/bin/python tools/kit20_chain.py --region gt|all --out outputs/kit/kit20/chain_<region>.json   # viền vàng, 3 s
# 3. vật liệu / hình / cỡ / mã / va chạm / SVG / chấm GT / review
node tools/kit20.mjs --seg outputs/kit/kit20/seg_sam_all.json --chain outputs/kit/kit20/chain_all.json \
    [--neigh-off <dir>/neigh_summary.json] [--no-neigh] [--codes N] [--debug]
```

Ra `outputs/kit/kit20/{queen.svg, review.svg, report.json, review_{heart,pearls,cape}.png}`; review = ảnh ×4 + viền mảnh +
ký hiệu (`tools/kit_review_overlay.mjs`), xem ở `/kit/review/viewer.html?f=../kit20/review.svg`.

## Các bước

1. **Tách** (`kit20_segment.py`): SAM2.1 AMG trên ô 1024 px (bước 640), mỗi mask thuộc ô có lõi chứa tâm; thêm hạt li ti
   bằng LoG (0.4–1.4 mm). Đặc trưng mỗi mask: tâm, đường kính tương đương, trục dài/ngắn, xoay, Lab, độ lấp lánh, và IoU với
   đường viền catalog (tròn / marquise / giọt / tim, quét xoay — cùng hình học `lib/kit/shapes.js`). Hình = hình có IoU cao
   nhất (hơn tròn ≥ 0.03, hoặc ≥ 0.01 khi dài/ngắn ≥ 1.25); tim to (≥ 11 mm) khi IoU tim ≥ 0.92 × IoU tròn (tim + viền vàng
   khớp tròn hơn tim). Sở hữu điểm ảnh: mask to trước, mask bị mask to hơn phủ ≥ 50 % bị bỏ → không viên nhỏ nằm trong hạt to.
   So với watershed + LoG (đối chứng `--method ws`) trên GT vẽ ≥ 2 mm: recall 59.1 / 34.1, precision 53.6 / 40.0 → SAM.
2. **Vật liệu** (`MAT` trong `kit20.mjs`): C* ≥ 45 → vàng (hue 55–100°, L ≥ 40) hoặc màu; L ≥ 65 → ngọc trai (C* ≥ 15,
   ít lấp lánh) hoặc pha lê trắng; còn lại vàng / màu. Hạt vật liệu 33.8 % → ~75 %.
3. **Láng giềng** (msg 014): đồ thị tâm (khoảng ≤ 1.35·(r1+r2)+0.5 mm, cùng cụm khi cỡ lệch ≤ 40 %); (b) hạt độ tin < 0.5
   lấy nhãn đa số có trọng số ≥ 70 %; (c) 2 hạt cùng nhãn cách ~2 bước, giữa trống và ảnh ở đó cùng vật liệu → thêm 1 hạt.
4. **Chuỗi vàng** (`kit20_chain.py`): vùng vàng → đường giữa → điểm cách 3.0 mm → viên vàng 2.8 sau mọi hạt khác, chỉ nơi còn
   chỗ. Hạt vàng vẽ ~1 mm (139 / 166 hạt vàng GT < 2 mm) không thể mỗi hạt 1 viên.
5. **Cỡ / mã**: hình → cỡ catalog cùng nhóm màu (trắng / vàng / màu) gần nhất theo tỉ lệ cạnh (log); hình to hơn catalog
   (tim vẽ 19.3 mm) → cỡ lớn nhất (X039 12×12). Tròn → cỡ catalog ≤ cỡ vẽ + 0.4; ngọc < 5 mm thử ngọc 5, va chạm → đá trắng.
   Bảng mã: `jointPalette` chung với Starry, bắt buộc 1 mã pha lê, chi phí theo diện tích hạt vẽ ((d/2.8)²), cấm đổi vật liệu
   (pha lê ↔ ngọc, hình trắng ↔ hình màu), hình → tròn +60, thu cỡ +20 +2/mm, rồi ΔE.
6. **Va chạm** (khe ≥ 0.15 mm): hạt vẽ to / rõ trước; chồng → mã nhỏ hơn cùng tâm, rồi đá trắng thay ngọc, không thì bỏ.

## Số mã — "thêm mã → giảm lỗi" (3 ô GT, Queen; Starry dùng chung bảng)

| union | sản phẩm (+2 pet) | thêm | sai vật liệu | sai hình | sai cỡ | ΔE TB | Starry ΔE |
|---|---|---|---|---|---|---|---|
| 9 | 11 | W1 L47 M063 X039 S082 L23 5 L37 M038 | 37 | 1 | 38 | 28.0 | 11.2 |
| 10 | 12 | L50 | 37 | 1 | 38 | 27.5 | 9.7 |
| 11 | 13 | L94 | 13 | 1 | 38 | 25.3 | 8.9 |
| 12 | 14 | L4 | 1 | 1 | 38 | 15.4 | 8.9 |
| 13 | 15 | Q109 | 1 | 1 | 34 | 15.3 | 8.9 |

Luật chọn: ít mã nhất đạt lỗi vật liệu + hình nhỏ nhất (được vượt 13 tới trần 15 chỉ vì lỗi này); thêm mã chỉ vì cỡ khi sản
phẩm vẫn ≤ 13. → union 12 / sản phẩm 14.

## Kết quả 3 ô GT (GT vẽ ≥ 2 mm, 88 hạt)

GT `outputs/kit/queen_gt/*.json` là bản nháp VLM (checked = false); 186 / 274 hạt GT vẽ < 2 mm nên chấm riêng tập ≥ 2 mm.

| | ô | GT | ra | recall | precision | vật liệu | cỡ | hình |
|---|---|---|---|---|---|---|---|---|
| hạt | heart | 20 | 12 | 50.0 | 83.3 | 70.0 | 10.0 | 90.0 |
| hạt | pearls | 37 | 53 | 64.9 | 45.3 | 83.3 | 37.5 | 95.8 |
| hạt | cape | 31 | 44 | 67.7 | 47.7 | 66.7 | 61.9 | 95.2 |
| viên | heart | 20 | 15 | 35.0 | 46.7 | 57.1 | 42.9 | 85.7 |
| viên | pearls | 37 | 25 | 35.1 | 52.0 | 84.6 | 53.8 | 92.3 |
| viên | cape | 31 | 28 | 48.4 | 53.6 | 60.0 | 46.7 | 93.3 |

Hạt → viên mất nhiều: 352 hạt → 186 viên, 178 bỏ vì va chạm vật lý (hạt vẽ sát nhau < cỡ viên nhỏ nhất).

### Bước láng giềng riêng (msg 014), trước → sau

| | trước | sau |
|---|---|---|
| hạt GT ≥ 2 mm: recall / precision / vật liệu | 61.4 / 50.0 / 72.2 | 62.5 / 50.5 / 74.5 |
| viên GT ≥ 2 mm: recall / precision / vật liệu | 38.6 / 60.7 / 67.6 | 38.6 / 60.7 / 67.6 |
| hạt vàng GT (166) tìm thấy / gắn đúng vàng | 30 / 24 | 30 / 24 |

Đổi nhãn 7 (trắng→ngọc 3, màu→ngọc 2, vàng→ngọc 1, màu→vàng 1), thêm 6 hạt (ngọc 2, vàng 2, màu 2). Hạt vàng không đổi vì
hạt vàng sót là hạt li ti ~1 mm, không phải hạt to lạc nhãn. Bước chuỗi vàng (4) thêm 12 / 117 điểm trên 3 ô (viên vàng tìm
thấy 12 → 20); 105 điểm bị chặn bởi ngọc 5 / đá trắng / hạt vàng đã đặt (viền vàng vẽ ~1 mm sát hạt to, không đủ chỗ viên 2.8).

## Cả ảnh (`--region all`, 48 ô, SAM 1430 s)

3914 mask → 3384 giống hạt → 3465 hạt (sau láng giềng) → 1949 viên (va chạm bỏ 1643, thu cỡ 294); chuỗi vàng 127 / 2131 điểm
đặt được; phủ 43.1 % diện tích trang phục; `checkDesign` ok. Bảng 13 mã chung `D1 L94 L47 X039 S057 5 L23 M038 Z16 L37 L4 L50
M063` (sản phẩm 15 = trần), Queen dùng 11; viên theo mã: L4 689, L23 481, L94 305, 5 214, Z16 174, D1 43, M063 21, S057 8,
M038 6, L50 6, X039 2.

| union | sản phẩm | thêm | sai vật liệu | sai hình | sai cỡ | ΔE TB | Starry ΔE |
|---|---|---|---|---|---|---|---|
| 9 | 11 | Z1 M063 L47 X039 S057 5 L16 M038 L37 | 305 | 35 | 386 | 28.1 | 11.9 |
| 10 | 12 | Q138 L23 L4 | 275 | 35 | 414 | 17.5 | 11.2 |
| 11 | 13 | L50 | 275 | 35 | 414 | 17.5 | 9.7 |
| 12 | 14 | L16 L94 | 41 | 35 | 414 | 14.6 | 9.3 |
| 13 | 15 | D1 L23 Z16 | 35 | 35 | 188 | 15.7 | 8.9 |

Chấm 3 ô GT với bảng cả ảnh (GT vẽ ≥ 2 mm): hạt recall 60.2 / precision 45.3 / vật liệu 77.4 / cỡ 39.6 / hình 92.5; viên
39.8 / 56.5 / 65.7 / 51.4 / 88.6. Bước láng giềng trên cả ảnh: đổi nhãn 58, thêm 89 hạt (màu 69); số chấm GT trước = sau
(hạt vàng GT tìm thấy 29 / gắn đúng 24 cả hai) → bước này không đổi được kết quả trên GT.

Review `review_heart.png`: tim = X039 (P), không viên nào trong lòng tim; cánh marquise trắng = M063 (G); viên vàng 2.8 (B)
dọc viền tim; còn sai: 2 cánh marquise bên phải thành giọt S057 (khớp đường viền giọt tốt hơn), 1 cánh thành tròn D1.

## Cần captain quyết

- Tim đỏ vẽ 19.3 mm; catalog tim lớn nhất 12×12 (X039) → không bao trọn được.
- Viền hạt vàng li ti ~1 mm: chỉ đặt được viên 2.8 nơi còn chỗ.
- Ngọc vẽ < 5 mm: catalog không có ngọc < 5 mm.
- GT KIT-15 chưa được captain soát.

## KIT-21 — chuỗi hạt (captain msg 015)

`node tools/kit20.mjs --seg outputs/kit/kit20/seg_sam_all.json --chain outputs/kit/kit20/chain_all.json --out outputs/kit/kit21
--chains-off outputs/kit/kit21/nochains/neigh_summary.json` (trước = cùng lệnh `--no-chains --out outputs/kit/kit21/nochains`).

- (a) Tim: X039 12×12 đặt ở tâm mask tim vẽ, đặt trước mọi viên (hạt vẽ to nhất) nên không viên nào đẩy / chồng được.
- (b) Viền vàng: `kit20_chain.py --step 2.95` (2.8 + 0.15), viên vàng 2.8 dọc đường tâm, chỉ nơi khe ≥ 0.15: đặt 125 / 2179 điểm
  (còn lại chồng hạt to đã đặt — viền ~1 mm sát hạt).
- (c) Chuỗi (bước 2c trong `kit20.mjs`): cạnh = 2 hạt tròn cùng cỡ ±15 % (cỡ = trục dài, hạt cầu bị che), khoảng 0.6–1.5 × cỡ,
  cùng nhãn hoặc ΔE76 ≤ 20 (màu chuyển dần); xếp cạnh theo độ thẳng của đoạn nối tiếp + độ đều, bậc ≤ 2, góc đổi ≤ 45°, bước
  lệch ≤ 65 %. Hàng song song kề (cùng cỡ, cùng bước, ≥ 50 % hạt trong 1.6 bước) gộp nhóm. Phiếu nhóm = Σ độ tin màu + 0.1 ×
  tần suất vật liệu theo khoảng cỡ (phá hoà); luật gradient: nhãn dọc chuỗi đúng 2 đoạn liền, đoạn trắng / ngọc có C* thấp hơn →
  ánh sáng → cả chuỗi theo đoạn C* thấp. Cả nhóm 1 cỡ (trung vị). Chuỗi viên ≥ 4 mm có bước vẽ < cỡ + 0.15 (hạt vẽ chồng kiểu
  3D) → đặt lại dọc đường chuỗi, bước = cỡ + 0.15 (`--no-resample` tắt, `--resample-min`).
- (d) Bảng mã: union 13 / sản phẩm 15 (trần), như KIT-20.

Cả ảnh: 278 chuỗi, 187 nhóm, 1444 hạt trong chuỗi; đổi nhãn 36 (trắng→ngọc 15, vàng→ngọc 16, màu→ngọc 3, màu→vàng 1,
ngọc→vàng 1), đổi cỡ 94, luật gradient 2 chuỗi; đặt lại 93 chuỗi (624 hạt → 458 viên); 1929 viên, phủ 42.8 %, check ok.

| | không chuỗi | chuỗi | chuỗi, `--no-resample` |
|---|---|---|---|
| hàng captain (7 hạt) | L23 Z16 Z16 Z16 Z16 Z16 5 | 5 5 5 5 5 5 5 | 5 Z16 Z16 5 5 5 5 |
| viên GT ≥ 2 mm recall / vật liệu / cỡ | 39.8 / 65.7 / 51.4 | 36.4 / 62.5 / 46.9 | 39.8 / 65.7 / 48.6 |
| hạt GT ≥ 2 mm recall / vật liệu / cỡ | 60.2 / 77.4 / 39.6 | 53.4 / 72.3 / 38.3 | 60.2 / 75.5 / 35.8 |

Đặt lại dọc chuỗi giảm điểm GT vì GT (nháp VLM) giữ mỗi hạt vẽ chồng 1 viên ở đúng tâm vẽ; viên đặt lại lệch tâm vẽ tới ~2.3 mm.
Không đặt lại thì viên ngọc 5 ở bước vẽ 4.2–4.7 mm va chạm → 2 viên thu thành Z16. Hàng captain tiếp lên trên bằng 3 hạt nhỏ
hơn (vẽ ~3.3 mm, xa hơn) vẫn là B (L23 2.8): lệch cỡ > 15 % nên không vào chuỗi.

## KIT-22 — giữ vị trí vẽ (captain msg 017)

`node tools/kit20.mjs --seg outputs/kit/kit20/seg_sam_all.json --chain outputs/kit/kit20/chain_all.json --out outputs/kit/kit22
--chains-off outputs/kit/kit21/neigh_summary.json` (trước = KIT-21 head). Mặc định mới: không đặt lại dọc chuỗi
(`--resample-min 4` = KIT-21), va chạm → thử nudge ≤ `--nudge` mm (mặc định 0.2, 12 hướng, bước 0.1) rồi hạ 1 size catalog
cùng loại / cùng vật liệu (`--shrink-steps`), không đổi mã; viền vàng đặt sau hạt to (≥ 4 mm / hình), trước hạt nhỏ
(`--border-last` = KIT-21); bỏ điểm viền nằm trong hạt vẽ không vàng; hạt nhỏ có tâm nằm trong hạt to vẽ gấp ≥ 1.6× thì bỏ
(`--keep-inside` tắt). Chuỗi cho phép cỡ thu dần tới 1.45× (`--taper`).

- (1) Vì sao `--no-resample` ra `5 Z16 Z16 5 5 5 5`: viên ngọc 5 va chạm → fallback `alt` (đá trắng 6 mm, mat 'base') đi qua
  nhánh thu cỡ của `stoneCost`, nhánh này không phân biệt vàng / base → ra Z16 (vàng 4 mm). Sửa: fallback chỉ nhận mã cùng
  vật liệu (`sameMat`), nhãn chuỗi giữ nguyên. 7 viên ngọc 5 không vừa trong ±0.5 mm: cung từ hạt 2 tới hạt 4 dài 8.86 mm,
  3 viên 5 mm cần ≥ 10.3 mm (5 + 0.15 mỗi bước) → thiếu ~0.4 mm sau nudge. Tốt nhất giữ vị trí: `5 5 - 5 5 5 5`
  (hạt 3 bỏ, không có viên mã khác lấp vào).
- (2) Recall: nudge + hạ cỡ cứu 263 viên (lệch ≤ 0.2 mm). Vùng đỏ A trong khung captain: 34 hạt đỏ → 16 viên; cỡ vẽ trung vị
  2.51 mm, khoảng cách láng giềng trung vị 2.22 mm < bước 2.95 mm của viên nhỏ nhất (2.8) → không thể mỗi hạt 1 viên. Khung
  captain theo vật liệu (hạt → viên): ngọc 21 → 10, màu 34 → 16, vàng 15 → 7, trắng 3 → 0.
- (3) Viền vàng 2.8: đặt 812 / 2179 điểm (KIT-21: 125); 846 điểm nằm trong hạt vẽ không vàng (bỏ, để không đè ngọc / màu),
  521 va chạm, 54 nhờ nudge. Đổi lại hạt nhỏ mất chỗ: 1319 viên từ hạt + 812 viền = 2131 (KIT-21: 1804 + 125 = 1929).
- (4) Chuỗi thu cỡ dần: 333 chuỗi (KIT-21 278); hàng captain nối thêm lên trên tới (2330,1637) thành ngọc nhưng viên này va
  chạm → bỏ; 2 hạt trên (2364,1657), (2277,1619) chỉ có mask 1.6 / 1.9 mm (SAM tách kém) nên không vào chuỗi, không có viên.

Viên GT vẽ ≥ 2 mm (3 ô) recall / vật liệu / cỡ:

| | recall | vật liệu | cỡ | viên / viền | hàng captain |
|---|---|---|---|---|---|
| KIT-20 | 39.8 | 65.7 | 51.4 | 1949 / 127 | — |
| KIT-21 head (đặt lại dọc chuỗi) | 36.4 | 62.5 | 46.9 | 1929 / 125 | 5 5 5 5 5 5 5 |
| KIT-21 `--no-resample` | 39.8 | 65.7 | 48.6 | — | 5 Z16 Z16 5 5 5 5 |
| **KIT-22 (nudge 0.2, mặc định)** | **43.2** | **65.8** | **52.6** | 2131 / 812 | 5 5 - 5 5 5 5 |
| KIT-22 nudge 0 | 40.9 | 69.4 | 50.0 | 1974 / 797 | |
| KIT-22 nudge 0.3 | 44.3 | 66.7 | 51.3 | 2196 | |
| KIT-22 nudge 0.4 | 45.5 | 65.0 | 50.0 | 2250 | |
| KIT-22 nudge 0.5 | 45.5 | 67.5 | 50.0 | 2300 | |
| KIT-22 nudge 0.5 + `--alt-nudge` | 47.7 | 64.3 | 50.0 | 2344 / 877 | |
| KIT-22 `--border-last` | 46.6 | 63.4 | 46.3 | 2200 / 115 | |

Hạt GT ≥ 2 mm: 60.2 / 77.4 / 35.8 (KIT-21 53.4 / 72.3 / 38.3). Vàng GT: 18 / 166 có viên (KIT-21 12), 17 nhãn vàng. Bảng mã
union 13 (Queen 12), sản phẩm 15, check ok, phủ 44.2 %. Nudge 0.5 (trần captain) tăng recall nhưng cỡ 50.0 < 51.4 (KIT-20) →
mặc định 0.2. `--alt-nudge` (nudge cả mã đổi vật liệu) chủ yếu thêm ngọc→trắng nên hạ vật liệu.
