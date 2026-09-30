import type { Metadata } from 'next';
import { Cormorant, Montserrat } from 'next/font/google';
import './globals.css';

// Font tự host qua next/font (không gọi Google Fonts lúc chạy, #8).
const cormorant = Cormorant({ variable: '--font-cormorant', subsets: ['latin'], weight: ['500', '600', '700'], display: 'swap' });
const montserrat = Montserrat({ variable: '--font-montserrat', subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3000'),
  title: { default: 'Pearl Atelier', template: '%s | Pearl Atelier' },
};

// Layout gốc chỉ có html/body. Header/footer của storefront nằm ở app/(store)/layout.tsx, admin ở app/admin/layout.tsx.
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${cormorant.variable} ${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
