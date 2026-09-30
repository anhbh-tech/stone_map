// Bảng của crew khác (customers, collections — UI-2) có thể chưa có trong DB: admin kiểm trước, hiện trạng thái giải thích thay vì 500.
import { db } from '../../../lib/db';

export const hasTable = (name: string) =>
  !!db().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

export const hasColumn = (table: string, column: string) =>
  (db().prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[]).some((c) => c.name === column);

/** customers + orders.customer_id theo hợp đồng ui2_001_customers.sql. */
export const customersReady = () => hasTable('customers') && hasColumn('orders', 'customer_id');
/** collections + product_collections theo hợp đồng ui2_001_customers.sql. */
export const collectionsReady = () => hasTable('collections') && hasTable('product_collections');
