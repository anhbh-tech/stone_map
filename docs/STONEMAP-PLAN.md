# STONEMAP — kế hoạch hệ thống mới (từ spec note 2026-10-02)

Nguồn yêu cầu: `~/Downloads/personalized_pet_stone_mapping_spec_note.md`.
Chỗ dựa: quy ước thật `docs/KIT-DATA.md` và DB `kit/db/kit.sqlite`, cùng các bài học từ KIT-1…17.

## 0. Hệ thống làm gì

Mỗi order chạy theo chuỗi sau:
1. Ba layer: Background + Trang phục + Pet.
2. Stone map cho từng layer.
3. Ngân sách mã ≤ 13 (tối đa 15).
4. Đếm số viên theo từng layer, rồi cộng thành tổng.
5. Xuất SVG sửa được, mockup 3D và BOM.
6. Designer QC.
7. Tạo delivery link, gắn vào order và CRM.

KPI chính là **số chỉnh sửa designer phải làm trên mỗi order**. Con số này đo bằng diff giữa bản máy ra và bản designer duyệt. Đích đến là 0, tức là map lại thiết kế 100%. Thước đo kỹ thuật là độ đúng so với bản designer duyệt: vị trí, mã, size, shape.

## 1. Bài học từ bản cũ, thành nguyên tắc thiết kế

| Bài học (đã đo) | Nguyên tắc mới |
|---|---|
| Bản đồ tự động cho cả ảnh hay sai đá to và hình lạ: sapphire bị chia vụn, opal cũng vụn, tim bị thành đá tròn. | **Background và trang phục là template**, map một lần và người duyệt 100%. Mỗi order chỉ chạy tự động phần pet. |
| Gán mã theo màu gần nhất chỉ đúng 18–36%, vì màu ảnh lệch catalog ΔE 19–30. | Mã của pet được học từ dữ liệu thật (k-NN, KIT-17) và từ các bản designer đã sửa. Không dùng RGB gần nhất. |
| VLM có ích cho đá to (recall 75–91%) nhưng tệ khi đếm hạt nhỏ, chi phí lại khó kiểm soát (KIT-15 vượt 23%). | Pipeline mỗi order **không gọi API**. VLM chỉ là công cụ offline khi dựng template mới. |
| Cùng lúc 3 worker sửa và đánh giá bằng mắt, nên không biết thay đổi nào làm tốt lên. | Có một bộ đáp án và một điểm số. Mọi thay đổi phải tăng điểm mới được nhận. |
| Ký hiệu "M" bị đọc nhầm thành marquise. | Ký hiệu đá không dùng các chữ đầu series (L Z W D Q M S X H). Ngọc trai dùng số. |
| Size vật lý khác size reference (2.8 → 2.2). | Va chạm và khe hở tính theo **vật lý**, mục tiêu khe 0.15–0.2 mm. SVG vẽ theo **reference**. |

## 2. Kiến trúc

```
catalog (DB, có version) ──┐
template BG (Starry) ──────┤
template Costume (Queen/…) ┼─► compose ─► design.json ─► QC registry ─► SVG / BOM / 3D mockup ─► delivery link ─► CRM
pet layer (mỗi order) ─────┘        ▲                       │
                                    └──── designer sửa ◄────┘  (diff lưu lại, dùng làm dữ liệu học)
```

1. **`design.json` là nguồn sự thật duy nhất**, định dạng `stonemap-design/1`.
   - `layers[]`: mỗi layer có `stones[]`. Mỗi viên lưu `{id, layer, code, shape, x_mm, y_mm, phys_mm, ref_mm, rot_deg, locked, source}`.
   - `catalogVersion`, `symbols{}`.
   - SVG, BOM và mockup đều sinh ra từ file này.
2. **SVG sửa được và đọc ngược lại được.**
   - Cấu trúc: mỗi layer là một `<g>`, mỗi viên mang `data-*` (code, phys, layer).
   - Designer sửa trong Illustrator/Inkscape hoặc editor web, rồi import ngược lại thành `design.json`, đếm lại và chạy lại QC.
   - Đi tiếp từ `lib/kit/svgio.js` và `svg.js`.
3. **Catalog có version.**
   - Bảng catalog chứa mọi shape và size. Thêm mã mới không cần sửa code.
   - Mỗi design ghim version catalog mình dùng.
   - Đi tiếp từ `lib/kit/catalog.js` và `tools/build_kit_db.py`.
4. **Template.**
   - Một template gồm: mask vùng, danh sách viên đã duyệt, và mask "ô mặt" (chỗ pet ghép vào).
   - Có công cụ onboarding cho trang phục mới, chạy theo các bước: detect theo tầng → VLM offline (tùy chọn) → designer sửa → khoá.
   - Mặt người là một kiểu "ô mặt" khác.
5. **Layer pet.**
   - Các bước: upscale ×4 (Real-ESRGAN local) → tìm tâm hạt bằng LoG nhiều cỡ → k-NN ra mã → xếp chuỗi theo hướng lông.
   - **Ràng buộc mã:** ưu tiên dùng lại mã mà background và trang phục đã dùng. Mã mới chỉ được dùng tới mức `13 − số mã đã dùng`. Nếu thật cần, cho phép tới 15 và gắn cảnh báo.
   - Nếu vượt ngân sách mã, hệ thống gộp các mã có màu gần nhau, chọn cách gộp có tổng ΔE thấp nhất.
6. **Ghép layer (compose).**
   - Thứ tự xếp chồng: BG < Costume < Pet.
   - Ở đường nối giữa các layer, viên nào va chạm thì bỏ viên của layer dưới. Viên đã được người duyệt (`locked`) không bao giờ bị bỏ, trừ khi designer đồng ý.
7. **QC registry.**
   - Mỗi kiểm định là một plugin `{id, level: error|warn, run(design) → findings[]}`. Thêm loại kiểm định mới chỉ là thêm một file.
   - Các kiểm định đầu tiên:
     - số mã: > 15 là lỗi, 14–15 là cảnh báo, ≤ 13 là đạt;
     - mã có trong catalog;
     - không có viên chồng nhau;
     - khe 0.15–0.2 mm;
     - quy tắc ký hiệu;
     - tổng số viên các layer = tổng của sản phẩm;
     - vùng đá còn lỗ trống;
     - ΔE giữa mockup và ảnh preview.
8. **Mockup 3D.**
   - Bản vẽ trên server dựa trên `lib/kit/render.js` và thêm:
     - normal map cho từng shape (tròn mài giác, ngọc trai, marquise, tim, giọt);
     - bóng đổ;
     - màu lấy theo catalog.
   - Bản xem tương tác trên web dùng three.js instanced mesh, đọc cùng file `design.json`.
9. **Giao hàng.**
   - Bộ file của mỗi order gồm: `mockup.png`, `map.svg`, `bom.csv/json` (symbol → mã → thông tin catalog → số viên, chia theo layer và tổng) và `qc.json`.
   - Sinh link có thời hạn, rồi gọi webhook sang CRM.

## 3. Các giai đoạn

Mỗi giai đoạn có tiêu chí đạt rõ ràng. Mỗi giai đoạn do một worker làm, mỗi worker sở hữu một vùng file riêng.

| GĐ | Nội dung | Đạt khi | Dựa trên |
|---|---|---|---|
| **P0** | Schema `design.json` · catalog có version · QC registry (8 kiểm định ở §2.7) · SVG đọc/ghi hai chiều | Snowman và Dachshund đọc vào rồi ghi ra không lệch viên nào; QC chạy sạch trên cả 2 sản phẩm thật | svgio, catalog, checkDesign, kit.sqlite |
| **P1** | Template: Starry, Queen (KIT-16), King · công cụ onboarding trang phục | Captain/designer duyệt từng template; 0 lỗi QC | KIT-11, 12a, 12b, 16, KIT-13 offline |
| **P2** | Layer pet + ngân sách mã + dùng lại mã | Điểm bench (KIT-17) cao hơn baseline KIT-9; pet thêm ≤ 4 mã mới | KIT-17, place.js, detect.js |
| **P3** | Ghép layer + đếm theo layer + BOM + mockup 3D | 1 order mẫu Queen + pet ra đủ 4 file và QC sạch | render.js |
| **P4** | Màn QC cho designer: hàng chờ, sửa viên, duyệt/trả lại, lưu diff | Designer sửa và duyệt một order trên web; số lần sửa được ghi lại | public/kit.js |
| **P5** | Delivery link + CRM | Link gắn vào order; mở được 4 file | pearl_store (order) |
| **P6** | Mở rộng: mặt người, trang phục mới, mã/shape mới, kiểm định mới | Thêm mỗi thứ mà không phải sửa lõi | các registry ở trên |

**Phạm vi hiện tại: chỉ P0–P3** (captain 2026-10-02). P4–P6 để sau, chưa làm. Background **đính kín** (không còn partial 31% như Starry KIT-11).

Thứ tự: P0 trước. Sau đó P1 và P2 chạy song song (KIT-16 và KIT-17 đang làm chính hai việc này). Tiếp theo là P3, rồi P4 và P5.

## 4. Cần captain chốt

1. **Code mới:** đã chốt tạm `lib/stonemap/` trong pearl_compare, tách ra repo riêng ở P5 khi ranh giới service đã rõ.
2. **CRM nào, và delivery link lưu ở đâu** (S3/R2 hay server riêng).
3. **Mức của mockup 3D** (tạm làm ảnh tĩnh có bóng):
   - ảnh tĩnh có bóng đổ là đủ, hay
   - cần thêm bản xoay được trên web.
4. **File quy trình của xưởng:** hiện ta có `requirements/DATA/yeu cau san xuat.txt`. Nếu xưởng còn file nào khác, captain gửi giúp.
5. ~~Background đính kín hay một phần~~ → **đính kín** (đã chốt).
