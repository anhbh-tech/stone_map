-- PDP InfoTabs (Description / Shopping Tips / Shipping & Returns): phần ghi đè theo sản phẩm.
-- JSON Partial<InfoContent> (src/lib/info-tabs.ts); NULL hoặc thiếu field = dùng mặc định toàn store ở settings key 'pdp_info'.
ALTER TABLE products ADD COLUMN info_tabs TEXT;
