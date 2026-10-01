// Editor theo lớp trên PDP (personalizer): chạy riêng pdp-editor.e2e.ts trên server/DB của config gốc.
// Chạy: npx playwright test -c tests/e2e/pdp-editor.config.ts   (EDITOR_SHOTS=<thư mục> để lưu screenshot)
import { crewConfig } from '../../playwright.config';

export default crewConfig('pdp-editor.e2e.ts');
