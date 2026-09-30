'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';

/** Tên event trình duyệt mang số lượng giỏ mới (detail: number). Component giỏ/checkout phát sau mỗi CartView. */
export const CART_COUNT_EVENT = 'pa:cart-count';
export const announceCartCount = (count: number) => window.dispatchEvent(new CustomEvent(CART_COUNT_EVENT, { detail: count }));

/**
 * Link giỏ ở header. Layout không render lại khi điều hướng client (vd. PDP router.push('/cart') sau khi thêm),
 * nên số lượng được cập nhật qua CART_COUNT_EVENT thay vì chờ server. Layout đặt key={count} để khi server
 * render lại với số mới thì state reset theo server.
 */
export function CartBadge({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    const on = (e: Event) => setCount(Number((e as CustomEvent<number>).detail) || 0);
    addEventListener(CART_COUNT_EVENT, on);
    return () => removeEventListener(CART_COUNT_EVENT, on);
  }, []);
  return (
    <Link href="/cart" aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`} className="relative inline-flex size-11 items-center justify-center rounded-md text-foreground hover:text-accent">
      <Icon name="bag" size={22} />
      {count > 0 && (
        <span aria-hidden="true" className="absolute right-0.5 top-0.5 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold leading-5 text-on-accent">
          {count}
        </span>
      )}
    </Link>
  );
}
