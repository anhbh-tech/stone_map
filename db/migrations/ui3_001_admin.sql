-- Crew UI-3 (admin back office). Không đụng bảng customers/collections của UI-2 (ui2_001_customers.sql).
-- Trạng thái thanh toán / giao hàng KHÔNG thêm cột: suy ra từ orders.status (một nguồn sự thật) — xem src/app/admin/_lib/order-status.ts.

-- Timeline đơn: đổi trạng thái, giao hàng, ghi chú nội bộ của nhân viên.
CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('status','fulfillment','comment')),
  message    TEXT NOT NULL,
  author     TEXT,                                   -- admin_users.username; null = hệ thống
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS order_events_order ON order_events(order_id, created_at);

-- Mỗi lần "Mark as fulfilled": hãng vận chuyển + mã vận đơn (tuỳ chọn).
CREATE TABLE IF NOT EXISTS fulfillments (
  id              INTEGER PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier         TEXT,
  tracking_number TEXT,
  tracking_url    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS fulfillments_order ON fulfillments(order_id);

-- Mã giảm giá. value: phần trăm (percent) hoặc cent (fixed); free_shipping bỏ qua value.
CREATE TABLE IF NOT EXISTS discounts (
  id                 INTEGER PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind               TEXT NOT NULL CHECK (kind IN ('percent','fixed','free_shipping')),
  value              INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  min_subtotal_cents INTEGER CHECK (min_subtotal_cents IS NULL OR min_subtotal_cents > 0),
  min_qty            INTEGER CHECK (min_qty IS NULL OR min_qty > 0),
  starts_at          TEXT,                            -- UTC 'YYYY-MM-DD HH:MM:SS'; null = ngay
  ends_at            TEXT,                            -- null = không hết hạn
  usage_limit        INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (kind <> 'percent' OR value BETWEEN 1 AND 100)
);
-- Mã đã dùng trên đơn (checkout ghi khi áp mã) → số lần dùng tính từ đây, không lưu bộ đếm riêng.
ALTER TABLE orders ADD COLUMN discount_code TEXT;

-- Hàng chờ design: giao cho một nhân viên (designer).
ALTER TABLE admin_users ADD COLUMN display_name TEXT;
ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','designer'));
ALTER TABLE designs ADD COLUMN assignee_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;

-- Số liệu Home: lọc theo thời gian.
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS events_name_created ON events(name, created_at);
