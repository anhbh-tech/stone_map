import { admin, body, insertRow } from '@/app/admin/_lib/http';
import { listCollections } from '@/app/admin/_lib/collections';
import { collectionCreate } from '@/app/admin/_lib/schemas';


export const GET = admin(() => { return Response.json({ collections: listCollections() }); });

export const POST = admin(async (req) => {
  const id = insertRow('collections', await body(req, collectionCreate));
  return Response.json({ id }, { status: 201 });
});
