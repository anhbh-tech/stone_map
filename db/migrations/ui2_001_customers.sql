-- UI-2: tài khoản khách, bộ sưu tập (collections), tìm kiếm FTS5.
-- Hình dạng customers / customer_sessions / customer_addresses / collections / product_collections là hợp đồng chung
-- với crew UI-3 (admin đọc/ghi đúng các cột này) — đổi cột phải qua firstmate.

-- ── Khách hàng. Mật khẩu: scrypt "salt:hash" qua src/lib/password.ts. Phiên: DB chỉ giữ sha256 của token (như admin).
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customer_sessions (
  token       TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_addresses (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,            -- JSON, cùng dạng orders.address
  is_default  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS customer_addresses_customer ON customer_addresses(customer_id);

-- Đơn đặt khi đã đăng nhập mang customer_id. Đơn khách vãng lai không tự gắn theo email
-- (không xác minh email → ai đăng ký bằng email người khác sẽ thấy đơn của họ); tra bằng /track-order.
ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id, created_at);

-- ── Collections (danh mục / bộ sưu tập)
CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY,
  handle      TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  image       TEXT,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_collections (
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, collection_id)
);
CREATE INDEX IF NOT EXISTS product_collections_collection ON product_collections(collection_id, position);

-- Nhãn sản phẩm cho lọc + tìm kiếm: "theme:christmas", "type:diy-kit", "demo" (sản phẩm demo, hiện nhãn Demo), từ tự do ("cat").
CREATE TABLE IF NOT EXISTS product_tags (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  PRIMARY KEY (product_id, tag)
);
CREATE INDEX IF NOT EXISTS product_tags_tag ON product_tags(tag);

-- ── Tìm kiếm: FTS5, rowid = products.id. Trigger giữ chỉ mục khớp với products / tags / collections,
-- nên admin sửa sản phẩm không cần biết tới bảng này. Lọc status = 'active' làm lúc truy vấn.
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
  title, description, tags, category,
  tokenize = 'porter unicode61 remove_diacritics 2',
  prefix = '2 3'
);

CREATE VIEW IF NOT EXISTS products_fts_source AS
SELECT
  p.id,
  p.title,
  COALESCE(p.subtitle, '') || ' ' ||
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(p.description_html,
      '<p>', ' '), '</p>', ' '), '<ul>', ' '), '</ul>', ' '), '<li>', ' '), '</li>', ' '), '<br>', ' '),
      '<strong>', ' '), '</strong>', ' '), '&amp;', '&') AS description,
  COALESCE((SELECT group_concat(replace(replace(t.tag, 'theme:', ''), 'type:', ''), ' ') FROM product_tags t WHERE t.product_id = p.id), '') AS tags,
  COALESCE((SELECT group_concat(c.title, ' ') FROM product_collections pc JOIN collections c ON c.id = pc.collection_id WHERE pc.product_id = p.id), '') AS category
FROM products p;

CREATE TRIGGER IF NOT EXISTS products_fts_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts (rowid, title, description, tags, category) SELECT id, title, description, tags, category FROM products_fts_source WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS products_fts_au AFTER UPDATE OF title, subtitle, description_html ON products BEGIN
  DELETE FROM products_fts WHERE rowid = NEW.id;
  INSERT INTO products_fts (rowid, title, description, tags, category) SELECT id, title, description, tags, category FROM products_fts_source WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS products_fts_ad AFTER DELETE ON products BEGIN
  DELETE FROM products_fts WHERE rowid = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS product_tags_fts_ai AFTER INSERT ON product_tags BEGIN
  DELETE FROM products_fts WHERE rowid = NEW.product_id;
  INSERT INTO products_fts (rowid, title, description, tags, category) SELECT id, title, description, tags, category FROM products_fts_source WHERE id = NEW.product_id;
END;
CREATE TRIGGER IF NOT EXISTS product_tags_fts_ad AFTER DELETE ON product_tags BEGIN
  DELETE FROM products_fts WHERE rowid = OLD.product_id;
  INSERT INTO products_fts (rowid, title, description, tags, category) SELECT id, title, description, tags, category FROM products_fts_source WHERE id = OLD.product_id;
END;
CREATE TRIGGER IF NOT EXISTS product_collections_fts_ai AFTER INSERT ON product_collections BEGIN
  DELETE FROM products_fts WHERE rowid = NEW.product_id;
  INSERT INTO products_fts (rowid, title, description, tags, category) SELECT id, title, description, tags, category FROM products_fts_source WHERE id = NEW.product_id;
END;
CREATE TRIGGER IF NOT EXISTS product_collections_fts_ad AFTER DELETE ON product_collections BEGIN
  DELETE FROM products_fts WHERE rowid = OLD.product_id;
  INSERT INTO products_fts (rowid, title, description, tags, category) SELECT id, title, description, tags, category FROM products_fts_source WHERE id = OLD.product_id;
END;
CREATE TRIGGER IF NOT EXISTS collections_fts_au AFTER UPDATE OF title ON collections BEGIN
  DELETE FROM products_fts WHERE rowid IN (SELECT product_id FROM product_collections WHERE collection_id = NEW.id);
  INSERT INTO products_fts (rowid, title, description, tags, category)
    SELECT id, title, description, tags, category FROM products_fts_source WHERE id IN (SELECT product_id FROM product_collections WHERE collection_id = NEW.id);
END;

INSERT INTO products_fts (rowid, title, description, tags, category) SELECT id, title, description, tags, category FROM products_fts_source;
