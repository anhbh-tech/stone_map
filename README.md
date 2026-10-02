# Pearl Store

Cửa hàng tự host, kiểu Shopify, bán tranh ngọc trai personalized theo ảnh pet (tên tạm "Pearl Atelier").

Luồng mua của khách:
1. Chọn theme.
2. Tải ảnh pet lên.
3. Xem preview AI: con pet của chính khách được dựng lại bằng ngọc trai, kèm ảnh khung treo trong phòng.
4. Chọn cỡ và add-on.
5. Thanh toán.

Ca khó thì admin duyệt hoặc chuyển cho designer.

Chi tiết sản phẩm: [`PRODUCT.md`](PRODUCT.md). Kiến trúc: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Thiết kế UI: [`DESIGN.md`](DESIGN.md).

## Công nghệ

- Next.js 16 (App Router), React 19, Tailwind v4.
- Database `node:sqlite`, không dùng ORM. Schema ở `db/schema.sql` và `db/migrations/`.
- Tiền lưu bằng số nguyên cent.
- Worker sinh preview chạy bất đồng bộ (`src/worker/`).
- Test: Vitest cho unit, Playwright cho e2e.

## Chạy local

Cần Node ≥ 22.5. Thiếu `node:sqlite` thì app không chạy được.

```bash
npm install
cp .env.example .env.local      # tùy chọn; mặc định chạy offline hoàn toàn
npm run seed                    # tạo dữ liệu mẫu: sản phẩm, theme, collection
npm run dev                     # http://localhost:3000
```

| Mặc định offline | Ghi chú |
|---|---|
| Provider AI | mock. Muốn gen thật thì vào `/admin/settings` đổi provider, rồi điền `GEMINI_API_KEY` / `OPENAI_API_KEY` trong `.env.local` |
| Email | ghi vào outbox, không gửi thật |
| Thanh toán | giả lập, không thu thông tin thẻ |
| Worker | chạy chung process khi `WORKER_INLINE=1`. Production đặt `WORKER_INLINE=0` và chạy `npm run worker` |
| Admin | `/admin`, đăng nhập `admin` / `admin123`. **Đổi mật khẩu trước khi deploy** |

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` / `build` / `start` | Chạy dev, build, chạy production |
| `npm run seed` | Seed catalogue mẫu (`scripts/seed*.ts`) |
| `npm run load:rollout` | Nạp ảnh preview đã gen từ pipeline `pearl_compare` |
| `npm run worker` | Worker sinh preview, chạy tách riêng |
| `npm test` · `npm run test:e2e` · `npm run typecheck` · `npm run lint` | Kiểm tra |

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/app/(store)/` | Storefront: trang chủ, collection, search, trang sản phẩm, giỏ, checkout, tài khoản, tra cứu đơn |
| `src/app/admin/` | Admin: dashboard, đơn hàng, hàng chờ thiết kế, sản phẩm/variant/add-on, review, email, cài đặt, số liệu |
| `src/app/api/` | API: cart, checkout, personalize, search, account, admin, events |
| `src/lib/` | Logic dùng chung: DB, giá, personalizer, provider AI |
| `src/worker/` | Hàng đợi sinh preview |
| `db/` | Schema và migration SQLite |
| `scripts/` | Seed dữ liệu |
| `public/demo/` | Ảnh demo |
| `tests/` | Test e2e Playwright |

Dữ liệu chạy (`/storage`), `.env*` và `test-results/` không nằm trong git.

## Ghi chú

- Review mẫu được gắn nhãn là mẫu và bị loại ở production. **Không bịa review hay rating.**
- Ảnh preview lấy từ pipeline `pearl_compare`: pearl art → ảnh khung trong phòng → ảnh final ghép.
- Bản đồ đá cho xưởng được làm ở nhánh `features/initial_approach` của repo này (Stone Map).
