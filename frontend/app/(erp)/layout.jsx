'use client';

/**
 * CERADRIVE ERP — Shell Layout (Theme V1)
 * White sidebar + white topbar + light grey content area.
 * Auth guard: loading || !user blocks children.
 */

import { useState, useEffect } from 'react';
import { useRouter }           from 'next/navigation';
import { useAuth }             from '../../hooks/useAuth.js';
import { ToastProvider }       from '../../components/ui/Toast.jsx';
import ERPSidebar              from '../../components/erp/ERPSidebar.jsx';

export default function ERPLayout({ children }) {
  const router = useRouter();
  const { user, role, loading, signOut } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');

  const GLOBAL_SEARCH_ROUTES = [
    { keys: ['uom', 'unit'], path: '/masters/uom' },
    { keys: ['category', 'item category', 'categories'], path: '/masters/item-categories' },
    { keys: ['type', 'item type', 'types'], path: '/masters/item-types' },
    { keys: ['bom', 'bill of material'], path: '/masters/boms' },
    { keys: ['routing', 'route'], path: '/masters/routings' },
    { keys: ['master', 'masters', 'mast', 'item', 'items', 'sku'], path: '/masters/items' },
    { keys: ['supplier', 'vendor'], path: '/masters/suppliers' },
    { keys: ['customer'], path: '/masters/customers' },
    { keys: ['warehouse', 'store'], path: '/masters/warehouses' },
    { keys: ['machine'], path: '/masters/machines' },
    { keys: ['po', 'purchase', 'purchase order'], path: '/purchase-orders' },
    { keys: ['grn', 'goods receipt'], path: '/grns' },
    { keys: ['exception', 'exceptions', 'inbox', 'readiness'], path: '/exception-inbox' },
  ];

  function handleGlobalSearchSubmit() {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return;

    const exact = GLOBAL_SEARCH_ROUTES.find(r => r.keys.some(k => q === k));
    const partial = GLOBAL_SEARCH_ROUTES.find(r => r.keys.some(k => k.includes(q) || q.includes(k)));
    const match = exact || partial;

    if (match) {
      router.push(match.path);
      setGlobalSearch('');
    }
  }

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#F9FAFB',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        color: '#9CA3AF', fontSize: 14,
      }}>
        Loading…
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="erp-shell">

        {/* Sidebar */}
        <ERPSidebar
          collapsed={sidebarCollapsed}
          user={user}
          role={role}
          onSignOut={signOut}
        />

        {/* Right column: topbar + content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Top bar */}
          <header className="erp-topbar">
            {/* Hamburger */}
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              aria-label="Toggle sidebar"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#374151', padding: '4px 6px', fontSize: 18,
                display: 'flex', alignItems: 'center', flexShrink: 0,
              }}
            >
              ☰
            </button>

            {/* Global search — module navigation search */}
            <div style={{
              width: 340, height: 36,
              border: '1px solid #D1D5DB', borderRadius: 6,
              background: '#fff',
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0 12px', color: '#9CA3AF', fontSize: 13,
              flexShrink: 0,
            }}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                <circle cx="6.5" cy="6.5" r="5" stroke="#9CA3AF" strokeWidth="1.3"/>
                <path d="M10.5 10.5L13.5 13.5" stroke="#9CA3AF" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <input
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleGlobalSearchSubmit();
                }}
                placeholder="Search module… e.g. item, uom, bom"
                style={{
                  width: '100%',
                  border: 'none',
                  outline: 'none',
                  fontSize: 13,
                  color: '#111827',
                  background: 'transparent',
                }}
              />
            </div>

            {/* Right section */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Notification bell */}
              <div style={{ position: 'relative', cursor: 'pointer', color: '#374151' }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-label="Notifications">
                  <path d="M10 2a6 6 0 0 0-6 6v3l-1.5 2.5h15L16 11V8a6 6 0 0 0-6-6z" stroke="#374151" strokeWidth="1.3"/>
                  <path d="M8 16a2 2 0 0 0 4 0" stroke="#374151" strokeWidth="1.3"/>
                </svg>
                <span style={{
                  position: 'absolute', top: -4, right: -6,
                  background: '#2563EB', color: '#fff',
                  fontSize: 9, fontWeight: 700, borderRadius: 99,
                  padding: '1px 4px', border: '1.5px solid #fff',
                }}>3</span>
              </div>

              {/* Profile */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: '#374151',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600, color: '#fff', flexShrink: 0,
                }}>
                  KB
                </div>
                <div style={{ lineHeight: 1.3 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>Kamal Bhola</div>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>Manager</div>
                </div>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ color: '#9CA3AF' }}>
                  <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="erp-content">
            {children}
          </main>

        </div>
      </div>
    </ToastProvider>
  );
}
