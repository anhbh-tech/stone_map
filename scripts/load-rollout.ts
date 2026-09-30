// npm run load:rollout — nạp ảnh theme từ pearl_compare outputs/rollout/<theme>/manifest.json vào DB hiện tại
// (không seed lại). ROLLOUT_DIR đổi thư mục nguồn. Theme chưa có manifest / chưa đủ ảnh: giữ nguyên và in lý do.
import { db } from '../src/lib/db';
import { formatLoad, loadRollout, ROLLOUT_DIR } from './seed-themes';

loadRollout(db()).then((r) => {
  console.log(`source: ${ROLLOUT_DIR}\n${formatLoad(r)}`);
  if (r.some((x) => x.status === 'incomplete')) process.exitCode = 1;
});
