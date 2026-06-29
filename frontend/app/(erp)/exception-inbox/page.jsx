'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api.js';

const SCOPES = ['wo', 'ppo', 'recipe', 'item'];

// Controlled inline-edit whitelist. ONLY these master-standard columns may be
// written from the inbox. Everything else stays Fix-link only. No status/ledger/
// WO/PPO/log fields appear here, so none can be written.
const INLINE_FIELDS = {
  'item_master.bp_weight_g':           { base: '/api/v1/items/master',    column: 'bp_weight_g',           min: 'pos',    label: 'grams' },
  'item_master.weight_g':              { base: '/api/v1/items/master',    column: 'weight_g',              min: 'pos',    label: 'grams' },
  'item_master.default_pcs_per_tray':  { base: '/api/v1/items/master',    column: 'default_pcs_per_tray',  min: 'pos',    label: 'pcs/tray' },
  'item_master.default_pcs_per_crate': { base: '/api/v1/items/master',    column: 'default_pcs_per_crate', min: 'pos',    label: 'pcs/crate' },
  'item_master.cavity_count':          { base: '/api/v1/items/master',    column: 'cavity_count',          min: 'pos',    label: 'cavities' },
  'machine_master.pcs_per_hour':       { base: '/api/v1/machines/master', column: 'pcs_per_hour',          min: 'pos',    label: 'pcs/hour' },
  'machine_master.cycle_time_sec':     { base: '/api/v1/machines/master', column: 'cycle_time_sec',        min: 'pos',    label: 'seconds' },
  'machine_master.pcs_per_cycle':      { base: '/api/v1/machines/master', column: 'pcs_per_cycle',         min: 'pos',    label: 'pcs/cycle' },
  'machine_master.tray_capacity':      { base: '/api/v1/machines/master', column: 'tray_capacity',         min: 'pos',    label: 'trays' },
  'machine_master.batch_capacity_kg':  { base: '/api/v1/machines/master', column: 'batch_capacity_kg',     min: 'pos',    label: 'kg' },
  'machine_master.setup_time_min':     { base: '/api/v1/machines/master', column: 'setup_time_min',        min: 'nonneg', label: 'minutes' },
  'machine_master.changeover_time_min':{ base: '/api/v1/machines/master', column: 'changeover_time_min',   min: 'nonneg', label: 'minutes' },
};

function inlineFieldFor(g) {
  if (!g || !g.entity_id) return null;
  return INLINE_FIELDS[g.table_column] || null;
}

const S = {
  wrap: { padding: 24, maxWidth: 980, margin: '0 auto' },
  h1: { fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 },
  sub: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  bar: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' },
  select: { border: '1px solid #E5E7EB', borderRadius: 6, padding: '7px 10px', fontSize: 13, background: '#fff' },
  input: { border: '1px solid #E5E7EB', borderRadius: 6, padding: '7px 10px', fontSize: 13, minWidth: 280 },
  btn: { border: '1px solid #2563EB', background: '#2563EB', color: '#fff', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' },
  btnGhost: { border: '1px solid #E5E7EB', background: '#fff', color: '#374151', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', textDecoration: 'none' },
  card: { border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginTop: 16, background: '#fff' },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' },
  code: { fontSize: 15, fontWeight: 700, color: '#111827' },
  chip: (bg, fg) => ({ fontSize: 12, fontWeight: 600, color: fg, background: bg, borderRadius: 999, padding: '3px 10px' }),
  gapRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid #F3F4F6' },
  dot: (c) => ({ width: 8, height: 8, borderRadius: 999, background: c, flexShrink: 0 }),
  msg: { fontSize: 13, color: '#374151', flex: 1 },
  mono: { fontSize: 11, color: '#6B7280', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  empty: { textAlign: 'center', padding: '40px 0', color: '#059669', fontSize: 16, fontWeight: 600 },
  err: { border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#B91C1C', borderRadius: 8, padding: 12, marginTop: 16, fontSize: 13 },
  muted: { fontSize: 12, color: '#9CA3AF' },
  link: { fontSize: 12, color: '#2563EB', cursor: 'pointer', background: 'none', border: 'none', padding: 0 },
};

function sev(severity) {
  if (severity === 'BLOCKER') return { color: '#DC2626', bg: '#FEE2E2', fg: '#991B1B', label: 'Blocker' };
  if (severity === 'WARNING') return { color: '#D97706', bg: '#FEF3C7', fg: '#92400E', label: 'Warning' };
  return { color: '#9CA3AF', bg: '#F3F4F6', fg: '#374151', label: 'Info' };
}

function confChip(c) {
  if (c === 'HIGH') return S.chip('#DCFCE7', '#166534');
  if (c === 'MED') return S.chip('#FEF9C3', '#854D0E');
  return S.chip('#F3F4F6', '#6B7280');
}

function sortGaps(arr) {
  const g = (arr || []).slice();
  const rank = { BLOCKER: 0, WARNING: 1, INFO: 2 };
  g.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
  return g;
}

export default function ExceptionInboxPage() {
  const router = useRouter();

  // inbox (auto) state
  const [cards, setCards] = useState([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('blocker');
  const [advanced, setAdvanced] = useState(false);

  // manual checker (advanced) state
  const [scope, setScope] = useState('wo');
  const [id, setId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(null);

  // inline edit state (shared across all cards; keyed by table_column:entity_id)
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(null);
  const [rowError, setRowError] = useState({});
  function setEdit(key, val) { setEdits((p) => ({ ...p, [key]: val })); }

  // initial: deep-link -> manual; otherwise -> auto inbox list
  useEffect(() => {
    let deep = false;
    try {
      const q = new URLSearchParams(window.location.search);
      const s = q.get('scope');
      const i = q.get('id');
      if (s && SCOPES.includes(s)) setScope(s);
      if (i) { deep = true; setAdvanced(true); setId(i); load(s && SCOPES.includes(s) ? s : 'wo', i); }
    } catch { /* no-op */ }
    if (!deep) loadInbox('blocker');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadInbox(status) {
    const st = status || statusFilter;
    setInboxLoading(true); setInboxError(null);
    const { data: res, error: err } = await api.get(`/api/v1/readiness/inbox?status=${encodeURIComponent(st)}`);
    setInboxLoading(false);
    if (err) { setInboxError(err.message || 'Failed to load inbox.'); setCards([]); return; }
    setCards((res && res.cards) ? res.cards : []);
    setEdits({}); setRowError({});
  }

  async function load(useScope, useId) {
    const sc = useScope || scope;
    const realId = (useId != null ? useId : id).trim();
    if (!realId) { setError('Enter an id to check readiness.'); setData(null); return; }
    setLoading(true); setError(null);
    const { data: res, error: err } = await api.get(`/api/v1/readiness/${sc}/${encodeURIComponent(realId)}`);
    setLoading(false);
    if (err) { setError(err.message || 'Failed to load readiness.'); setData(null); return; }
    setData(res || null);
    setLoaded({ scope: sc, id: realId });
  }

  async function saveAndRecheck(g) {
    const spec = inlineFieldFor(g);
    if (!spec) return;
    const key = g.table_column + ':' + g.entity_id;
    const raw = String(edits[key] ?? '').trim();
    const n = Number(raw);
    const okNum = raw !== '' && !Number.isNaN(n) && (spec.min === 'nonneg' ? n >= 0 : n > 0);
    if (!okNum) {
      setRowError((p) => ({ ...p, [key]: spec.min === 'nonneg' ? 'Enter a number 0 or higher.' : 'Enter a positive number.' }));
      return;
    }
    setRowError((p) => ({ ...p, [key]: null }));
    setSaving(key);
    const { error: err } = await api.patch(`${spec.base}/${encodeURIComponent(g.entity_id)}`, { [spec.column]: n });
    setSaving(null);
    if (err) {
      const m = String(err.message || '').toLowerCase();
      const forbidden = err.status === 403 || err.code === 'FORBIDDEN' || err.code === 'PERMISSION_DENIED'
        || m.includes('permission') || m.includes('forbidden') || m.includes('not allowed') || m.includes('role');
      setRowError((p) => ({ ...p, [key]: forbidden ? 'You don’t have permission to edit this standard.' : (err.message || 'Save failed.') }));
      return;
    }
    // refresh: re-scan inbox (fixed cards drop out) and reload manual card if open
    if (cards.length) await loadInbox(statusFilter);
    if (loaded) await load(loaded.scope, loaded.id);
  }

  function runNextAction(na) {
    if (!na) return;
    if (na.target) { router.push(na.target); return; }
    if (na.key === 'ASSIGN_AND_START') { router.push('/production-work'); return; }
    if (na.key === 'GENERATE_WOS') { router.push('/production-plan-orders'); return; }
    // READY / others: no destination — read-only inbox does not trigger writes
  }

  function renderCard(c, idx) {
    if (!c) return null;
    const gaps = sortGaps(c.gaps);
    return (
      <div style={S.card} key={`${c.scope}:${c.id}:${idx}`}>
        <div style={S.cardHead}>
          <div style={S.code}>
            {c.code || `${c.scope}:${c.id}`}
            <span style={{ ...S.muted, marginLeft: 8 }}>{String(c.scope || '').toUpperCase()}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {c.runtime && (
              <span style={confChip(c.runtime.confidence)}>
                {c.runtime.expected_minutes != null ? `${Math.round(c.runtime.expected_minutes)} min` : 'no estimate'} · {c.runtime.confidence}
              </span>
            )}
            <span style={c.ready ? S.chip('#DCFCE7', '#166534') : S.chip('#FEE2E2', '#991B1B')}>
              {c.ready ? 'Ready' : `${c.blocker_count} blocker${c.blocker_count === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        {c.runtime?.explanation && <div style={{ ...S.muted, marginTop: 6 }}>{c.runtime.explanation}</div>}

        {c.next_action && (
          <div style={{ marginTop: 12 }}>
            <button
              style={c.next_action.enabled ? S.btn : { ...S.btn, opacity: 0.5, cursor: 'not-allowed' }}
              disabled={!c.next_action.enabled}
              onClick={() => runNextAction(c.next_action)}
              title={c.next_action.reason || ''}
            >
              {c.next_action.label}
            </button>
          </div>
        )}

        {c.ready && gaps.length === 0 ? (
          <div style={S.empty}>All set — ready to plan</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {gaps.map((g, i) => {
              const scv = sev(g.severity);
              const spec = inlineFieldFor(g);
              const key = g.table_column + ':' + g.entity_id;
              return (
                <div key={`${g.table_column}-${i}`} style={S.gapRow}>
                  <span style={S.dot(scv.color)} />
                  <div style={S.msg}>
                    <div>{g.message}</div>
                    <div style={S.mono}>{g.table_column}{g.entity_code ? ` · ${g.entity_code}` : ''} · {scv.label}{g.required_by ? ` · ${g.required_by}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {spec && (
                      <>
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder={spec.label}
                          value={edits[key] ?? ''}
                          onChange={(e) => setEdit(key, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveAndRecheck(g); }}
                          style={{ width: 96, border: '1px solid #E5E7EB', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
                        />
                        <button
                          style={{ border: '1px solid #2563EB', background: saving === key ? '#93C5FD' : '#2563EB', color: '#fff', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: saving === key ? 'default' : 'pointer' }}
                          disabled={saving === key}
                          onClick={() => saveAndRecheck(g)}
                        >
                          {saving === key ? 'Saving…' : 'Save & Recheck'}
                        </button>
                      </>
                    )}
                    {g.fix_link
                      ? <a style={S.btnGhost} href={g.fix_link} onClick={(e) => { e.preventDefault(); router.push(g.fix_link); }}>Fix →</a>
                      : (!spec && <span style={S.muted}>—</span>)}
                    {rowError[key] && <span style={{ fontSize: 12, color: '#DC2626', width: '100%', textAlign: 'right' }}>{rowError[key]}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Exception Inbox</h1>
      <div style={S.sub}>Open work that needs setup before it can run. Fix inline or open the master page. Read-only scan.</div>

      <div style={S.bar}>
        <select style={S.select} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); loadInbox(e.target.value); }}>
          <option value="blocker">Blockers only</option>
          <option value="warning">Blockers + warnings</option>
          <option value="all">All</option>
        </select>
        <button style={S.btn} onClick={() => loadInbox(statusFilter)} disabled={inboxLoading}>{inboxLoading ? 'Scanning…' : 'Refresh'}</button>
        <button style={S.link} onClick={() => setAdvanced((v) => !v)}>{advanced ? 'Hide manual check' : 'Manual check (advanced)'}</button>
      </div>

      {inboxError && <div style={S.err}>{inboxError}</div>}

      {!inboxLoading && !inboxError && cards.length === 0 && (
        <div style={S.empty}>All set — nothing needs attention</div>
      )}

      {cards.map((c, i) => renderCard(c, i))}

      {advanced && (
        <div style={{ marginTop: 24, borderTop: '1px solid #E5E7EB', paddingTop: 16 }}>
          <div style={{ ...S.sub, marginTop: 0 }}>Manual check — load readiness for one work order, plan, recipe, or item by id.</div>
          <div style={S.bar}>
            <select style={S.select} value={scope} onChange={(e) => setScope(e.target.value)}>
              {SCOPES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
            <input
              style={S.input}
              placeholder="Enter WO / PPO / recipe / item id…"
              value={id}
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            />
            <button style={S.btn} onClick={() => load()} disabled={loading}>{loading ? 'Checking…' : 'Check readiness'}</button>
          </div>
          {error && <div style={S.err}>{error}</div>}
          {data && renderCard(data, 'manual')}
        </div>
      )}
    </div>
  );
}
