// Crew D (store shell, giỏ, checkout, SEO, hiệu năng) — config Playwright riêng cho tới khi lead thêm config gốc.
// Chạy: npx playwright test -c tests/e2e/d.config.ts
// DB + storage riêng dưới thư mục tmp, seed lại mỗi lần chạy; next dev ở cổng 3104 (A 3101, B 3102, C 3103, D 3104).
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3104;
const DIR = path.join(os.tmpdir(), 'pearl-e2e-d');
process.env.E2E_D_DB = path.join(DIR, 'store.db'); // spec đọc biến này để chèn design mẫu + kiểm DB
const env = { DB_PATH: process.env.E2E_D_DB, STORAGE_DIR: path.join(DIR, 'storage'), SITE_URL: `http://localhost:${PORT}`, WORKER_INLINE: '0' };

export default defineConfig({
  testDir: '.',
  testMatch: 'd.e2e.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  webServer: {
    command: `rm -rf '${DIR}' && npx tsx scripts/seed.ts && npx next dev -p ${PORT}`,
    cwd: path.join(__dirname, '..', '..'),
    url: `http://localhost:${PORT}/api/cart`,
    env,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
