// STUB của UI-1 theo hợp đồng chung: crew UI-2 sở hữu file này (đọc phiên khách, link /account hoặc /account/login). Khi rebase, bản của UI-2 thắng.
import Link from 'next/link';
import { Icon } from '../shell/Icon';

export async function AccountLink() {
  return (
    <Link href="/account/login" aria-label="Sign in to your account" className="inline-flex size-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted">
      <Icon name="user" size={22} />
    </Link>
  );
}
