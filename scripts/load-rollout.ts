// npm run load:rollout [-- --dir <folder>] — nạp ảnh theme từ <folder>/<theme>/manifest.json vào DB hiện tại (không seed lại).
// Mặc định ROLLOUT_DIR hoặc ~/pearl_compare/outputs/rollout. Thư mục nguồn chỉ được đọc.
// Chỉ nạp final pass=true (+ template trống, cutout); final pass=false được liệt kê là để trống. Chạy lại được bất cứ lúc nào.
import path from 'node:path';
import { db } from '../src/lib/db';
import { formatLoad, loadRollout, ROLLOUT_DIR } from './seed-themes';

const args = process.argv.slice(2);
const i = args.findIndex((a) => a === '--dir' || a.startsWith('--dir='));
const dir = i < 0 ? ROLLOUT_DIR : path.resolve(args[i].includes('=') ? args[i].slice(6) : args[i + 1] ?? '');

loadRollout(db(), { src: dir }).then((r) => {
  console.log(`source: ${dir}\n${formatLoad(r)}`);
  if (r.some((x) => x.status === 'incomplete')) process.exitCode = 1;
});
