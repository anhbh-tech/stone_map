import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Page not found' };

// URL không khớp route nào: ném notFound() trong nhóm (store) để 404 có header/footer (app/not-found mặc định thì không có layout store).
export default function Missing() {
  notFound();
}
