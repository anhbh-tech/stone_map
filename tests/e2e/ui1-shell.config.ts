// Crew UI-1 (design system, store shell, PDP, gallery): chạy các spec ui1-*.e2e.ts trên server/DB của config gốc.
// Chạy: npx playwright test -c tests/e2e/ui1-shell.config.ts
import { crewConfig } from '../../playwright.config';

export default crewConfig('ui1-*.e2e.ts');
