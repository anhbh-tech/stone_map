// Config Playwright gốc: `npm run test:e2e` chạy e2e của mọi crew (tests/e2e/*.e2e.ts) trên một server.
// next dev cổng E2E_PORT (mặc định 3100), DB + storage seed mới trong thư mục tmp mỗi lần chạy, worker inline + provider mock.
// Các spec dùng chung một DB nên chạy tuần tự (workers: 1). Config tests/e2e/<crew>.config.ts chỉ lọc lại một spec.
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3100);
const ROOT = __dirname;
const TMP = path.join(os.tmpdir(), 'pearl-e2e');
export const BASE_URL = `http://localhost:${PORT}`;
export const E2E_DB_PATH = path.join(TMP, 'store.db');
export const E2E_STORAGE_DIR = path.join(TMP, 'storage');
process.env.E2E_D_DB = E2E_DB_PATH; // d.e2e.ts đọc DB qua biến này

const config = defineConfig({
  testDir: path.join(ROOT, 'tests', 'e2e'),
  testMatch: '**/*.e2e.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  // Tên project khớp với test.skip trong pdp.e2e.ts ('desktop' / 'mobile-375').
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-375',
      testMatch: '**/pdp.e2e.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    command: `rm -rf "${TMP}" && mkdir -p "${TMP}" && npx tsx scripts/seed.ts && npx next dev -p ${PORT}`,
    cwd: ROOT,
    url: `${BASE_URL}/api/cart`,
    env: {
      DB_PATH: E2E_DB_PATH,
      STORAGE_DIR: E2E_STORAGE_DIR,
      SITE_URL: BASE_URL,
      WORKER_INLINE: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      GEMINI_API_KEY: '',
      OPENAI_API_KEY: '',
    },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

export default config;

// Entry point riêng của một crew: chỉ chạy spec đó, cùng server/DB như lần chạy gốc.
export function crewConfig(spec: string) {
  return defineConfig({
    ...config,
    testMatch: `**/${spec}`,
    projects: config.projects!.filter((p) => !p.testMatch || p.testMatch === `**/${spec}`),
  });
}
