// Tiền luôn là số nguyên cent. Chỉ format ở UI.
export const fmt = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
/** "+$30.00" cho nút size so với size rẻ nhất (#6). */
export const delta = (cents: number, base: number, currency = 'USD') => (cents === base ? '' : `+${fmt(cents - base, currency)}`);
