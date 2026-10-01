# Phê bình storefront — vùng UI-1 (trang chủ, PDP theme, giỏ, header/footer)

Method: dual-agent (A: thiết kế/hành trình khách · B: detector + đo trình duyệt), tổng hợp bởi ps-ui1-shell.
Ngày 2026-10-01, main `defbb62`. Server riêng :3201 (DB seed mới + `load:rollout --dir …/pc-v2-template-cutout/rollout`, 3 sản phẩm theme active), vì :3000 không chạy.
Vai: khách Mỹ lần đầu, mua quà Giáng sinh là chân dung chó. Đi thật ở 375×812 (touch) và 1440×900: trang chủ → menu/search → `/products/the-starry-king` → gallery → buy box (upload, AI mock, xác nhận) → giỏ (đổi số lượng, mã giảm) → footer.
Ảnh chụp: `.impeccable/critique/ui1-shell/` (`a-*` hành trình, `b-*` detector).

## Điểm (1–10)

| Tiêu chí | Điểm | Vì sao |
|---|---|---|
| Tin cậy | 6 | Review mẫu có nhãn, ngày giao từ dữ liệu, khách duyệt ảnh trước khi mua. Nhưng PDP có 3 bậc giảm giá mâu thuẫn và cảnh trong gallery là khung chữ nhật dọc trong khi mọi size đều vuông. |
| Rõ ràng | 5 | Hai điều khiển số lượng cho cùng một giá trị; chip "Pick a style" trên sản phẩm theme vẫn đổi style dù tiêu đề/ảnh/giá giữ Starry King; trang chủ không dẫn tới sản phẩm theme nào. |
| Thẩm mỹ | 7 | Caprasimo + mực ấm + đỏ đúng 4 vai, màn đầu 375 sạch. Buy box mobile dài ~3,4 màn tới Add to cart; header bảng Buy More màu đỏ (phá Ribbon Rule). |
| Tốc độ cảm nhận | 8 | Trang 0,7–1,0 s (warm). AI ~15–20 s nhưng có trạng thái theo bước + progress. |
| Mobile | 7 | Không scroll ngang (scrollWidth = 375 ở cả 3 trang), swipe/chấm/sticky bar chạy, 0 lỗi console. Ảnh preview của khách chỉ ~165 px; dock nổi đè lên ô nhập. |

Nielsen (0–4): 3 · 3 · 3 · **1** (nhất quán) · 2 · 3 · 3 · 2 · 2 · 3 = 25/40.

So với chuẩn Shopify / mogcustom (chỉ bố cục, hành vi): shell (announcement, header 2 hàng, breadcrumb, footer nhiều cột, sticky ATC) đã ngang chuẩn. Chỗ thua là *logic bán*: Shopify/mogcustom có **một** bậc "mua nhiều giảm nhiều" và giá trên PDP luôn là giá thật khách trả; ở đây giá PDP không phải giá tốt nhất khách có thể có.

## Lỗi

Không có P0: luồng mua chạy hết ở cả hai cỡ (upload → preview AI mock → "This is my pet" → giỏ, tổng khớp PDP $76.95).

| # | Mức | Chỗ | Tái hiện | Ảnh | Vì sao | Đề xuất |
|---|---|---|---|---|---|---|
| 1 | P1 | Ô số lượng (`Personalizer.tsx` BundlePicker), bảng Buy More (`BulkDiscounts.tsx`), announcement bar | `/products/the-starry-king`: ô ghi 2/3/5 = 10/15/20%, announcement "Order 2 portraits, save 10%"; bảng Buy More ghi 2/3/5 = 15/20/25% kèm mã; trong giỏ mã **thay** giảm tự động | a-1440-pdp-top, a-1440-pdp-bulk, a-375-cart-code | Ba thông điệp giá khác nhau trên một trang; giá PDP cho 2 cái ($71.96) không phải giá tốt nhất ($67.97 với PEARL2). Khách thấy bị "giấu giá" | **Cần captain chọn** (dữ liệu giá, không phải UI): một bậc duy nhất — hoặc tự áp bậc tốt nhất và bỏ mã số lượng, hoặc cho ô số lượng/giá sống/announcement dùng đúng bậc mã |
| 2 | P1 | Giỏ: `DiscountCode.tsx`, gợi ý bundle `src/lib/cart.ts` | 2 cái → áp PEARL2 → tăng lên 3 → giảm về 1 | a-375-cart-code, a-375-cart-qty1 | Ở 2 cái có PEARL2 vẫn hiện "Add 1 more to save 15%"; ở 3 cái nói "bundle already better" (cùng 15%) mà không gợi ý PEARL3 rẻ hơn $6; ở 1 cái vẫn còn "Code PEARL2 applied. You save $11.99." cạnh "needs 2 or more" | Tính lại trạng thái mã khi đổi số lượng, xoá chữ cũ, gợi ý mã tốt hơn đang đủ điều kiện, ẩn gợi ý bundle khi mã đã tốt hơn |
| 5 | P1 | Trang chủ `src/app/(store)/page.tsx` | Đếm link sản phẩm trong `main` | a-375-home-full, a-1440-home-full | 3 link đều về `/products/pearl-pet-portrait`; thẻ "Pick a style" là ảnh không bấm được; không có lối vào quà Giáng sinh dù đang mùa | Thẻ style thành thẻ sản phẩm theme có link; thêm lối vào bộ sưu tập Christmas |
| 7 | P1 | Gallery theme (ảnh rollout) | Bất kỳ slide nào | a-375-pdp-top, a-1440-pdp-top | Cảnh treo tường là khung dọc ~2:3, mọi size 8×8…20×20 vuông → khách hiểu sai thứ nhận được | Ngoài vùng: ảnh từ pipeline pearl_compare (xem mục giao lại). Trong vùng không sửa ảnh |
| 9 | P2 | `BulkDiscounts.tsx` header bảng | Xem bảng | a-1440-pdp-bulk | Nền `accent-hover` đỏ phá Ribbon Rule | Header mực/muted |
| 12 | P2 | `FloatingDock` ở 375 | Cuộn tới "Pet's name" | a-375-pdp-preview | Nút lên đầu/mail đè lên ô nhập và chip | Ẩn dock khi buy box trong tầm nhìn trên mobile |
| 14 | P2 | Giỏ, phí ship | 2 × 8×8 = $79.96 | a-375-cart | Thiếu 3¢ tới free ship $79.99, tính $6.99, không báo "còn $0.03" | Dòng "You're $X away from free shipping" |
| 15 | P2 | Trang chủ 375 | Mở `/` | a-375-home | Màn đầu chỉ chữ (ảnh hero bắt đầu y=731/812); "Free US shipping…" lặp 2 lần (announcement + hero) | Ảnh lên trên CTA ở mobile; bỏ dòng lặp |
| 16 | P2 | Giỏ `CartClient.tsx` | Bật gift card; xem link | a-375-cart | Textarea viền Hairline (phá Two Borders Rule); link "Create another portrait" cao 20 px; tên sản phẩm không link về PDP | `border-input`, `min-h-11`, link tiêu đề |
| 17 | P2 | Footer/breadcrumb ≥ 640 px | Đo link | b-home-1440 | `sm:min-h-9` / `sm:min-h-8` → link cao 36/32 px | Giữ 44 px (`Footer.tsx`, `Breadcrumbs.tsx`) |

Detector (B): CLI 0 finding trên 40 file. Overlay: `first-viewport-column-overflow` ở PDP 1440 là dương tính giả (cột gallery sticky, buy box dài là chuẩn PDP); `layout-transition` gắn nhầm vào `<body>`, nguồn thật là thanh progress (mục 18, personalizer) và chấm gallery `Gallery.tsx:239` (UI-1 sửa). Contrast: 0 lỗi AA (thấp nhất 5,34:1).

## personalizer (owner: ps-pdp-preview-editor)

Theo luật captain cho vòng này, UI-1 không sửa `src/components/personalizer/*`; các lỗi dưới đây chuyển cho chủ mới (số giữ như bảng chính).

| # | Mức | Chỗ | Tái hiện | Ảnh | Vì sao | Đề xuất |
|---|---|---|---|---|---|---|
| 3 | P1 | Buy box: ô "Quantity 1/2/3/5" + select 1…10+ cạnh Add to cart | Chọn "2 portraits" → select cũng thành 2; chọn select 3 → ô "3" sáng | a-1440-pdp-bulk | Hai điều khiển cho một giá trị; select có 4, 6–10 không có ô tương ứng | Gợi ý (cần captain: select là yêu cầu của captain ở task trước): giữ select, đổi ô thành một dòng "Buy 2+ and save" bấm được |
| 4 | P1 | Chip "Pick a style" trên PDP theme | `/products/the-starry-king` → chọn Sunflower Queen | a-1440-pdp-style-mismatch | Tiêu đề/gallery/giá vẫn Starry King nhưng lần generate sau dùng style khác → đơn "Starry King" ra ảnh theme khác | Sản phẩm theme khoá style của nó (ẩn chip, hiện "Style: Starry King"); muốn theme khác thì đi sang sản phẩm theme đó |
| 6 | P1 | Preview của khách (`PreviewEditor.tsx`) ở 375 | Tick consent → upload → Generate | a-375-pdp-generate | Ảnh AI hiện ~165 px cạnh ảnh gốc; gallery vẫn là ảnh mẫu, thú của khách chỉ là thumb 64 px ở sticky bar — trái nguyên tắc 1 "pet is the hero" | Dưới 640 px: ảnh AI full-width, ảnh gốc là ô nhỏ chồng góc; (sau) đưa preview vào slide 1 của gallery |
| 8 | P1 | Lỗi bắt buộc (`Personalizer.tsx`) | AI mode, chưa có ảnh, bấm Add to cart | a-375-pdp-atc-nophoto | Báo "Generate with AI is required" khi thứ thiếu thật là ảnh | Chữ này là captain chỉ định ở task buy box → giữ nguyên, nêu để captain cân nhắc "Add a photo of your pet to continue" |
| 10 | P2 | Nút sau preview (`Personalizer.tsx`) | Generate xong | a-375-pdp-generate | Nút mực chính đổi thành "Try again in Starry King" — đọc như báo lỗi | Nút phụ (outline) "Regenerate" |
| 11 | P2 | `UploadBox.tsx` thẻ ảnh đã đăng | 375 sau khi generate | a-375-pdp-preview | Tiêu đề cụt "AI por…", tên file 3 dòng cạnh Change/Edit | Dưới 400 px xếp nút xuống dưới chữ |
| 13 | P2 | Dòng consent | Chọn Designer finish | a-375-pdp-designer | Vẫn ghi "processed by Google Gemini (AI generation)" | Copy theo mode |
| 18 | P2 | Thanh progress (`JobProgress.tsx`) | Detector `layout-transition` | b-pdp-starry-375 | Animate `width` gây layout (chấm gallery cùng lỗi, UI-1 sửa) | `transform: scaleX` |

## Điểm mạnh

- Giá sống đúng và tức thì theo size/số lượng/add-on, có aria-live, URL `?variant=`, giỏ khớp PDP.
- Gallery + lightbox chắc: swipe, chấm, thumb 64 px, mũi tên, focus vào Close, Esc trả focus.
- Cơ chế tin cậy thật: review mẫu có nhãn, ngày giao theo dữ liệu, trạng thái generate theo bước, có lối designer, phải xác nhận "This is my pet".

## Giao lại cho chủ khác (không sửa ở đây)

Ghi vào `docs/critique/ui2-account.from-ui1.md` (search/catalog) và mục dưới cho lead / pipeline / discounts:

- **pc-v2 / pipeline pearl_compare** — cảnh final là khung dọc ~2:3 trong khi sản phẩm vuông (mục 7).
- **lead `src/lib/seo.ts` / seed theme** — tiêu đề trang theme thiếu tên shop ("The Starry King — Custom Pearl Pet Portrait") trong khi demo dùng "… | Pearl Atelier".
- **UI-3 / discount-codes `src/lib/discounts.ts:93`** — cột "Spend" mà mọi dòng là "Buy N items"; cùng gốc với mục 1.
- **lead seed demo** — `/products/demo-christmas-scarf-portrait` ảnh 1 là sunflower crown (alt "…sunflower crown"), không có khăn.

## Đã sửa ở B2 (vùng UI-1)

| # | Sửa | File | Ảnh sau |
|---|---|---|---|
| 2 | Giỏ: gợi ý mã PDP rẻ hơn kèm nút "Use CODE" (`discount_better`); ẩn gợi ý bậc số lượng khi mã đã thắng; thông báo live region gắn với trạng thái mã nên không còn "applied" cũ sau khi đổi số lượng | `src/lib/cart.ts`, `src/components/cart/DiscountCode.tsx`, `CartClient.tsx` | after-375-cart, after-1440-cart |
| 5 | Trang chủ: "Pick a portrait" = thẻ sản phẩm thật (theme trước, demo chỉ khi chưa đủ 2), "Shop all", hàng "Shop by occasion" dẫn vào collection | `src/app/(store)/page.tsx` | after-375-home(-full), after-1440-home(-full) |
| 9 | Header bảng Buy More: muted/mực thay đỏ | `src/components/pdp/BulkDiscounts.tsx` | after-1440-pdp-bulk, after-375-pdp-bulk |
| 12 | Dock nổi ẩn trên mobile khi khách đang gõ vào ô nhập | `src/components/shell/FloatingDock.tsx` | — |
| 14 | Giỏ: "Add $X more for free shipping." khi chưa tới ngưỡng (`free_shipping_gap_cents`, cùng công thức `pricing.totals`) | `src/lib/cart.ts`, `CartClient.tsx` | after-*-cart |
| 15 | Hero mobile: ảnh lên trước (cắt 4:3), bỏ dòng free-shipping lặp với announcement bar | `src/app/(store)/page.tsx` | after-375-home |
| 16 | Giỏ: textarea `border-input`, link "Create another portrait" 44 px, tên sản phẩm link về PDP | `CartClient.tsx` | after-*-cart |
| 17 | Footer: link giữ 44 px ở mọi cỡ. Breadcrumb giữ 32 px ≥ 640 px (≥ 24 px AA 2.5.8; 44 px đẩy dải thumbnail khỏi màn đầu 1440×900) | `src/components/shell/Footer.tsx` | — |

Chưa sửa: #1 chờ captain (key `ui1-discount-ladder`); #7 ngoài vùng (pipeline); chấm gallery (#18) giữ `width` vì 8→20 px trên ≤ 6 chấm không đáng đổi spacing.
Ảnh trước: `a-*` / `b-*`; ảnh sau: `after-*` (cùng thư mục, server :3201 có theme rollout).
