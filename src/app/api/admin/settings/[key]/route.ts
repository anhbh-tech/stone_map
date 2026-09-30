import { admin, body, notFound } from '@/app/admin/_lib/http';
import { isSettingsKey, settingsSchemas } from '@/app/admin/_lib/schemas';
import { getSettings, setSetting, shippingHeadline } from '@/lib/settings';
import type { Settings } from '@/lib/types';

type P = { key: string };

export const GET = admin<P>((_req, { key }) => {
  if (!isSettingsKey(key)) notFound('Setting');
  return Response.json({ key, value: getSettings()[key] });
});

// Thay cả giá trị của 1 key (#3: mọi câu chữ ship / khung / số liệu trên storefront đọc lại từ đây).
export const PUT = admin<P>(async (req, { key }) => {
  if (!isSettingsKey(key)) notFound('Setting');
  const value = (await body(req, settingsSchemas[key])) as Settings[typeof key];
  setSetting(key, value);
  const s = getSettings();
  return Response.json({ key, value: s[key], shipping_headline: shippingHeadline(s) });
});
