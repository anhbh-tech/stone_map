import Link from 'next/link';
import { currentCustomer } from '@/lib/customer-session';
import { UiIcon } from '@/components/nav/icons';

/** Dòng nhỏ trên trang checkout: đơn có được lưu vào tài khoản hay không (UI-2 gắn đơn vào khách đang đăng nhập). */
export async function CheckoutAccountNote() {
  const c = await currentCustomer();
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="checkout-account-note">
      <UiIcon name="user" size={16} />
      {c
        ? <>Signed in as <strong className="font-medium text-foreground">{c.email}</strong>. This order will be saved to your account.</>
        : <>Have an account? <Link href="/account/login?next=/checkout" className="font-medium text-foreground underline underline-offset-4 hover:decoration-2">Sign in</Link> to save this order to it.</>}
    </p>
  );
}
