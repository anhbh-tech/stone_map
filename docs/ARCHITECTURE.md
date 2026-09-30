# Pearl Atelier — kiến trúc hệ thống

Cửa hàng bán tranh thú cưng cá nhân hoá (pearl mosaic), tự host nhưng tách lớp giống mô hình Shopify + app mà mogcustom dùng:
**commerce core** (catalog, giỏ, đơn, settings) không biết gì về AI; **personalization app** (upload, kiểm ảnh, job AI, preview, file in) chỉ giao tiếp với core qua `design_id` gắn vào dòng giỏ/đơn.
Học từ mogcustom: giữ phần họ làm đúng, sửa 12 điểm họ thiếu (bảng cuối file).

## 1. Sơ đồ

```
 Trình duyệt ──► Storefront (Next.js App Router, RSC)          Admin (/admin, đăng nhập admin/admin123)
   │  PDP · giỏ · checkout · policy                               sản phẩm · add-on · settings · đơn · hàng chờ designer · email · số liệu job
   │                                                                  │
   ├─► /api/personalize/*  ── Personalization app ──────────────────┤
   │     uploads (preflight) · designs · jobs (poll) · confirm         │
   │          │ ghi bảng uploads/designs/jobs                          │
   │          ▼                                                        │
   │     Worker (npm run worker hoặc inline khi dev)                   │
   │       analyze → generate (mock|gemini|openai) → check → render    │
   │       file in N×N px · preview webp · mockup treo tường · email   │
   │                                                                  │
   ├─► /api/cart/*, /api/checkout ── Commerce core ────────────────────┤
   │     dòng giỏ = variant + design_id + properties ("_" = ẩn)         │
   │     checkout giả lập → orders/order_lines (giữ design_id)          │
   │                                                                  │
   └─► /api/events ── "web pixel" first-party (1 endpoint, không script bên thứ ba)
                    SQLite (node:sqlite) · storage/ (ảnh upload, file in, preview)
```

Không có dịch vụ ngoài bắt buộc: provider AI mặc định là `mock` (trả ảnh mẫu sau `settings.ai.mock_ms`), mailer ghi vào bảng `email_outbox`, thanh toán giả lập. Đổi `settings.ai.provider` sang `gemini`/`openai` và điền key trong `.env` để gen thật (prompt lấy từ `~/pearl_compare/public/themes.js`).

## 2. Module và người sở hữu

Chỉ sửa file trong vùng của mình. Cần đổi file dùng chung (cột **lead**) → ghi rõ trong PR, không tự đổi hợp đồng.

| Module | Thư mục | Chủ |
|---|---|---|
| Nền dùng chung | `db/schema.sql`, `src/lib/{db,types,settings,catalog,pricing,money,ids,password,seo,reviews}.ts`, `src/app/{layout.tsx,globals.css}` | lead |
| A. Admin + auth | `src/app/admin/**`, `src/app/api/admin/**`, `src/lib/auth.ts`, `src/proxy.ts` | crew A |
| B. Personalization + worker | `src/app/api/personalize/**`, `src/lib/personalize/**`, `src/worker/**`, `src/instrumentation.ts`, `storage/` layout | crew B |
| C. PDP + personalizer UI | `src/app/(store)/products/**`, `src/components/pdp/**`, `src/components/personalizer/**` | crew C |
| D. Store shell, giỏ, checkout, SEO, hiệu năng | `src/app/(store)/{layout.tsx,page.tsx,cart,checkout,orders,policies}/**`, `src/app/api/{cart,checkout,events}/**`, `src/components/{cart,shell}/**`, `src/lib/{cart,pixel}.ts`, `src/app/{sitemap,robots}.ts` | crew D |

Migration mới: `db/migrations/<module>_NNN_*.sql` (ví dụ `b_001_job_metrics.sql`) để hai crew không trùng tên.

## 3. Luồng chính

1. **Upload** — khách tick ô đồng ý (dòng consent + thời hạn lưu `settings.privacy.retention_days` + link `/policies/privacy`) → `POST /api/personalize/uploads`. Server chuẩn hoá (xoay EXIF, bỏ metadata GPS) và chạy **preflight**: cạnh ngắn ≥ `min_side_px`, độ nét (variance of Laplacian) ≥ `min_sharpness`, có thú cưng với confidence ≥ `min_pet_confidence` (Gemini Flash structured output, giống `/api/analyze` trong pearl_compare; provider mock dùng heuristic). Không đạt → hiện lỗi ngay dưới ô upload, không cho chạy AI, gợi ý **Designer finish**.
2. **Generate** — `POST /designs/:id/generate` tạo job, trả 202 + `JobView`. Trình duyệt poll `GET /jobs/:id` mỗi 1.5 s. `eta_ms` = p75 thời gian thật của 50 job thành công gần nhất cùng provider (chưa đủ dữ liệu → `settings.ai.mock_ms` hoặc 60 s), cộng thời gian của các job đứng trước. Trong lúc chờ, khách vẫn chọn size, add-on, và nhập email để nhận link khi xong.
3. **Kiểm ảnh ra** (worker) — judge như `/api/check` của pearl_compare; không đạt → chạy lại tối đa 1 lần rồi mới trả. Kết quả lưu `jobs.check_result`.
4. **Preview + xác nhận** — ảnh gốc và ảnh AI cạnh nhau; xoay / zoom / kéo (lưu `designs.transform`), mockup treo tường, ô tick bắt buộc “This is my pet”. `POST /designs/:id/confirm` → worker render file in `variants.print_px`² PNG sRGB 300 dpi theo transform.
5. **Giỏ** — `POST /api/cart/lines` chỉ nhận design `confirmed` (AI) hoặc `in_review` (designer). Properties: `_design_id`, `_preview_url`, `_print_url` ẩn; khách chỉ thấy thumbnail + `Pet name`, `Style`.
6. **Checkout giả lập** — tạo đơn, copy design_id vào `order_lines`, gửi email xác nhận vào outbox, bắn event `checkout_completed`.
7. **Xưởng / admin** — đơn hiện preview + nút tải file in; hàng chờ designer (ghi chú, tên bé, ảnh gốc → upload bản làm tay → duyệt).

## 4. Hợp đồng API

Kiểu dữ liệu ở `src/lib/types.ts`. Lỗi luôn là `{ error: { code: string, message: string } }` với HTTP 4xx/5xx.

### Personalization (crew B)
| Method | Path | Body | Trả về |
|---|---|---|---|
| POST | `/api/personalize/uploads` | multipart `file`, `consent=1` | `201 { upload_id, url, preflight: Preflight }`; thiếu consent → `400 consent_required` |
| POST | `/api/personalize/designs` | `{ product_id, variant_id?, upload_id, mode, style?, pet_name?, notes?, email? }` | `201 DesignView`; mode `ai` mà preflight không ok → `422 preflight_failed` |
| GET | `/api/personalize/designs/:id` | — | `DesignView` |
| PATCH | `/api/personalize/designs/:id` | `{ variant_id?, transform?, style?, pet_name?, notes?, email? }` | `DesignView` |
| POST | `/api/personalize/designs/:id/generate` | `{ style }` | `202 JobView` |
| GET | `/api/personalize/jobs/:id` | — | `JobView` |
| POST | `/api/personalize/designs/:id/confirm` | `{ confirmed: true }` | `DesignView` (status `confirmed`) |
| POST | `/api/personalize/designs/:id/submit` | — (mode designer) | `DesignView` (status `in_review`) |
| GET | `/media/:path*` | — | ảnh trong `storage/` (upload, preview, mockup); file in chỉ qua `/api/admin/...` |

### Commerce (crew D)
| Method | Path | Body | Trả về |
|---|---|---|---|
| GET | `/api/cart` | — | `CartView` (dòng, add-on, bundle hiện tại + gợi ý bậc kế, `Totals`) |
| POST | `/api/cart/lines` | `{ variant_id, qty, design_id }` | `CartView`; design chưa xác nhận → `409 design_not_confirmed` |
| PATCH / DELETE | `/api/cart/lines/:id` | `{ qty }` | `CartView` |
| PUT | `/api/cart/addons` | `{ addon_id, on, text? }` | `CartView` |
| POST | `/api/checkout` | `{ email, name, address, shipping_method }` | `201 { order_number }` |
| POST | `/api/events` | `{ name, payload }` (sendBeacon) | `204` |

### Admin (crew A) — mọi route dưới `/admin` và `/api/admin` cần cookie phiên
`POST /api/admin/login {username,password}` · `POST /api/admin/logout` · CRUD `products`, `variants`, `images` (alt bắt buộc), `addons`, `bundle-tiers`, `settings/:key` · `GET orders`, `PATCH orders/:id {status}` · `GET /api/admin/designs/:id/print` (tải file in) · `POST /api/admin/designs/:id/artwork` (designer upload bản làm tay) · `PATCH designs/:id {status: approved|rejected}` · `GET emails` · `GET metrics/jobs` (p50/p75, tỉ lệ lỗi, tỉ lệ preflight bị chặn).

## 5. Quy ước

- **UI phải dùng skill `ui-ux-pro-max`** (vendored ở `.claude/skills/ui-ux-pro-max`): trước khi làm một màn hình, chạy `search.py` với `--domain ux` / `--stack nextjs` cho đúng vấn đề, và đi hết Pre-Delivery Checklist của skill (không emoji làm icon, contrast 4.5:1, focus thấy được, target 44 px, reduced-motion, 375/768/1024/1440).
- Chỉ dùng token trong `globals.css` (`bg-card`, `text-muted-foreground`, `bg-accent text-on-accent`…), không hex thô. Icon SVG inline (Lucide), không thêm thư viện icon.
- Next.js 16: đọc `node_modules/next/dist/docs/` trước khi viết (params là Promise, `proxy.ts` thay middleware…).
- Không thêm script bên thứ ba. Tracking qua `src/lib/pixel.ts` → `/api/events`.
- Mỗi trang đúng 1 `<h1>`; ảnh luôn có `alt`; `next/image` có width/height (CLS < 0.1).
- Tiền là cent nguyên; format bằng `src/lib/money.ts`.
- Câu chữ về ship / khung / số liệu chỉ lấy từ `getSettings()` + `shippingHeadline()`; `claims.* = null` thì không hiển thị con số.
- Test: `npm test` (vitest, logic), `npm run test:e2e` (Playwright, luồng chính, fixture ở `tests/fixtures/`). Mỗi crew thêm test cho phần của mình. `npm run typecheck` và `npm run lint` phải sạch.

## 6. Mogcustom → ở đâu trong hệ thống này

| # | Vấn đề ở mogcustom | Sửa ở | Cách kiểm |
|---|---|---|---|
| 1 | AI bịa thú cưng từ hình không phải thú | B preflight + C so sánh cạnh nhau + tick xác nhận | e2e: `not-a-pet.jpg` bị chặn, nút Generate khoá |
| 2 | ETA ghi "a few seconds", đứng ở 99% | B `eta_ms` từ số liệu thật; C cho chọn size/add-on khi chờ, email link | progress tăng đều, không có số cứng |
| 3 | Mô tả nói có khung nhưng bán khung; ship US vs Worldwide | lead: `settings`, `frame_included`, `shippingHeadline()` | grep không còn câu ship hard-code |
| 4 | Social proof ("12,532 reviews on Trustpilot" + testimonial) | lead: bảng `reviews` + `src/lib/reviews.ts` (số sao, số review, histogram tính từ dữ liệu); C hiện trên PDP; A duyệt review. Review seed là `is_sample` → nhãn "Sample review", production tự loại. Không ghi tên nền tảng review bên ngoài khi chưa tích hợp thật với họ | e2e: có nhãn Sample ở dev; `NODE_ENV=production` không còn review mẫu |
| 5 | URL customall hiện trong giỏ | D: `visibleProps()` + thumbnail | e2e giỏ không có chuỗi `http` trong phần thuộc tính |
| 6 | Nút size không ghi giá | C: nút size hiện giá + chênh lệch (`delta()`) | e2e |
| 7 | "The Gril", ghi chú thiệp tính tiền, keo $32.98 | seed: lời chúc miễn phí, add-on giá hợp lý; D/C soát chính tả | — |
| 8 | 388 request, 65 script ngoài | D: 0 script bên thứ ba, font tự host, ảnh webp/avif, JS client chỉ ở personalizer | Lighthouse / đếm request trang PDP |
| 9 | 2 H1, meta tự sinh, 16 ảnh thiếu alt | D `seo.ts` + JSON-LD; A bắt buộc alt & meta description | e2e đếm `h1` = 1 |
| 10 | Không có dòng consent | C dòng consent + checkbox; B lưu `consent_at`, xoá ảnh khi hết hạn | upload thiếu consent → 400 |
| 11 | Designer mode thiếu ghi chú, tên bé | C form + A hàng chờ designer | — |
| 12 | Mobile: preview dính chiếm chỗ, nút nổi che nội dung | C preview thu nhỏ khi cuộn; D gom nút nổi về 1 góc | ảnh chụp 375 px |
