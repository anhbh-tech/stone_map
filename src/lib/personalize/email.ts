// Email "preview đã xong" (#2): khách rời trang lúc chờ vẫn quay lại được đúng design. Mailer giả lập = bảng email_outbox.
import { db } from '../db';
import type { Settings } from '../types';
import type { DesignRow } from './designs';

export const siteUrl = () => (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** Link quay lại design trên PDP: /products/<handle>?design=<id>. */
export function designLink(d: Pick<DesignRow, 'id' | 'product_id'>): string {
  const p = db().prepare('SELECT handle FROM products WHERE id = ?').get(d.product_id) as { handle: string } | undefined;
  return `${siteUrl()}/products/${encodeURIComponent(p?.handle ?? '')}?design=${encodeURIComponent(d.id)}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function queuePreviewReady(d: DesignRow, previewUrl: string | null, s: Settings) {
  if (!d.email) return;
  const link = designLink(d);
  const name = d.pet_name ? esc(d.pet_name) : 'your pet';
  const img = previewUrl ? `<p><img src="${esc(siteUrl() + previewUrl)}" alt="Pearl portrait preview of ${name}" width="480" style="max-width:100%;height:auto"></p>` : '';
  const html = `<p>Hi,</p>
<p>The pearl portrait preview of ${name} is ready (design ${esc(d.id)}).</p>
${img}
<p><a href="${esc(link)}">Review and approve your preview</a></p>
<p>Nothing is printed until you approve it. If it doesn't look like ${name}, choose Designer finish and a designer will edit it by hand.</p>
<p>${esc(s.shop.name)} · ${esc(s.shop.support_email)}</p>`;
  db().prepare("INSERT INTO email_outbox (to_addr, kind, subject, html) VALUES (?, 'preview_ready', ?, ?)")
    .run(d.email, `Your ${s.shop.name} preview is ready`, html);
}
