import Link from 'next/link';
import { firstName } from '@/lib/customer';
import { currentCustomer } from '@/lib/customer-session';
import { UiIcon } from './icons';

/**
 * Link tài khoản cho header (hợp đồng chung, UI-1 đặt cạnh giỏ): đã đăng nhập → /account, chưa → /account/login.
 * Icon button 44px như giỏ (DESIGN.md › Icon button); đã đăng nhập thì có chấm mực nhỏ. Server component đọc cookie phiên;
 * sau đăng nhập / đăng xuất client gọi router.refresh() để header render lại.
 */
export async function AccountLink() {
  const c = await currentCustomer();
  return (
    <Link href={c ? '/account' : '/account/login'} aria-label={c ? `Account, signed in as ${firstName(c)}` : 'Sign in'} data-testid="account-link"
      className="relative inline-flex size-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted">
      <UiIcon name="user" size={22} />
      {c && <span aria-hidden="true" className="absolute right-2 top-2 size-2 rounded-full bg-primary ring-2 ring-background" />}
    </Link>
  );
}
