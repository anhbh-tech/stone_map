// Regression H-01: chỉ chạy personalizer-theme-style.e2e.ts trên server/DB của config gốc (playwright.config.ts).
// Chạy: npx playwright test -c tests/e2e/personalizer-theme-style.config.ts
import { crewConfig } from '../../playwright.config';

export default crewConfig('personalizer-theme-style.e2e.ts');
