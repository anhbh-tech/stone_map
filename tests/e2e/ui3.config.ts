// Crew UI-3 (back office): chỉ chạy ui3-admin.e2e.ts trên server/DB của config gốc (playwright.config.ts).
// Chạy: npx playwright test -c tests/e2e/ui3.config.ts
import { crewConfig } from '../../playwright.config';
export { E2E_DB_PATH, E2E_STORAGE_DIR } from '../../playwright.config';

export default crewConfig('ui3-admin.e2e.ts');
