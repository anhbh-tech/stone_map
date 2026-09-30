import Link from 'next/link';
import { firstName } from '@/lib/customer';
import { currentCustomer } from '@/lib/customer-session';
import { UiIcon } from './icons';

/**
 * Link tài khoản cho header (hợp đồng chung, UI-1 đặt vào header): đã đăng nhập → /account, chưa → /account/login.
 * Server component đọc cookie phiên; sau đăng nhập / đăng xuất client gọi router.refresh() để header render lại.
 */
export async function AccountLink() {
  const c = await currentCustomer();
  const label = c ? `Account, signed in as ${firstName(c)}` : 'Sign in';
  return (
    <Link href={c ? '/account' : '/account/login'} aria-label={label} data-testid="account-link"
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-foreground hover:text-accent">
      <UiIcon name="user" size={22} />
      <span className="hidden max-w-28 truncate lg:inline" aria-hidden="true">{c ? firstName(c) : 'Sign in'}</span>
    </Link>
  );
}
