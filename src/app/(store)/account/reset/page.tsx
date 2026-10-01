import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetForm } from '@/components/account/PasswordReset';

// Token nằm trong URL: không index, không gửi Referer ra ngoài.
export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false, follow: false }, referrer: 'no-referrer' };

type Props = { searchParams: Promise<{ token?: string | string[] }> };

export default async function ResetPage({ searchParams }: Props) {
  const raw = (await searchParams).token;
  const token = typeof raw === 'string' && /^[\w-]{20,200}$/.test(raw) ? raw : null;
  return (
    <div className="mx-auto max-w-md px-4 py-12 md:py-16">
      <h1 className="text-4xl font-semibold">Choose a new password</h1>
      {token ? (
        <>
          <p className="mt-2 text-muted-foreground">You’ll be signed in on this device. Other devices are signed out.</p>
          <div className="mt-8"><ResetForm token={token} /></div>
        </>
      ) : (
        <p className="mt-4 text-muted-foreground">
          This link is incomplete. Open it again from the email, or <Link href="/account/forgot" className="font-medium text-foreground underline underline-offset-4 hover:decoration-2">send a new reset link</Link>.
        </p>
      )}
    </div>
  );
}
