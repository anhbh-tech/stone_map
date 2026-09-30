// Mã giảm giá lúc checkout (follow-on UI-3): chỉ chạy ui3-discounts.e2e.ts trên server/DB của config gốc.
// Chạy: npx playwright test -c tests/e2e/ui3-discounts.config.ts
import { crewConfig } from '../../playwright.config';

export default crewConfig('ui3-discounts.e2e.ts');
