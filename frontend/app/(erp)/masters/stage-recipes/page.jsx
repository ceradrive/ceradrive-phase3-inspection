'use client';

/**
 * CERADRIVE ERP — Stage Recipes Library.
 * Premium master list UI while preserving existing Stage Recipe API and actions.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';
import { useToast } from '../../../../components/ui/Toast.jsx';

const LIMIT = 50;

const TH = {
  primary: '#004AC6',
  primaryDark: '#003594',
  text: '#0F172A',
  muted: '#64748B',
  border: '#CBD5E1',
  borderSoft: '#E2E8F0',
  bg: '#F8FAFC',
  card: '#FFFFFF',
  soft: '#F1F5F9',
  green: '#16A34A',
  amber: '#D97706',
  red: '#DC2626',
  slate: '#64748B',
};

const statusMeta = {
  active: {
    label: 'Active',
    dot: TH.green,
    bg: '#F0FDF4',
    color: '#166534',
    border: '#BBF7D0',
    tone: 'OK',
  },
  draft: {
    label: 'Draft',
    dot: '#2563EB',
    bg: '#EFF6FF',
    color: '#1E40AF',
    border: '#BFDBFE',
    tone: 'WIP',
  },
  inactive: {
    label: 'Inactive',
    dot: TH.slate,
    bg: '#F8FAFC',
    color: '#475569',
    border: '#E2E8F0',
    tone: 'OLD',
  },
  superseded: {
    label: 'Superseded',
    dot: TH.slate,
    bg: '#F8FAFC',
    color: '#64748B',
    border: '#E2E8F0',
    tone: 'OLD',
  },
  review: {
    label: 'Needs Review',
    dot: '#F59E0B',
    bg: '#FFFBEB',
    color: '#92400E',
    border: '#FDE68A',
    tone: 'REQ',
  },
};

function normalizeStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('review')) return 'review';
  if (s === 'superseded') return 'superseded';
  if (s === 'inactive') return 'inactive';
  if (s === 'active') return 'active';
  return 'draft';
}

function statusBadge(status) {
  const key = normalizeStatus(status);
  const m = statusMeta[key] || statusMeta.draft;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 999, border: `1px solid ${m.border}`, background: m.bg, color: m.color, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: m.dot }} />
      {m.label}
    </span>
  );
}

function outputItem(recipe) {
  if (recipe?.fg_item?.item_code || recipe?.fg_item?.item_name) {
    return {
      title: recipe.fg_item.item_name || recipe.fg_item.item_code,
      code: recipe.fg_item.item_code || '—',
    };
  }
  return {
    title: recipe?.recipe_name || 'Untitled stage recipe',
    code: recipe?.planning_unit || '—',
  };
}

function processLabel(recipe) {
  return recipe?.process_type?.process_name
    || recipe?.process_type?.name
    || recipe?.process_name
    || recipe?.make_policy
    || 'Process not set';
}

function versionLabel(recipe) {
  const raw = recipe?.version_no ?? recipe?.version ?? recipe?.revision_no;
  if (raw === undefined || raw === null || raw === '') return 'v1.0';
  return String(raw).startsWith('v') ? String(raw) : `v${raw}`;
}

function stepsCount(recipe) {
  return Number(recipe?.steps_count ?? recipe?.step_count ?? recipe?.steps?.length ?? 0) || 0;
}

function linkedBomLabel(recipe) {
  return recipe?.bom?.bom_number || recipe?.bom_number || recipe?.generated_bom_number || '';
}

function updatedLabel(recipe) {
  const raw = recipe?.updated_at || recipe?.created_at || recipe?.generated_at;
  if (!raw) return '—';
  try {
    return new Date(raw).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(raw).slice(0, 10);
  }
}

function authorLabel(recipe) {
  return recipe?.updated_by_user?.full_name || recipe?.created_by_user?.full_name || recipe?.updated_by || recipe?.created_by || 'System';
}

function StatCard({ label, value, tone, accent }) {
  return (
    <div style={{ height: 36, border: `1px solid ${TH.borderSoft}`, borderLeft: `4px solid ${accent || TH.borderSoft}`, borderRadius: 10, background: TH.card, padding: '8px 12px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.06em', textTransform: 'uppercase', color: TH.muted }}>{label}</div>
        <div style={{ marginTop: 3, fontSize: 16, lineHeight: '22px', fontWeight: 900, color: TH.text }}>{value}</div>
      </div>
      {tone ? <span style={{ fontSize: 10, fontWeight: 900, color: accent || TH.primary, background: `${accent || TH.primary}12`, borderRadius: 6, padding: '3px 6px' }}>{tone}</span> : null}
    </div>
  );
}

export default function StageRecipeListPage() {
  const router = useRouter();
  const addToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('current');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [copyingId, setCopyingId] = useState(null);
  const [selectedRecipe, setSelectedRecipe] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = { page, limit: LIMIT };
    if (search.trim()) params.search = search.trim();
    if (status) params.status = status;
    const { data, meta, error } = await api.get('/api/v1/stage-recipes/master', params);
    if (error) addToast(error.message ?? 'Failed to load stage recipes.');
    else {
      const nextRows = data ?? [];
      setRows(nextRows);
      setTotal(meta?.total ?? 0);
      // Keep the drawer closed by default so the master table gets full width.
      // If a drawer is already open, preserve it only while that recipe still exists in the current result set.
      setSelectedRecipe((current) => current && nextRows.some((r) => r.id === current.id) ? current : null);
    }
    setLoading(false);
  }, [addToast, page, search, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const stats = useMemo(() => {
    const active = rows.filter((r) => normalizeStatus(r.status) === 'active').length;
    const draft = rows.filter((r) => normalizeStatus(r.status) === 'draft').length;
    const superseded = rows.filter((r) => ['superseded', 'inactive'].includes(normalizeStatus(r.status))).length;
    const review = rows.filter((r) => normalizeStatus(r.status) === 'review').length;
    return { active, draft, superseded, review };
  }, [rows]);

  const copyRecipe = async (recipe) => {
    if (copyingId !== null) return;

    setCopyingId(recipe.id);
    try {
      const { data, error } = await api.post(
        `/api/v1/stage-recipes/master/${recipe.id}/copy`,
        {},
      );

      if (error) {
        addToast(error.message ?? 'Failed to copy stage recipe.');
        return;
      }

      if (!data?.id) {
        addToast('Recipe copied, but copied draft ID was missing.');
        return;
      }

      addToast(data.recipe_code ? `Copied as ${data.recipe_code}.` : 'Recipe copied.');
      router.push(`/masters/stage-recipes/${data.id}`);
    } catch (error) {
      addToast(error?.message ?? 'Failed to copy stage recipe.');
    } finally {
      setCopyingId(null);
    }
  };

  const openRecipe = (recipe) => setSelectedRecipe(recipe);
  const selectedOutput = outputItem(selectedRecipe);
  const selectedBom = linkedBomLabel(selectedRecipe);
  const selectedStatus = normalizeStatus(selectedRecipe?.status);

  return (
    <div style={{ background: TH.bg, minHeight: 'calc(100vh - 64px)', margin: -24, padding: 24, fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', color: TH.text }}>
      <div style={{ display: 'grid', gridTemplateColumns: selectedRecipe ? 'minmax(0, 1fr) 420px' : 'minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        <section style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 25, lineHeight: '32px', fontWeight: 900, letterSpacing: '-0.02em' }}>Stage Recipes Library</h1>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: TH.muted }}>Manage process-wise manufacturing recipes and versions for Plant 01 operations.</p>
            </div>
            <button onClick={() => router.push('/masters/stage-recipes/new')} style={{ height: 42, border: 'none', borderRadius: 10, background: TH.primary, color: '#fff', padding: '0 18px', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 18px rgba(0,74,198,0.18)', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 18 }}>＋</span> New Stage Recipe
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginBottom: 12 }}>
            <StatCard label="Total Recipes" value={total || rows.length} tone={total ? `${rows.length} shown` : ''} accent={TH.primary} />
            <StatCard label="Active" value={stats.active} tone="OK" accent={TH.green} />
            <StatCard label="Draft" value={stats.draft} tone="WIP" accent="#2563EB" />
            <StatCard label="Superseded" value={stats.superseded} tone="OLD" accent={TH.slate} />
            <StatCard label="Review" value={stats.review} tone="REQ" accent="#F59E0B" />
          </div>

          <div style={{ border: `1px solid ${TH.borderSoft}`, borderRadius: 12, background: TH.card, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Recipe No, Item, or Process..." style={{ flex: '1 1 320px', height: 38, border: `1px solid ${TH.border}`, borderRadius: 8, padding: '0 12px', fontSize: 14, outline: 'none' }} />
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ height: 38, border: `1px solid ${TH.border}`, borderRadius: 8, padding: '0 10px', fontSize: 13, background: '#fff', fontWeight: 700 }}>
              <option value="current">Current</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="superseded">Superseded</option>
              <option value="all">All statuses</option>
            </select>
            <button onClick={load} style={{ height: 38, padding: '0 14px', border: `1px solid ${TH.border}`, borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Refresh</button>
          </div>

          <div style={{ border: `1px solid ${TH.borderSoft}`, borderRadius: 14, overflow: 'hidden', background: TH.card, boxShadow: '0 1px 2px rgba(15,23,42,0.05), 0 10px 28px rgba(15,23,42,0.035)' }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 1180 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(230px,.30fr) minmax(190px,.25fr) 64px 120px 60px 80px minmax(140px,.25fr) minmax(110px,.20fr)', alignItems: 'center', gap: 0, background: TH.soft, borderBottom: `1px solid ${TH.borderSoft}`, color: TH.muted, fontSize: 11, fontWeight: 900, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  {['Recipe No', 'Output Item (SKU)', 'Process', 'Ver', 'Status', 'Steps', 'BOM', 'Last Updated', 'Actions'].map((h) => <div key={h} style={{ padding: '7px 9px', textAlign: ['Ver', 'Status', 'Steps', 'BOM', 'Actions'].includes(h) ? 'center' : 'left' }}>{h}</div>)}
                </div>

                {loading ? (
                  <div style={{ padding: 16, color: TH.muted, fontSize: 14 }}>Loading stage recipes…</div>
                ) : rows.length === 0 ? (
                  <div style={{ padding: 42, textAlign: 'center', color: TH.muted }}>
                    <div style={{ fontSize: 18, marginBottom: 8 }}>📋</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: TH.text }}>No stage recipes found</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>Try changing filters or create a new stage recipe.</div>
                  </div>
                ) : rows.map((r) => {
                  const out = outputItem(r);
                  const key = normalizeStatus(r.status);
                  const isSelected = selectedRecipe?.id === r.id;
                  const bom = linkedBomLabel(r);
                  const muted = key === 'superseded' || key === 'inactive';
                  return (
                    <div key={r.id} onClick={() => openRecipe(r)} onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#F8FAFC'; }} onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = '#fff'; }} style={{ display: 'grid', gridTemplateColumns: '180px minmax(230px,.30fr) minmax(190px,.25fr) 64px 120px 60px 80px minmax(140px,.25fr) minmax(110px,.20fr)', alignItems: 'center', minHeight: 46, borderBottom: `1px solid ${TH.borderSoft}`, background: isSelected ? '#F0F4FF' : '#fff', cursor: 'pointer', opacity: muted ? 0.62 : 1, position: 'relative', transition: 'background 120ms ease' }}>
                      {isSelected ? <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: TH.primary }} /> : null}
                      <div style={{ padding: '8px 10px 8px 14px', fontSize: 12, fontWeight: 900, color: isSelected ? TH.primary : TH.text, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.recipe_code || '—'}</div>
                      <div style={{ padding: '7px 10px', minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontSize: 13, fontWeight: 900, color: TH.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{out.title}</div>
                        <div style={{ fontSize: 11, color: TH.muted, marginTop: 2, fontWeight: 700 }}>{out.code}</div>
                      </div>
                      <div style={{ padding: '7px 9px', fontSize: 13, color: TH.text, fontWeight: 600 }}>{processLabel(r)}</div>
                      <div style={{ padding: '7px 9px', textAlign: 'center' }}><span style={{ background: TH.soft, color: TH.text, padding: '3px 6px', borderRadius: 6, fontSize: 10, fontWeight: 900 }}>{versionLabel(r)}</span></div>
                      <div style={{ padding: '7px 9px', display: 'flex', justifyContent: 'center' }}>{statusBadge(r.status)}</div>
                      <div style={{ padding: '7px 9px', textAlign: 'center', fontWeight: 900, fontSize: 13 }}>{stepsCount(r) || '—'}</div>
                      <div style={{ padding: '7px 9px', textAlign: 'center', color: bom ? TH.green : TH.slate, fontSize: 12, fontWeight: 900 }}>{bom ? 'Linked' : '—'}</div>
                      <div style={{ padding: '7px 9px' }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: TH.text }}>{updatedLabel(r)}</div>
                        <div style={{ fontSize: 10, color: TH.muted, marginTop: 2 }}>{authorLabel(r)}</div>
                      </div>
                      <div style={{ padding: '7px 9px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }} onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openRecipe(r)} style={{ height: 30, padding: '0 12px', border: 'none', borderRadius: 8, background: '#EFF6FF', color: TH.primary, fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>View</button>
                        <button onClick={() => router.push(`/masters/stage-recipes/${r.id}`)} style={{ height: 30, width: 30, border: `1px solid ${TH.borderSoft}`, borderRadius: 8, background: '#fff', color: TH.muted, fontSize: 18, lineHeight: '18px', cursor: 'pointer' }}>⋮</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: TH.soft, borderTop: `1px solid ${TH.borderSoft}`, color: TH.muted, fontSize: 13 }}>
              <span>Showing <b style={{ color: TH.text }}>{rows.length}</b> of <b style={{ color: TH.text }}>{total}</b> items</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={{ height: 30, border: `1px solid ${TH.border}`, borderRadius: 8, background: '#fff', opacity: page <= 1 ? 0.5 : 1, padding: '0 10px' }}>Prev</button>
                <span style={{ color: TH.text, fontWeight: 800 }}>Page {page} / {pages}</span>
                <button disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))} style={{ height: 30, border: `1px solid ${TH.border}`, borderRadius: 8, background: '#fff', opacity: page >= pages ? 0.5 : 1, padding: '0 10px' }}>Next</button>
              </div>
            </div>
          </div>
        </section>

        {selectedRecipe ? (
          <aside style={{ position: 'sticky', top: 12, height: 'calc(100vh - 88px)', background: '#fff', border: `1px solid ${TH.borderSoft}`, borderRadius: 12, boxShadow: '-10px 0 30px rgba(15,23,42,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: 18, borderBottom: `1px solid ${TH.borderSoft}`, background: TH.soft }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h2 style={{ margin: 0, fontSize: 16, lineHeight: '30px', fontWeight: 900, color: TH.primary }}>{selectedRecipe.recipe_code || 'Stage Recipe'}</h2>
                    <span style={{ background: TH.primary, color: '#fff', borderRadius: 6, padding: '3px 7px', fontSize: 10, fontWeight: 900 }}>{versionLabel(selectedRecipe)}</span>
                  </div>
                  <div style={{ marginTop: 8 }}>{statusBadge(selectedRecipe.status)}</div>
                </div>
                <button onClick={() => setSelectedRecipe(null)} style={{ border: 'none', background: 'transparent', color: TH.muted, fontSize: 24, cursor: 'pointer' }}>×</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={() => copyRecipe(selectedRecipe)} disabled={copyingId !== null} style={{ flex: 1, height: 38, border: 'none', borderRadius: 10, background: TH.primary, color: '#fff', fontSize: 13, fontWeight: 900, cursor: copyingId !== null ? 'not-allowed' : 'pointer' }}>{copyingId === selectedRecipe.id ? 'Copying…' : 'Create Version'}</button>
                <button onClick={() => router.push(`/masters/stage-recipes/${selectedRecipe.id}`)} style={{ flex: 1, height: 36, border: `1px solid ${TH.border}`, borderRadius: 10, background: '#fff', color: TH.text, fontSize: 13, fontWeight: 900, cursor: 'pointer' }}>{selectedStatus === 'draft' ? 'Edit Draft' : 'Open'}</button>
              </div>
            </div>

            <div style={{ display: 'flex', borderBottom: `1px solid ${TH.borderSoft}`, padding: '0 12px', overflowX: 'auto' }}>
              {['Overview', 'Steps', 'Materials', 'BOM', 'Audit'].map((tab, idx) => (
                <button key={tab} style={{ border: 'none', background: 'transparent', borderBottom: idx === 0 ? `2px solid ${TH.primary}` : '2px solid transparent', color: idx === 0 ? TH.primary : TH.muted, padding: '13px 10px', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.04em' }}>{tab}</button>
              ))}
            </div>

            <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gap: 18 }}>
                <div>
                  <div style={{ fontSize: 10, color: TH.muted, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Output Item</div>
                  <div style={{ border: `1px solid ${TH.borderSoft}`, background: TH.soft, borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 900 }}>{selectedOutput.title}</div>
                    <div style={{ fontSize: 11, color: TH.muted, marginTop: 3, fontWeight: 800 }}>{selectedOutput.code}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, color: TH.muted, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em' }}>Process</div>
                    <div style={{ marginTop: 6, fontSize: 14, fontWeight: 800 }}>{processLabel(selectedRecipe)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: TH.muted, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em' }}>Steps Count</div>
                    <div style={{ marginTop: 6, fontSize: 14, fontWeight: 800 }}>{stepsCount(selectedRecipe) || '—'} Process Steps</div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 10, color: TH.muted, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Linked BOM</div>
                  <div style={{ border: `1px solid ${selectedBom ? TH.primary : TH.borderSoft}`, background: selectedBom ? '#F0F4FF' : TH.soft, borderRadius: 10, padding: 12, color: selectedBom ? TH.primary : TH.muted }}>
                    <div style={{ fontSize: 14, fontWeight: 900 }}>{selectedBom || 'No linked BOM found'}</div>
                    <div style={{ marginTop: 3, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{selectedBom ? 'Standard Manufacturing BOM' : 'Generate or link BOM from recipe detail'}</div>
                  </div>
                </div>

                <div style={{ height: 1, background: TH.borderSoft }} />

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: TH.muted, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em' }}>Process Steps Preview</div>
                    <button onClick={() => router.push(`/masters/stage-recipes/${selectedRecipe.id}`)} style={{ border: 'none', background: 'transparent', color: TH.primary, fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>OPEN FULL</button>
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 12, border: `1px solid ${TH.borderSoft}`, borderRadius: 10, padding: 12 }}>
                      <span style={{ width: 24, height: 24, borderRadius: 6, background: TH.primary, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900 }}>01</span>
                      <div><div style={{ fontSize: 13, fontWeight: 900 }}>Review output item and process setup</div><div style={{ fontSize: 11, color: TH.muted, marginTop: 2 }}>Open full recipe for exact routing and inputs</div></div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, border: `1px solid ${TH.borderSoft}`, borderRadius: 10, padding: 12 }}>
                      <span style={{ width: 24, height: 24, borderRadius: 6, background: TH.primary, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900 }}>02</span>
                      <div><div style={{ fontSize: 13, fontWeight: 900 }}>Check linked BOM and generated version</div><div style={{ fontSize: 11, color: TH.muted, marginTop: 2 }}>Use detail page to edit steps and materials</div></div>
                    </div>
                  </div>
                </div>

                <button onClick={() => router.push(`/masters/stage-recipes/${selectedRecipe.id}`)} style={{ width: '100%', height: 42, border: `1px solid ${TH.border}`, borderRadius: 10, background: TH.soft, color: TH.primary, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', cursor: 'pointer' }}>View Full Process Sheet</button>

                <div style={{ height: 1, background: TH.borderSoft }} />

                <div style={{ border: `1px solid ${TH.borderSoft}`, borderRadius: 12, padding: 14, background: TH.soft }}>
                  <div style={{ fontSize: 10, color: TH.muted, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em', paddingBottom: 8, borderBottom: `1px solid ${TH.borderSoft}` }}>Version Audit Summary</div>
                  <div style={{ display: 'grid', gap: 10, marginTop: 12, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ color: TH.muted, fontWeight: 800 }}>Created By</span><b>{authorLabel(selectedRecipe)}</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ color: TH.muted, fontWeight: 800 }}>Initial Release</span><b>{updatedLabel(selectedRecipe)}</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ color: TH.muted, fontWeight: 800 }}>Last Revision</span><b>{updatedLabel(selectedRecipe)}</b></div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
