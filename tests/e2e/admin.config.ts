// Crew A (admin + auth) — config Playwright riêng cho tới khi lead thêm playwright.config.ts dùng chung.
// Chạy: npx playwright test -c tests/e2e/admin.config.ts
// Server riêng port 3101, DB + storage seed mới trong thư mục tmp mỗi lần chạy (không đụng storage/ của dev).
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3101;
const TMP = path.join(os.tmpdir(), 'pearl-e2e-crew-a');
export const E2E_DB_PATH = path.join(TMP, 'store.db');
export const E2E_STORAGE_DIR = path.join(TMP, 'storage');

export default defineConfig({
  testDir: '.',
  testMatch: 'admin.e2e.ts',
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `rm -rf "${TMP}" && mkdir -p "${TMP}" && npx tsx scripts/seed.ts && npx next dev -p ${PORT}`,
    cwd: path.resolve(__dirname, '../..'),
    env: { DB_PATH: E2E_DB_PATH, STORAGE_DIR: E2E_STORAGE_DIR, NODE_ENV: 'development' },
    url: `http://localhost:${PORT}/admin/login`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
