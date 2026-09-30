'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@/lib/pixel';

/** page_viewed qua pixel first-party. Chỉ gửi pathname — query có thể chứa email/token. */
export function PageViews() {
  const path = usePathname();
  useEffect(() => { track('page_viewed', { path }); }, [path]);
  return null;
}
