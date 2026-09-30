// Mặc định toàn store của InfoTabs trên PDP (settings key 'pdp_info'). Sản phẩm ghi đè ở /api/admin/products/:id/info-tabs.
import { admin, body } from '@/app/admin/_lib/http';
import { getInfoDefaults, infoDefaultsSchema, setInfoDefaults } from '@/lib/info-tabs';

export const GET = admin(() => Response.json(getInfoDefaults()));

export const PUT = admin(async (req) => {
  setInfoDefaults(await body(req, infoDefaultsSchema));
  return Response.json(getInfoDefaults());
});
