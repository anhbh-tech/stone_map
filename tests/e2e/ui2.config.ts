import { crewConfig } from '../../playwright.config';

// UI-2 (tài khoản, tìm kiếm, collections): chỉ chạy ui2-account.e2e.ts trên server/DB của config gốc.
// Chạy: npx playwright test -c tests/e2e/ui2.config.ts
export default crewConfig('ui2-account.e2e.ts');
