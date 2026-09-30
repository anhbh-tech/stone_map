import { admin } from '@/app/admin/_lib/http';
import { getSettings, shippingHeadline } from '@/lib/settings';

export const GET = admin(() => {
  const s = getSettings();
  return Response.json({ settings: s, shipping_headline: shippingHeadline(s) });
});
