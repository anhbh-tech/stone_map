-- Review của khách (#4 social proof). Số sao / số review hiển thị đều tính từ bảng này, không gõ tay.
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,  -- có = "Verified buyer"
  author      TEXT NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title       TEXT,
  body        TEXT NOT NULL,
  photo_url   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','hidden')),
  is_sample   INTEGER NOT NULL DEFAULT 0,  -- 1 = dữ liệu seed cho dev; hiện nhãn "Sample", bị loại khi NODE_ENV=production
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS reviews_product ON reviews(product_id, status);
