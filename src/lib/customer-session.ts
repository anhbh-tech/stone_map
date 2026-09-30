// Đọc khách đang đăng nhập trong server component / route handler (tách khỏi customer.ts để vitest không cần next/headers).
import { cookies } from 'next/headers';
import { CUSTOMER_COOKIE, customerForToken, type Customer } from './customer';

export async function currentCustomer(): Promise<Customer | null> {
  return customerForToken((await cookies()).get(CUSTOMER_COOKIE)?.value);
}
