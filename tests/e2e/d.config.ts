// Crew D (store shell, giỏ, checkout, SEO): chỉ chạy d.e2e.ts trên server/DB của config gốc (playwright.config.ts).
// Chạy: npx playwright test -c tests/e2e/d.config.ts
import { crewConfig } from '../../playwright.config';

export default crewConfig('d.e2e.ts');
