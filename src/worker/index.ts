// npm run worker — worker chạy riêng (production: WORKER_INLINE=0 cho Next, chạy lệnh này bên cạnh).
import './env';
import { startWorker } from './loop';

const w = startWorker('worker');
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => { void w.stop().then(() => process.exit(0)); });
}
