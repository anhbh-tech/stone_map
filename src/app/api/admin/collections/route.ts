import { admin, body, HttpError, insertRow } from '@/app/admin/_lib/http';
import { listCollections } from '@/app/admin/_lib/collections';
import { collectionCreate } from '@/app/admin/_lib/schemas';
import { collectionsReady } from '@/app/admin/_lib/schema-info';

const ready = () => { if (!collectionsReady()) throw new HttpError(503, 'collections_unavailable', 'Collections are not set up in this database yet'); };

export const GET = admin(() => { ready(); return Response.json({ collections: listCollections() }); });

export const POST = admin(async (req) => {
  ready();
  const id = insertRow('collections', await body(req, collectionCreate));
  return Response.json({ id }, { status: 201 });
});
