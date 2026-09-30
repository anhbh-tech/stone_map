// Email gửi khách khi designer duyệt / từ chối bản làm tay (ghi vào email_outbox, xem ở /admin/emails).
import type { Settings } from '../../../lib/types';

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function reviewEmail(s: Settings, d: { id: string; pet_name: string | null; approved: boolean }) {
  const pet = d.pet_name ? escapeHtml(d.pet_name) : 'your pet';
  const shop = escapeHtml(s.shop.name);
  const support = escapeHtml(s.shop.support_email);
  return d.approved
    ? {
        subject: `${s.shop.name}: ${d.pet_name ? `${d.pet_name}'s` : 'your'} portrait is approved`,
        html: `<p>Good news — our designer finished the portrait of ${pet} (design ${d.id}) and it is now going to production.</p><p>Questions? Reply to ${support}.</p><p>${shop}</p>`,
      }
    : {
        subject: `${s.shop.name}: we need a different photo for design ${d.id}`,
        html: `<p>Our designer could not finish the portrait of ${pet} (design ${d.id}) from the photo we received.</p><p>Please reply to ${support} with a sharper photo where the face is clearly visible.</p><p>${shop}</p>`,
      };
}

/** “Đơn đã gửi đi” khi admin đánh dấu fulfilled và tick báo khách. */
export function shippedEmail(s: Settings, o: { number: string; name: string }, f: { carrier: string | null; tracking_number: string | null; tracking_url: string | null }) {
  const track = f.tracking_number
    ? `<p>Tracking: ${f.carrier ? `${escapeHtml(f.carrier)} ` : ''}${f.tracking_url ? `<a href="${escapeHtml(f.tracking_url)}">${escapeHtml(f.tracking_number)}</a>` : escapeHtml(f.tracking_number)}</p>`
    : '';
  return {
    subject: `Your ${s.shop.name} order #${o.number} is on its way`,
    html: `<p>Hi ${escapeHtml(o.name)},</p><p>Your portrait from order #${escapeHtml(o.number)} has shipped.</p>${track}<p>Questions? Reply to ${escapeHtml(s.shop.support_email)}.</p><p>${escapeHtml(s.shop.name)}</p>`,
  };
}
