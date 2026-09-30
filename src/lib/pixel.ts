// "Web pixel" first-party (#8): mọi tracking đi qua 1 endpoint /api/events, không script bên thứ ba.
// Trình duyệt: track() xếp hàng, gửi sau khi trình duyệt rảnh (requestIdleCallback) bằng sendBeacon, và xả nốt khi rời trang.
// Server: parseEvent() kiểm body của /api/events. File này không import gì phía server để dùng được ở client component.

export type PixelEvent = { name: string; payload: Record<string, unknown> };

export const EVENT_ENDPOINT = '/api/events';
export const MAX_BODY = 8192;
const MAX_PAYLOAD = 4096;
const NAME = /^[a-z][a-z0-9_]{1,39}$/;

/** Body JSON `{ name, payload }` → event hợp lệ, hoặc null. Beacon gửi text/plain nên nhận chuỗi thô. */
export function parseEvent(text: string): PixelEvent | null {
  if (!text || text.length > MAX_BODY) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { name, payload = {} } = v as { name?: unknown; payload?: unknown };
  if (typeof name !== 'string' || !NAME.test(name)) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (JSON.stringify(payload).length > MAX_PAYLOAD) return null;
  return { name, payload: payload as Record<string, unknown> };
}

const queue: PixelEvent[] = [];
let scheduled = false;
let hooked = false;

function send(ev: PixelEvent) {
  const body = JSON.stringify(ev);
  // text/plain là kiểu CORS-safelisted duy nhất sendBeacon chấp nhận ổn định trên mọi trình duyệt.
  if (navigator.sendBeacon?.(EVENT_ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
  fetch(EVENT_ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(() => {});
}

export function flush() {
  scheduled = false;
  while (queue.length) send(queue.shift()!);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  if ('requestIdleCallback' in window) window.requestIdleCallback(flush, { timeout: 4000 });
  else setTimeout(flush, 2000);
  if (!hooked) {
    hooked = true;
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }
}

/** Ghi 1 event. Không chặn render, không bao giờ ném lỗi. Không đưa PII (email, địa chỉ) vào payload. */
export function track(name: string, payload: Record<string, unknown> = {}) {
  if (typeof window === 'undefined' || !NAME.test(name)) return;
  queue.push({ name, payload });
  schedule();
}
