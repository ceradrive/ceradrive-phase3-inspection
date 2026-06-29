import Link from 'next/link';

const cards = [
  { title: 'Purchase Requirements', desc: 'Material shortages se PR list.', href: '/purchase-requirements' },
  { title: 'Purchase Orders', desc: 'Draft, approved aur source-linked POs.', href: '/purchase-orders' },
  { title: 'GRN', desc: 'Goods receipt and inventory posting.', href: '/grns' },
  { title: 'Demand / MRP Engine', desc: 'Production suggestions from demand/reorder.', href: '/demand-production-engine' },
  { title: 'Press Planner', desc: 'Tentative press planning and material check.', href: '/press-planner' },
  { title: 'Material Availability', desc: 'Required vs available material view.', href: '/material-availability' },
  { title: 'Work Orders', desc: 'Released manufacturing work orders.', href: '/work-orders' },
  { title: 'Number Series Designer', desc: 'PO/SO/GRN/WO/QC prefix and pattern settings.', href: '/settings/number-series' },
];

export default function DashboardPage() {
  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Ceradrive ERP Dashboard</h1>
          <p style={S.sub}>Quick access to active planning, purchase, inventory and settings pages.</p>
        </div>
      </div>

      <div style={S.kpiGrid}>
        <div style={S.kpi}><span>Current Focus</span><strong>MRP → PR → PO → GRN</strong></div>
        <div style={S.kpi}><span>Planning</span><strong>Press Planner Ready</strong></div>
        <div style={S.kpi}><span>Purchasing</span><strong>PR / PO Linked</strong></div>
        <div style={S.kpi}><span>Settings</span><strong>Number Series Ready</strong></div>
      </div>

      <h2 style={S.sectionTitle}>Quick Launch</h2>

      <div style={S.grid}>
        {cards.map(card => (
          <Link key={card.href} href={card.href} style={S.card}>
            <h3 style={S.cardTitle}>{card.title}</h3>
            <p style={S.cardDesc}>{card.desc}</p>
            <span style={S.open}>Open →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

const S = {
  page: {
    minHeight: '100vh',
    padding: 24,
    background: '#F7F9FC',
    color: '#0F172A',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  },
  header: {
    marginBottom: 18,
  },
  title: {
    margin: 0,
    fontSize: 30,
    fontWeight: 950,
    letterSpacing: '-0.03em',
  },
  sub: {
    margin: '8px 0 0',
    fontSize: 14,
    color: '#64748B',
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 24,
  },
  kpi: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 14,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 900,
    margin: '0 0 12px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 14,
  },
  card: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 16,
    padding: 18,
    textDecoration: 'none',
    color: '#0F172A',
    minHeight: 130,
    display: 'flex',
    flexDirection: 'column',
  },
  cardTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 900,
  },
  cardDesc: {
    margin: '8px 0 16px',
    color: '#64748B',
    fontSize: 13,
    lineHeight: 1.45,
  },
  open: {
    marginTop: 'auto',
    color: '#004AC6',
    fontSize: 13,
    fontWeight: 900,
  },
};
