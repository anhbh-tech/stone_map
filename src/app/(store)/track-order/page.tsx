import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { currentCustomer } from '@/lib/customer-session';
import { TrackOrderForm } from '@/components/account/TrackOrderForm';

export const metadata: Metadata = {
  title: 'Track your order',
  description: 'Check where your pearl portrait is: enter your order number and the email you used at checkout.',
  alternates: { canonical: '/track-order' },
};

export default async function TrackOrderPage() {
  const s = getSettings();
  const c = await currentCustomer();
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-10">
      <h1 className="text-4xl font-semibold md:text-5xl">Track your order</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">
        Enter the order number from your confirmation email and the email you used at checkout. You will see where it is and whether each portrait’s design is approved.
      </p>
      {c && (
        <p className="mt-3 text-sm">
          Signed in? <Link href="/account" className="font-medium underline underline-offset-4 hover:text-accent">All your orders are in your account</Link>.
        </p>
      )}
      <div className="mt-8"><TrackOrderForm /></div>
      <p className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
        Can’t find your order number? Write to <a href={`mailto:${s.shop.support_email}`} className="font-medium text-foreground underline underline-offset-4">{s.shop.support_email}</a>.
      </p>
    </div>
  );
}
