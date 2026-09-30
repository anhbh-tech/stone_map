import type { Metadata } from 'next';
import { Caprasimo, Figtree } from 'next/font/google';
import './globals.css';

// Font tự host qua next/font (không gọi Google Fonts lúc chạy, #8).
// Caprasimo (display, 1 weight) cho tên shop + tiêu đề: tròn, ấm, "tiệm quà thủ công". Figtree (variable) cho mọi control và chữ thường.
const caprasimo = Caprasimo({ variable: '--font-caprasimo', subsets: ['latin'], weight: '400', display: 'swap' });
const figtree = Figtree({ variable: '--font-figtree', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3000'),
  title: { default: 'Pearl Atelier', template: '%s | Pearl Atelier' },
};

// Layout gốc chỉ có html/body. Header/footer của storefront nằm ở app/(store)/layout.tsx, admin ở app/admin/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${caprasimo.variable} ${figtree.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
