// UI-3 seed: mã "Buy More, Save More!" theo số lượng, hiện trên PDP (show_on_pdp = 1). Tên mã do Pearl Atelier đặt.
// Gọi từ scripts/seed.ts trong cùng transaction. Chạy lại được: upsert theo code, không đụng mã admin tự tạo.
import type { DatabaseSync } from 'node:sqlite';

export const TIER_CODES = [
  { code: 'PEARL2', min_qty: 2, percent: 15 },
  { code: 'PEARL3', min_qty: 3, percent: 20 },
  { code: 'PEARL5', min_qty: 5, percent: 25 },
];

export function seedDiscounts(d: DatabaseSync) {
  const up = d.prepare(`INSERT INTO discounts (code, kind, value, min_qty, active, show_on_pdp) VALUES (?, 'percent', ?, ?, 1, 1)
    ON CONFLICT(code) DO UPDATE SET kind = 'percent', value = excluded.value, min_qty = excluded.min_qty, show_on_pdp = 1`);
  for (const t of TIER_CODES) up.run(t.code, t.percent, t.min_qty);
}
