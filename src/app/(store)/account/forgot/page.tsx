import type { Metadata } from 'next';
import { ForgotForm } from '@/components/account/PasswordReset';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false, follow: false }, alternates: { canonical: '/account/forgot' } };

export default function ForgotPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 md:py-16">
      <h1 className="text-4xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-muted-foreground">Enter the email you signed up with and we’ll send you a link to choose a new password.</p>
      <div className="mt-8"><ForgotForm /></div>
    </div>
  );
}
