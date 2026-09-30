import type { Metadata } from 'next';
import './admin.css';

// Admin không bao giờ được index.
export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin | Pearl Atelier' },
  robots: { index: false, follow: false },
};

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return <div className="admin-root flex min-h-full flex-1 flex-col bg-background text-foreground">{children}</div>;
}
