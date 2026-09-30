import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { safeAccountNext } from '@/lib/customer';
import { currentCustomer } from '@/lib/customer-session';
import { AuthForm } from '@/components/account/AuthForm';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false }, alternates: { canonical: '/account/login' } };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const next = safeAccountNext((await searchParams).next);
  if (await currentCustomer()) redirect(next);
  return (
    <div className="mx-auto max-w-md px-4 py-12 md:py-16">
      <h1 className="text-4xl font-semibold">Sign in</h1>
      <p className="mt-2 text-muted-foreground">See your orders and whether each portrait’s preview is approved.</p>
      <div className="mt-8"><AuthForm mode="login" next={next} /></div>
      <p className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
        Ordered without an account? <Link href="/track-order" className="font-medium text-foreground underline underline-offset-4 hover:text-accent">Track your order</Link> with its number and your email.
      </p>
    </div>
  );
}
