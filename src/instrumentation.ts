// WORKER_INLINE=1 → chạy worker trong process Next (dev). Production: để 0 và chạy `npm run worker`.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.WORKER_INLINE === '1') {
    const { startWorker } = await import('./worker/loop');
    startWorker('worker:inline');
  }
}
