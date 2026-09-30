-- UI-3 (bổ sung discount codes): cờ đánh dấu mã active nào hiện trong bảng "Buy More, Save More!" trên PDP.
-- Mặc định 0 để mã riêng (gửi email, đối tác…) không tự lộ ra trang sản phẩm.
ALTER TABLE discounts ADD COLUMN show_on_pdp INTEGER NOT NULL DEFAULT 0;
