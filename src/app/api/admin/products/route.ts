import { admin, body, insertRow } from '@/app/admin/_lib/http';
import { getProduct, listProducts } from '@/app/admin/_lib/repo';
import { productCreate } from '@/app/admin/_lib/schemas';

export const GET = admin(() => Response.json({ products: listProducts() }));

// Sản phẩm mới luôn là draft: cần meta description + ảnh có alt + variant trước khi bật active.
export const POST = admin(async (req) => {
  const input = await body(req, productCreate);
  const id = insertRow('products', { ...input, status: 'draft' });
  return Response.json(getProduct(id), { status: 201 });
});
