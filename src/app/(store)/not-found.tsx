import { NotFoundView } from '@/components/nav/NotFoundView';

// notFound() trong storefront (sản phẩm, collection, đơn…) và mọi URL lạ (qua [...missing]) đều về đây, giữ header/footer.
export default function StoreNotFound() {
  return <NotFoundView />;
}
