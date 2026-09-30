-- Pearl Atelier — schema SQLite (node:sqlite). Một file, chạy lại được (IF NOT EXISTS).
-- Chủ sở hữu: lead. Crewmate cần thêm cột/bảng → thêm migration mới ở db/migrations/NNN_*.sql, không sửa bảng của module khác.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Nguồn sự thật duy nhất cho mọi câu chữ chính sách (sửa #3): phí ship, khung có kèm không, số liệu quảng cáo…
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- JSON
);

-- ── Commerce core (vai trò của Shopify)
CREATE TABLE IF NOT EXISTS products (
  id               INTEGER PRIMARY KEY,
  handle           TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,          -- ngắn, không nhồi từ khoá (#9)
  subtitle         TEXT,
  description_html TEXT NOT NULL DEFAULT '',
  meta_title       TEXT,
  meta_description TEXT,                   -- viết tay; null → sinh từ subtitle, không bao giờ "Product Description…" (#9)
  frame_included   INTEGER NOT NULL DEFAULT 0, -- 1 = sản phẩm đã kèm khung → add-on khung bị ẩn (#3)
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  alt        TEXT NOT NULL CHECK (length(alt) > 0),   -- alt bắt buộc (#9)
  kind       TEXT NOT NULL DEFAULT 'gallery' CHECK (kind IN ('gallery','mockup_scene')),
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS variants (
  id              INTEGER PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL UNIQUE,
  size            TEXT NOT NULL,           -- "12×12"
  price_cents     INTEGER NOT NULL CHECK (price_cents > 0),
  compare_at_cents INTEGER,
  print_px        INTEGER NOT NULL DEFAULT 2000,  -- cạnh file in vuông
  position        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS addons (
  id           INTEGER PRIMARY KEY,
  handle       TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  description  TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('frame','card','protection','priority','care')),
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  text_input   INTEGER NOT NULL DEFAULT 0, -- 1 = có ô nhập (lời chúc thiệp)
  text_free    INTEGER NOT NULL DEFAULT 1, -- lời chúc miễn phí (#7)
  active       INTEGER NOT NULL DEFAULT 1,
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bundle_tiers (
  id          INTEGER PRIMARY KEY,
  min_qty     INTEGER NOT NULL UNIQUE,
  percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 0 AND 90)
);

-- ── Personalization app (vai trò Customall). Chỉ module personalize ghi vào các bảng này.
CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,            -- up_xxx
  path        TEXT NOT NULL,               -- storage/uploads/…
  mime        TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  sha         TEXT NOT NULL,
  preflight   TEXT NOT NULL,               -- JSON Preflight (xem src/lib/types.ts) (#1)
  consent_at  TEXT NOT NULL,               -- khách đã tick đồng ý xử lý ảnh (#10)
  expires_at  TEXT NOT NULL,               -- xoá sau settings.privacy.retention_days (#10)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS designs (
  id            TEXT PRIMARY KEY,          -- DSN-XXXXXX, in lên đơn
  product_id    INTEGER NOT NULL REFERENCES products(id),
  variant_id    INTEGER REFERENCES variants(id),
  upload_id     TEXT REFERENCES uploads(id),
  mode          TEXT NOT NULL CHECK (mode IN ('ai','designer')),
  style         TEXT,                      -- theme id (royal-starry…)
  pet_name      TEXT,                      -- (#11)
  notes         TEXT,                      -- "bỏ dây xích" (#11)
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','generating','ready','failed','confirmed','in_review','approved','rejected')),
  transform     TEXT,                      -- JSON {rotate, zoom, x, y} từ trình preview
  preview_path  TEXT,                      -- ảnh AI (web)
  print_path    TEXT,                      -- PNG in 2000×2000 (hoặc variants.print_px)
  mockup_path   TEXT,                      -- ảnh treo tường
  confirmed_at  TEXT,                      -- khách tick "Đây đúng là bé nhà tôi" (#1)
  email         TEXT,                      -- để gửi link preview khi rời trang (#2)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,           -- job_xxx
  design_id    TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'ai_generate',
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','canceled')),
  stage        TEXT,                       -- 'queued'|'analyzing'|'generating'|'checking'|'rendering'
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  check_result TEXT,                       -- JSON kết quả kiểm tra ảnh ra
  queued_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, queued_at);

-- ── Cart / checkout (giả lập thanh toán)
CREATE TABLE IF NOT EXISTS carts (
  id         TEXT PRIMARY KEY,             -- cookie cart_id
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cart_lines (
  id          INTEGER PRIMARY KEY,
  cart_id     TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id  INTEGER NOT NULL REFERENCES variants(id),
  design_id   TEXT REFERENCES designs(id),
  qty         INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  properties  TEXT NOT NULL DEFAULT '{}'   -- JSON; key bắt đầu "_" là ẩn với khách (#5)
);
CREATE TABLE IF NOT EXISTS cart_addons (
  cart_id  TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  addon_id INTEGER NOT NULL REFERENCES addons(id),
  text     TEXT,
  PRIMARY KEY (cart_id, addon_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,     -- #1001
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  address        TEXT NOT NULL,            -- JSON
  shipping_method TEXT NOT NULL CHECK (shipping_method IN ('standard','express')),
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  addons_cents   INTEGER NOT NULL DEFAULT 0,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','in_production','shipped','delivered','refunded','canceled')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_lines (
  id             INTEGER PRIMARY KEY,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_title  TEXT NOT NULL,
  variant_size   TEXT NOT NULL,
  sku            TEXT NOT NULL,
  qty            INTEGER NOT NULL,
  unit_cents     INTEGER NOT NULL,
  design_id      TEXT REFERENCES designs(id),
  properties     TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS order_addons (
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  text        TEXT
);

-- ── Hạ tầng dùng chung
CREATE TABLE IF NOT EXISTS email_outbox (          -- mailer giả lập: xem ở /admin/emails (#2)
  id         INTEGER PRIMARY KEY,
  to_addr    TEXT NOT NULL,
  kind       TEXT NOT NULL,                        -- 'preview_ready'|'order_confirmation'|'design_review'
  subject    TEXT NOT NULL,
  html       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (                -- "web pixel" first-party: 1 endpoint thay 65 script (#8)
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,                        -- page_viewed, product_viewed, design_generated, add_to_cart, checkout_completed
  session_id TEXT,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL                      -- scrypt: salt:hash (hex)
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
