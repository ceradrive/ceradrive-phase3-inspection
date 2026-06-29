'use client';

/**
 * Root page — redirect to ERP home.
 * The ERP shell layout handles auth check and redirects to /login if needed.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/purchase-orders');
  }, [router]);

  return null;
}
