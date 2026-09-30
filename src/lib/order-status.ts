// Nhãn trạng thái đơn / design cho khách (UI-2). Không import db → dùng được cả trong client component.
import type { DesignStatus } from './types';

export type OrderStatus = 'paid' | 'in_production' | 'shipped' | 'delivered' | 'refunded' | 'canceled';
export const ORDER_STEPS: { id: OrderStatus; label: string }[] = [
  { id: 'paid', label: 'Order placed' }, { id: 'in_production', label: 'Making your portrait' },
  { id: 'shipped', label: 'Shipped' }, { id: 'delivered', label: 'Delivered' },
];
export const orderStatusLabel = (s: OrderStatus) =>
  s === 'refunded' ? 'Refunded' : s === 'canceled' ? 'Canceled' : ORDER_STEPS.find((x) => x.id === s)?.label ?? s;

export type DesignTone = 'ok' | 'wait' | 'action';
/** Trạng thái design như khách hiểu: đã duyệt preview chưa, designer đang làm hay cần ảnh khác. */
export function designStatusView(s: DesignStatus | null): { label: string; detail: string; tone: DesignTone } | null {
  switch (s) {
    case null: return null;
    case 'confirmed': return { label: 'Preview approved', detail: 'You approved the preview. It goes to print as shown.', tone: 'ok' };
    case 'approved': return { label: 'Artwork approved', detail: 'Our designer finished your portrait and it is ready to print.', tone: 'ok' };
    case 'in_review': return { label: 'With our designer', detail: 'A designer is finishing your portrait by hand. We email you when it is ready.', tone: 'wait' };
    case 'rejected': return { label: 'New photo needed', detail: 'Your photo could not be used. Check your email for how to send another.', tone: 'action' };
    case 'failed': return { label: 'Needs attention', detail: 'The preview could not be made. Our team will contact you.', tone: 'action' };
    default: return { label: 'Preview in progress', detail: 'Your preview is still being prepared.', tone: 'wait' };
  }
}
