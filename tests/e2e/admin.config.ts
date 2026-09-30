// Crew A (admin + auth): chỉ chạy admin.e2e.ts trên server/DB của config gốc (playwright.config.ts).
// Chạy: npx playwright test -c tests/e2e/admin.config.ts
import { crewConfig } from '../../playwright.config';
export { E2E_DB_PATH, E2E_STORAGE_DIR } from '../../playwright.config';

export default crewConfig('admin.e2e.ts');
