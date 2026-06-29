'use client';

import { useRouter } from 'next/navigation';

export default function NewWorkOrderPage() {
  const router = useRouter();

  return (
    <div style={{ padding: '24px 28px', maxWidth: 760, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <button onClick={() => router.push('/work-orders')}
        style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Work Orders
      </button>

      <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 10, padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#92400E', margin: '0 0 8px' }}>
          Manual Work Order creation is disabled
        </h1>
        <p style={{ fontSize: 14, color: '#78350F', lineHeight: 1.5, margin: '0 0 16px' }}>
          For Ceradrive production, Work Orders must be generated from PPO so stage dependency,
          readiness, material allocation, and machine capacity stay controlled.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => router.push('/production-plan-orders')}
            style={{ height: 36, padding: '0 14px', border: 'none', borderRadius: 6, background: '#D97706', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Go to PPO
          </button>
          <button onClick={() => router.push('/work-orders')}
            style={{ height: 36, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>
            Back to Work Orders
          </button>
        </div>
      </div>
    </div>
  );
}
