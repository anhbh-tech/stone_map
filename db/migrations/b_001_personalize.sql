-- Crew B (personalize). Cột bổ sung cho uploads/designs/jobs.
-- uploads.purged_at: ảnh gốc đã bị xoá khỏi storage/ khi hết hạn lưu (#10); dòng giữ lại vì designs/đơn tham chiếu.
ALTER TABLE uploads ADD COLUMN purged_at TEXT;
-- designs.source_path: ảnh AI gốc độ phân giải đầy đủ (storage/generated/…), nguồn để render file in theo transform.
ALTER TABLE designs ADD COLUMN source_path TEXT;
CREATE INDEX IF NOT EXISTS uploads_expires ON uploads(expires_at) WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS jobs_design ON jobs(design_id, queued_at);
CREATE INDEX IF NOT EXISTS jobs_history ON jobs(kind, provider, status, finished_at);
