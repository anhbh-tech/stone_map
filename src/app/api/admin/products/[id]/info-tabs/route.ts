// Phần InfoTabs riêng của 1 sản phẩm; field rỗng / null = dùng mặc định store.
import { admin, body, intId, notFound } from '@/app/admin/_lib/http';
import { getProductInfo, productInfoSchema, setProductInfo } from '@/lib/info-tabs';

type P = { id: string };

export const GET = admin<P>((_req, { id }) => Response.json(getProductInfo(intId(id))));

export const PUT = admin<P>(async (req, { id }) => {
  const pid = intId(id);
  if (!setProductInfo(pid, await body(req, productInfoSchema))) notFound('Product');
  return Response.json(getProductInfo(pid));
});
