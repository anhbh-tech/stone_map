import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeAccountNext } from '@/lib/customer';
import { currentCustomer } from '@/lib/customer-session';
import { AuthForm } from '@/components/account/AuthForm';

export const metadata: Metadata = { title: 'Create account', robots: { index: false, follow: false }, alternates: { canonical: '/account/register' } };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function RegisterPage({ searchParams }: Props) {
  const next = safeAccountNext((await searchParams).next);
  if (await currentCustomer()) redirect(next);
  return (
    <div className="mx-auto max-w-md px-4 py-12 md:py-16">
      <h1 className="text-4xl font-semibold">Create an account</h1>
      <p className="mt-2 text-muted-foreground">Orders you place while signed in are saved here, with the status of every design.</p>
      <div className="mt-8"><AuthForm mode="register" next={next} /></div>
    </div>
  );
}
