// Đọc settings (bảng settings, mỗi key 1 JSON). Mặc định ở DEFAULTS; seed ghi DEFAULTS vào DB, admin sửa ở /admin/settings.
import { db, json } from './db';
import type { Settings } from './types';

export const DEFAULTS: Settings = {
  shop: { name: 'Pearl Atelier', support_email: 'care@pearlatelier.test', currency: 'USD' },
  shipping: {
    regions: ['US'],
    free_over_cents: 7999,
    standard: { price_cents: 699, min_days: 5, max_days: 8 },
    express: { price_cents: 1999, min_days: 2, max_days: 4 },
    production_days: 3,
  },
  claims: { customers_count: null, rating: null, reviews_count: null },
  privacy: { retention_days: 30, processors: ['Google Gemini (AI generation)'], policy_path: '/policies/privacy' },
  ai: {
    provider: 'mock',
    model: 'mock-pearl',
    mock_ms: 12000,
    styles: [
      { id: 'royal-starry', name: 'Starry King' },
      { id: 'sunflower-queen', name: 'Sunflower Queen' },
      { id: 'cafe-duke', name: 'Café Terrace Duke' },
      { id: 'christmas-bg', name: 'Christmas' },
      { id: 'ocean', name: 'Luxury Ocean' },
    ],
  },
  preflight: { min_side_px: 800, min_sharpness: 60, min_pet_confidence: 0.6 },
};

export function getSettings(): Settings {
  const rows = db().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out = structuredClone(DEFAULTS) as Record<string, unknown>;
  for (const r of rows) if (r.key in out) out[r.key] = { ...(out[r.key] as object), ...json(r.value, {}) };
  return out as Settings;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

/** Câu banner ship sinh từ settings — banner, PDP, cart, trang policy dùng chung hàm này (#3). */
export function shippingHeadline(s: Settings) {
  const where = s.shipping.regions.length === 1 && s.shipping.regions[0] === 'US' ? 'US' : s.shipping.regions.join(', ');
  return s.shipping.free_over_cents != null
    ? `Free ${where} shipping on orders over $${(s.shipping.free_over_cents / 100).toFixed(2)}`
    : `Shipping to ${where}`;
}

/** Ngày giao dự kiến (#: hiện Standard/Express trên PDP). */
export function deliveryWindow(s: Settings, method: 'standard' | 'express', from = new Date()) {
  const m = s.shipping[method];
  const add = (d: number) => { const x = new Date(from); x.setDate(x.getDate() + s.shipping.production_days + d); return x; };
  return { from: add(m.min_days), to: add(m.max_days) };
}
