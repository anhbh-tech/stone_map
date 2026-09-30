// Config Playwright riêng của crew C (PDP) cho tới khi lead thêm playwright.config.ts dùng chung.
// Chạy: npx playwright test -c tests/e2e/pdp.config.ts
// DB + storage riêng dưới thư mục tmp, cổng 3103 → không đụng DB dev hay crew khác. Worker inline + provider mock cho test dùng API thật của crew B.
import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = 3103;
const TMP = path.join(os.tmpdir(), 'pearl-e2e-pdp');
const ROOT = path.resolve(__dirname, '../..');

export default defineConfig({
  testDir: '.',
  testMatch: 'pdp.e2e.ts',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: `rm -rf "${TMP}" && mkdir -p "${TMP}" && npm run seed && npx next dev -p ${PORT}`,
    cwd: ROOT,
    url: `http://localhost:${PORT}/products/pearl-pet-portrait`,
    env: { DB_PATH: path.join(TMP, 'store.db'), STORAGE_DIR: TMP, SITE_URL: `http://localhost:${PORT}`, NEXT_TELEMETRY_DISABLED: '1', WORKER_INLINE: '1', GEMINI_API_KEY: '', OPENAI_API_KEY: '' },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
