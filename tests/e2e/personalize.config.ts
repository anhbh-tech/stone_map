// Config Playwright riêng của crew B (tạm thời, tới khi lead thêm playwright.config.ts chung).
// Chạy: npx playwright test -c tests/e2e/personalize.config.ts
// Server riêng: next dev cổng 3102, DB + storage trong thư mục tạm (seed lại mỗi lần), worker chạy inline.
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 3102;
export const E2E_DIR = path.join(os.tmpdir(), 'pearl-store-e2e-b');
export const E2E_DB = path.join(E2E_DIR, 'store.db');

export default defineConfig({
  testDir: '.',
  testMatch: 'personalize.e2e.ts',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `rm -rf "${E2E_DIR}" && npm run seed && npx next dev -p ${PORT}`,
    cwd: path.join(__dirname, '..', '..'),
    url: `http://localhost:${PORT}/favicon.ico`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DB_PATH: E2E_DB,
      STORAGE_DIR: path.join(E2E_DIR, 'storage'),
      WORKER_INLINE: '1',
      SITE_URL: `http://localhost:${PORT}`,
      GEMINI_API_KEY: '',
      OPENAI_API_KEY: '',
    },
  },
});
