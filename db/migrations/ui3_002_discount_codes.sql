-- Mã giảm giá lúc checkout (follow-on UI-3, captain duyệt). Bảng discounts đã có ở ui3_001_admin.sql.
-- carts.discount_code: mã khách đã nhập, lưu theo giỏ để giữ qua cart → checkout; số tiền luôn tính lại ở server.
ALTER TABLE carts ADD COLUMN discount_code TEXT;
-- orders.code_discount_cents: phần giảm do mã, tách khỏi orders.discount_cents (giảm theo bậc số lượng)
-- để đơn, email và admin hiện đúng từng dòng; total_cents đã trừ cả hai.
ALTER TABLE orders ADD COLUMN code_discount_cents INTEGER NOT NULL DEFAULT 0;
