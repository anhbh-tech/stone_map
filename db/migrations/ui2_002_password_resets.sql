-- UI-2: quên mật khẩu. Link một lần, hết hạn sau 1 giờ; DB chỉ giữ sha256 của token (như customer_sessions).
-- Gửi qua mailer giả lập (email_outbox, kind 'password_reset'), admin xem ở /admin/emails.
CREATE TABLE IF NOT EXISTS customer_password_resets (
  token       TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS customer_password_resets_customer ON customer_password_resets(customer_id, created_at);
