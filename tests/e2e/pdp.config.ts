// Crew C (PDP): chỉ chạy pdp.e2e.ts trên server/DB của config gốc (playwright.config.ts).
// Chạy: npx playwright test -c tests/e2e/pdp.config.ts
import { crewConfig } from '../../playwright.config';

export default crewConfig('pdp.e2e.ts');
