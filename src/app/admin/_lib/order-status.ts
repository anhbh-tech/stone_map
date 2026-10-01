// Trạng thái thanh toán / giao hàng kiểu Shopify, suy ra từ orders.status (một cột, một nguồn sự thật).
// Checkout giả lập luôn thu tiền → mọi đơn là "paid" trừ khi đã hoàn tiền (refunded) hoặc huỷ (voided).
export const PAYMENT = ['paid', 'refunded', 'voided'] as const;
export const FULFILLMENT = ['unfulfilled', 'in_production', 'fulfilled'] as const;
export type PaymentStatus = (typeof PAYMENT)[number];
export type FulfillmentStatus = (typeof FULFILLMENT)[number];

export function paymentStatus(status: string): PaymentStatus {
  return status === 'refunded' ? 'refunded' : status === 'canceled' ? 'voided' : 'paid';
}

/** `shipped` = đơn có dòng trong bảng fulfillments: hoàn tiền / huỷ sau khi gửi hàng vẫn là "Fulfilled" (cần xử lý hàng trả về). */
export function fulfillmentStatus(status: string, shipped = false): FulfillmentStatus {
  if (status === 'shipped' || status === 'delivered') return 'fulfilled';
  if (shipped && (status === 'refunded' || status === 'canceled')) return 'fulfilled';
  return status === 'in_production' ? 'in_production' : 'unfulfilled';
}

/** Giá trị orders.status ứng với một bộ lọc (dùng trong WHERE status IN (...)). */
export const STATUSES_FOR = {
  payment: { paid: ['paid', 'in_production', 'shipped', 'delivered'], refunded: ['refunded'], voided: ['canceled'] },
  fulfillment: { unfulfilled: ['paid', 'refunded', 'canceled'], in_production: ['in_production'], fulfilled: ['shipped', 'delivered'] },
} as const satisfies { payment: Record<PaymentStatus, readonly string[]>; fulfillment: Record<FulfillmentStatus, readonly string[]> };

/** Đơn còn phải làm: đã thanh toán, chưa giao. */
export const TO_FULFILL = ['paid', 'in_production'] as const;

/** Chuyển trạng thái hợp lệ khi "Mark as fulfilled". */
export const canFulfill = (status: string) => (TO_FULFILL as readonly string[]).includes(status);
