'use client';

/**
 * CERADRIVE ERP — Sidebar Component (Redesign)
 * Industrial ERP navigation: rail/expanded, favorites, in-sidebar search,
 * single-open accordions, mobile drawer. Inline styles only; no dependencies.
 *
 * Props (unchanged): { collapsed, user, role, onSignOut }
 *   - Desktop: `collapsed` means compact icon rail, NOT full hide.
 *   - Mobile: drawerOpen controls overlay open/close.
 *
 * All destinations preserve existing hrefs. Master pages use the confirmed /masters/* routes.
 * The sidebar only renders links — it does not gate auth/permissions.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link            from 'next/link';
import { usePathname } from 'next/navigation';

const MODULES = [
  {
    id: 'dashboard', label: 'Dashboard', icon: '⊞',
    items: [
      { label: 'Home', href: '/dashboard' },
    ],
  },
  {
    id: 'sales', label: 'Sales', icon: '₹',
    items: [
      { label: 'Sales Orders',      href: '/sales-orders' },
      { label: 'Customer Master',   href: '/masters/customers' },
      { label: 'Price List Master', href: '/masters/price-lists' },
    ],
  },
  {
    id: 'purchase', label: 'Purchase', icon: '🛒',
    items: [
      { label: 'Purchase Requirements', href: '/purchase-requirements' },
      { label: 'Purchase Orders',        href: '/purchase-orders' },
      { label: 'Goods Receipt (GRN)',    href: '/grns' },
      { label: 'Supplier Master',        href: '/masters/suppliers' },
    ],
  },
  {
    id: 'inventory', label: 'Inventory', icon: '📦',
    items: [
      { label: 'Material Availability', href: '/material-availability' },
      { label: 'Item Master',           href: '/masters/items' },
      { label: 'Warehouse Master',      href: '/masters/warehouses' },
    ],
  },
  {
    id: 'planning', label: 'Planning', icon: '🏭',
    items: [
      { label: 'Demand & MRP',              href: '/demand-production-engine' },
      { label: 'MTO Planner',               href: '/mto-planner' },
      { label: 'Production Requirements',   href: '/production-requirements' },
      { label: 'Production Plan Orders',    href: '/production-plan-orders' },
      { label: 'Press Planner',             href: '/press-planner' },
      { label: 'Internal Production Plans', href: '/internal-production-plans' },
    ],
  },
  {
    id: 'execution', label: 'Execution', icon: '▶',
    items: [
      { label: 'Production Work',           href: '/production-work' },
    ],
  },
  {
    id: 'records', label: 'Records', icon: '🗂',
    items: [
      { label: 'Work Orders (Ledger)',      href: '/work-orders' },
      { label: 'Production Logs',           href: '/production-logs' },
    ],
  },
  {
    id: 'manufacturingSetup', label: 'Manufacturing Setup', icon: '⚒',
    items: [
      { label: 'BOM Master',                  href: '/masters/boms' },
      { label: 'Recipe Builder',              href: '/masters/stage-recipes' },
      { label: 'Routing Master',              href: '/masters/routings' },
      { label: 'Routing Templates',           href: '/masters/routing-templates' },
      { label: 'SKU Planning',                href: '/masters/sku-planning' },
      { label: 'Semi-Finished (SFG) Builder', href: '/masters/sfg-builder' },
      { label: 'Die Master',                  href: '/masters/dies' },
      { label: 'Moulding Slots',              href: '/masters/moulding-slots' },
    ],
  },
  {
    id: 'masters', label: 'Masters', icon: '📁',
    items: [
      { label: 'Item Category Master', href: '/masters/item-categories' },
      { label: 'Item Type Master',     href: '/masters/item-types' },
      { label: 'UOM Master',           href: '/masters/uom' },
      { label: 'Process Types',        href: '/masters/process-types' },
      { label: 'Machine Master',       href: '/masters/machines' },
      { label: 'Shift Master',         href: '/masters/shifts' },
      { label: 'Holiday Master',       href: '/masters/holidays' },
      { label: 'Tax Master',           href: '/masters/taxes' },
      { label: 'Vehicle Master',       href: '/masters/vehicles' },
      { label: 'Employee Master',      href: '/masters/employees' },
    ],
  },
  {
    id: 'settings', label: 'Settings', icon: '⚙',
    items: [
      { label: 'Number Series', href: '/settings/number-series' },
      { label: 'Data Import',   href: '/settings/data-import' },
    ],
  },
];

const ALL_ITEMS = MODULES.flatMap(m =>
  m.items.map(it => ({ ...it, groupId: m.id, groupLabel: m.label, icon: m.icon }))
);

const LS = {
  fav:  'ceradrive.sidebar.favorites',
  rail: 'ceradrive.sidebar.rail',
};

function lsRead(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function lsWrite(key, val) {
  try { window.localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

const COLORS = {
  active:    '#4F46E5',
  activeBg:  '#EEF2FF',
  text:      '#6B7280',
  textHover: '#374151',
  heading:   '#374151',
  border:    '#E5E7EB',
  hoverBg:   '#F9FAFB',
  star:      '#F5C200',
};

function isActiveHref(pathname, href) {
  return pathname === href || pathname.startsWith(href + '/');
}

function StarIcon({ filled }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill={filled ? COLORS.star : 'none'}
      stroke={filled ? COLORS.star : '#C9CDD3'} strokeWidth="1.3" aria-hidden="true">
      <path d="M7 1.5l1.6 3.4 3.7.4-2.8 2.5.8 3.7L7 10.1 3.7 12l.8-3.7L1.7 5.7l3.7-.4z" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronIcon({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
      style={{ color: '#9CA3AF', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
      <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="6.5" cy="6.5" r="5" stroke="#9CA3AF" strokeWidth="1.3" />
      <path d="M10.5 10.5L13.5 13.5" stroke="#9CA3AF" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function LeafRow({ item, pathname, indent, isFav, onToggleFav, onNavigate }) {
  const active = isActiveHref(pathname, item.href);
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', background: active ? COLORS.activeBg : 'transparent',
        borderLeft: active ? `3px solid ${COLORS.active}` : '3px solid transparent' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = COLORS.hoverBg; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <Link
        href={item.href}
        onClick={onNavigate}
        style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center',
          padding: `6px 4px 6px ${indent}px`, fontSize: 13,
          color: active ? COLORS.active : COLORS.text,
          fontWeight: active ? 500 : 400, textDecoration: 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {item.label}
      </Link>
      <button
        onClick={() => onToggleFav(item.href)}
        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 10px 0 6px',
          display: 'flex', alignItems: 'center', flexShrink: 0 }}
      >
        <StarIcon filled={isFav} />
      </button>
    </div>
  );
}

function ModuleGroup({ module, pathname, open, onToggle, favs, onToggleFav, onNavigate }) {
  return (
    <div>
      <button
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '8px 12px 4px', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700,
          color: COLORS.heading, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          <span style={{ fontSize: 12, lineHeight: 1 }}>{module.icon}</span>
          {module.label}
        </div>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div style={{ paddingBottom: 4 }}>
          {module.items.map(item => (
            <LeafRow key={item.href} item={item} pathname={pathname} indent={23}
              isFav={favs.includes(item.href)} onToggleFav={onToggleFav} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function Logo({ showText }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <svg width="30" height="30" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
        <polygon points="3,26 13,6 18,14 10,14 15,22" fill="#D42020" />
        <polygon points="18,14 26,26 16,26 16,22 21,22" fill="#F5C200" />
        <polygon points="3,26 10,14 16,22 16,26" fill="#2C2C2A" />
      </svg>
      {showText && (
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', letterSpacing: '-0.2px' }}>ceradrive</div>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#6B7280', letterSpacing: '0.18em', textTransform: 'uppercase' }}>Brakes</div>
        </div>
      )}
    </div>
  );
}

export default function ERPSidebar({ collapsed, user, role, onSignOut }) {
  const pathname = usePathname();

  const defaultOpenGroup = useMemo(() => {
    const g = MODULES.find(m => m.items.some(it => isActiveHref(pathname, it.href)));
    return g ? g.id : 'dashboard';
  }, [pathname]);

  const [rail, setRail]           = useState(false);
  const [isMobile, setIsMobile]   = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState(defaultOpenGroup);
  const [query, setQuery]         = useState('');
  const [favorites, setFavorites] = useState([]);
  const [hydrated, setHydrated]   = useState(false);

  useEffect(() => {
    setFavorites(lsRead(LS.fav, []));
    setRail(Boolean(lsRead(LS.rail, false)));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 768px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', apply) : mq.removeListener(apply); };
  }, []);

  useEffect(() => { setOpenGroup(defaultOpenGroup); }, [defaultOpenGroup]);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  const toggleFav = useCallback((href) => {
    setFavorites(prev => {
      const next = prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href];
      lsWrite(LS.fav, next);
      return next;
    });
  }, []);

  const toggleRail = useCallback(() => {
    setRail(prev => { lsWrite(LS.rail, !prev); return !prev; });
  }, []);

  const toggleGroup = useCallback((id) => {
    setOpenGroup(cur => (cur === id ? null : id));
  }, []);

  const onNavigate = useCallback(() => { if (isMobile) setDrawerOpen(false); }, [isMobile]);

  const q = query.trim().toLowerCase();
  const searchResults = q
    ? ALL_ITEMS.filter(it =>
        it.label.toLowerCase().includes(q) || it.groupLabel.toLowerCase().includes(q))
    : null;

  const favItems = favorites.map(h => ALL_ITEMS.find(it => it.href === h)).filter(Boolean);

  const compactRail = !isMobile && collapsed;
  const width = isMobile ? 264 : (compactRail ? 72 : 248);
  const showText = isMobile ? true : !compactRail;
  const railMode = compactRail;

  const asideBase = {
    display: 'flex', flexDirection: 'column',
    background: '#fff', borderRight: `1px solid ${COLORS.border}`,
    height: '100%', overflow: 'hidden', flexShrink: 0,
    transition: 'width 0.2s ease, transform 0.2s ease',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  };

  const asideMobile = {
    position: 'fixed', top: 0, left: 0, zIndex: 60, width: 264,
    transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
    boxShadow: drawerOpen ? '2px 0 16px rgba(0,0,0,0.18)' : 'none',
  };

  const sectionLabel = (txt) => (
    <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: '#9CA3AF',
      textTransform: 'uppercase', letterSpacing: '0.08em' }}>{txt}</div>
  );

  const navBody = (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
      {railMode ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 6, gap: 2 }}>
          {MODULES.map(m => {
            const active = m.items.some(it => isActiveHref(pathname, it.href));
            return (
              <button key={m.id} onClick={toggleRail} title={m.label} aria-label={m.label}
                style={{ width: 44, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: active ? COLORS.activeBg : 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer',
                  borderLeft: active ? `3px solid ${COLORS.active}` : '3px solid transparent', fontSize: 17 }}>
                {m.icon}
              </button>
            );
          })}
        </div>
      ) : searchResults ? (
        <div style={{ paddingTop: 4 }}>
          {sectionLabel(`Results (${searchResults.length})`)}
          {searchResults.length === 0
            ? <div style={{ padding: '8px 16px', fontSize: 13, color: '#9CA3AF' }}>No matches.</div>
            : searchResults.map(it => (
                <LeafRow key={it.href} item={it} pathname={pathname} indent={16}
                  isFav={favorites.includes(it.href)} onToggleFav={toggleFav} onNavigate={onNavigate} />
              ))}
        </div>
      ) : (
        <>
          {favItems.length > 0 && (
            <div style={{ borderBottom: `1px solid ${COLORS.border}`, paddingBottom: 4 }}>
              {sectionLabel('\u2605 Favorites')}
              {favItems.map(it => (
                <LeafRow key={it.href} item={it} pathname={pathname} indent={16}
                  isFav onToggleFav={toggleFav} onNavigate={onNavigate} />
              ))}
            </div>
          )}
          {MODULES.map(m => (
            <ModuleGroup key={m.id} module={m} pathname={pathname}
              open={openGroup === m.id} onToggle={() => toggleGroup(m.id)}
              favs={favorites} onToggleFav={toggleFav} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </div>
  );

  const header = (
    <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 12px', borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0, overflow: 'hidden' }}>
      <Logo showText={showText} />
      {!isMobile && showText && (
        <button onClick={toggleRail} title={rail ? 'Expand sidebar' : 'Collapse to rail'}
          aria-label={rail ? 'Expand sidebar' : 'Collapse to rail'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4,
            display: showText ? 'flex' : 'none', alignItems: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
            style={{ transform: rail ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {isMobile && (
        <button onClick={() => setDrawerOpen(false)} aria-label="Close menu"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 20, padding: 4, flexShrink: 0 }}>
          {'\u2715'}
        </button>
      )}
    </div>
  );

  const search = (!railMode && showText) ? (
    <div style={{ padding: '10px 12px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px',
        background: COLORS.hoverBg, border: `1px solid ${COLORS.border}`, borderRadius: 6 }}>
        <SearchIcon />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search menu…"
          style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: '#111827' }}
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 14, padding: 0 }}>{'\u2715'}</button>
        )}
      </div>
    </div>
  ) : null;

  const footer = (
    <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: railMode ? '10px 0' : '10px 14px',
      display: 'flex', alignItems: 'center', justifyContent: railMode ? 'center' : 'flex-start', gap: 8, flexShrink: 0 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#374151', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
        {user?.email?.slice(0, 2).toUpperCase() ?? 'KB'}
      </div>
      {showText && (
        <>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.full_name ?? user?.email ?? 'Kamal Bhola'}
            </div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>{role ?? 'Manager'}</div>
          </div>
          <button onClick={onSignOut} title="Sign out" aria-label="Sign out"
            style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: 13, padding: 2, cursor: 'pointer', flexShrink: 0 }}>{'\u2197'}</button>
        </>
      )}
    </div>
  );

  const aside = (
    <aside
      className="erp-sidebar"
      style={{ ...asideBase, ...(isMobile ? asideMobile : {}), width, minWidth: isMobile ? undefined : width }}
    >
      {header}
      {search}
      {navBody}
      {footer}
    </aside>
  );

  if (isMobile) {
    return (
      <>
        {!drawerOpen && (
          <button onClick={() => setDrawerOpen(true)} aria-label="Open menu"
            style={{ position: 'fixed', left: 12, bottom: 16, zIndex: 55, width: 44, height: 44, borderRadius: '50%',
              background: COLORS.active, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 18,
              boxShadow: '0 2px 10px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {'\u2630'}
          </button>
        )}
        {drawerOpen && (
          <div onClick={() => setDrawerOpen(false)} aria-hidden="true"
            style={{ position: 'fixed', inset: 0, zIndex: 59, background: 'rgba(17,24,39,0.45)' }} />
        )}
        {aside}
      </>
    );
  }

  return aside;
}
