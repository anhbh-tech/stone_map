// Crew B (personalize): chỉ chạy personalize.e2e.ts trên server/DB của config gốc (playwright.config.ts).
// Chạy: npx playwright test -c tests/e2e/personalize.config.ts
import { crewConfig, E2E_DB_PATH } from '../../playwright.config';
export const E2E_DB = E2E_DB_PATH;

export default crewConfig('personalize.e2e.ts');
