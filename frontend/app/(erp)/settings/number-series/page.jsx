'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';

const SERIES_LABELS = {
  PO: 'Purchase Order',
  SO: 'Sales Order',
  PR: 'Purchase Requirement',
  GRN: 'Goods Receipt Note',
  WORK_ORDER: 'Work Order',
  QC: 'Quality Check',
  FPA: 'First Piece Approval',
  BOM: 'Bill of Materials',
};

const SHORT_PREFIX = {
  WORK_ORDER: 'WO',
  PO: 'PO',
  SO: 'SO',
  PR: 'PR',
  GRN: 'GRN',
  QC: 'QC',
  FPA: 'FPA',
  BOM: 'BOM',
};

function makePreview(row) {
  if (!row) return '';

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const fyStartMonth = Number(row.financial_year_start_month || 4);
  const fyStartYear = month >= fyStartMonth ? year : year - 1;
  const fyEndYear = fyStartYear + 1;

  let pattern = row.pattern_template || `${row.prefix_template || ''}${'#'.repeat(Number(row.number_width || 4))}`;
  const suffix = row.suffix_template || '';
  const next = Number(row.current_number || 0) + 1;

  const match = pattern.match(/#+/);
  const width = match ? match[0].length : Number(row.number_width || 4);
  const seq = String(next).padStart(width, '0');

  pattern = pattern
    .replaceAll('{YYYY}', String(year))
    .replaceAll('{YY}', String(year).slice(-2))
    .replaceAll('{FY}', `${String(fyStartYear).slice(-2)}${String(fyEndYear).slice(-2)}`)
    .replaceAll('{MM}', String(month).padStart(2, '0'))
    .replaceAll('{DD}', String(day).padStart(2, '0'));

  if (match) pattern = pattern.replace(/#+/, seq);
  else pattern += seq;

  return `${pattern}${suffix}`;
}

function hashWidth(pattern) {
  const m = String(pattern || '').match(/#+/);
  return m ? m[0].length : 4;
}

function replaceHashWidth(pattern, width) {
  const hashes = '#'.repeat(Number(width || 4));
  if (String(pattern || '').match(/#+/)) return String(pattern).replace(/#+/, hashes);
  return `${pattern || ''}${hashes}`;
}

export default function NumberSeriesDesignerPage() {
  const [rows, setRows] = useState([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await api.get('/api/v1/number-series');

    if (res.error) {
      alert(res.error.message || 'Failed to load number series.');
      setLoading(false);
      return;
    }

    const list = res.data || [];
    setRows(list);

    const first = selectedCode
      ? list.find(r => r.series_code === selectedCode)
      : list[0];

    if (first) {
      setSelectedCode(first.series_code);
      setForm({ ...first });
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => rows.find(r => r.series_code === selectedCode) || null,
    [rows, selectedCode]
  );

  const preview = useMemo(() => makePreview(form), [form]);

  function selectSeries(code) {
    const row = rows.find(r => r.series_code === code);
    setSelectedCode(code);
    setForm(row ? { ...row } : null);
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function applyExample(pattern, suffix = '') {
    setForm(prev => ({
      ...prev,
      pattern_template: pattern,
      suffix_template: suffix,
      number_width: hashWidth(pattern),
    }));
  }

  async function save() {
    if (!form) return;

    if (!String(form.pattern_template || '').match(/#+/)) {
      alert('Pattern me ### ya #### hona zaroori hai.');
      return;
    }

    setSaving(true);

    const res = await api.patch(`/api/v1/number-series/${form.series_code}`, {
      pattern_template: form.pattern_template,
      suffix_template: form.suffix_template || null,
      current_number: Number(form.current_number || 0),
      reset_frequency: form.reset_frequency || 'YEARLY',
      is_active: Boolean(form.is_active),
      is_default: Boolean(form.is_default),
      financial_year_start_month: Number(form.financial_year_start_month || 4),
    });

    setSaving(false);

    if (res.error) {
      alert(res.error.message || 'Failed to save number series.');
      return;
    }

    const updated = res.data;
    setRows(prev => prev.map(r => r.series_code === updated.series_code ? updated : r));
    setForm({ ...updated });
    alert('Number series saved. Future documents will use this pattern.');
  }

  const base = SHORT_PREFIX[form?.series_code] || form?.series_code || 'DOC';

  const examples = [
    { label: 'Financial Year', pattern: `${base}/{FY}/####`, hint: `${base}/2627/0001` },
    { label: 'Calendar Year', pattern: `${base}/{YYYY}/####`, hint: `${base}/2026/0001` },
    { label: 'Company Style', pattern: `CERA-${base}/{FY}/#####`, hint: `CERA-${base}/2627/00001` },
    { label: 'Month Wise', pattern: `${base}/{YYYY}/{MM}/###`, hint: `${base}/2026/06/001` },
    { label: 'Dash Style', pattern: `${base}-{YY}-####`, hint: `${base}-26-0001` },
    { label: 'Suffix Style', pattern: `${base}/{FY}/###`, suffix: '/A', hint: `${base}/2627/001/A` },
  ];

  if (loading) return <div style={S.page}>Loading number series...</div>;

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Number Series Designer</h1>
          <p style={S.sub}>
            Fixed document types. Fully editable future numbering pattern.
          </p>
        </div>
        <button style={S.saveBtn} onClick={save} disabled={saving || !form}>
          {saving ? 'Saving...' : 'Save Pattern'}
        </button>
      </div>

      <div style={S.grid}>
        <aside style={S.left}>
          <div style={S.panelTitle}>Document Series</div>
          {rows.map(row => (
            <button
              key={row.series_code}
              style={{
                ...S.seriesBtn,
                ...(selectedCode === row.series_code ? S.seriesBtnActive : {}),
              }}
              onClick={() => selectSeries(row.series_code)}
            >
              <span style={S.seriesCode}>{row.series_code === 'WORK_ORDER' ? 'WO' : row.series_code}</span>
              <span style={S.seriesLabel}>{SERIES_LABELS[row.series_code] || row.document_type}</span>
            </button>
          ))}
        </aside>

        <main style={S.main}>
          {form && (
            <>
              <section style={S.card}>
                <div style={S.cardHeader}>
                  <div>
                    <h2 style={S.cardTitle}>{SERIES_LABELS[form.series_code] || form.document_type}</h2>
                    <div style={S.muted}>Series Code: {form.series_code}</div>
                  </div>
                  <div style={form.is_active ? S.badgeGreen : S.badgeRed}>
                    {form.is_active ? 'Active' : 'Inactive'}
                  </div>
                </div>

                <label style={S.label}>Pattern Template</label>
                <input
                  style={S.input}
                  value={form.pattern_template || ''}
                  onChange={e => setField('pattern_template', e.target.value)}
                  placeholder="PO/{FY}/####"
                />

                <div style={S.help}>
                  Tokens: {'{FY}'}, {'{YYYY}'}, {'{YY}'}, {'{MM}'}, {'{DD}'} and sequence as ### / #### / #####.
                </div>

                <div style={S.twoCol}>
                  <div>
                    <label style={S.label}>Number Width</label>
                    <select
                      style={S.input}
                      value={hashWidth(form.pattern_template)}
                      onChange={e => setField('pattern_template', replaceHashWidth(form.pattern_template, e.target.value))}
                    >
                      <option value={3}>3 digits — 001</option>
                      <option value={4}>4 digits — 0001</option>
                      <option value={5}>5 digits — 00001</option>
                      <option value={6}>6 digits — 000001</option>
                    </select>
                  </div>

                  <div>
                    <label style={S.label}>Suffix</label>
                    <input
                      style={S.input}
                      value={form.suffix_template || ''}
                      onChange={e => setField('suffix_template', e.target.value)}
                      placeholder="/A or -N"
                    />
                  </div>
                </div>

                <div style={S.twoCol}>
                  <div>
                    <label style={S.label}>Current Counter</label>
                    <input
                      style={S.input}
                      type="number"
                      min="0"
                      value={form.current_number ?? 0}
                      onChange={e => setField('current_number', e.target.value)}
                    />
                    <div style={S.warn}>Changing this affects future numbers only.</div>
                  </div>

                  <div>
                    <label style={S.label}>Reset Frequency</label>
                    <select
                      style={S.input}
                      value={form.reset_frequency || 'YEARLY'}
                      onChange={e => setField('reset_frequency', e.target.value)}
                    >
                      <option value="YEARLY">YEARLY</option>
                      <option value="NEVER">NEVER</option>
                    </select>
                  </div>
                </div>

                <div style={S.twoCol}>
                  <div>
                    <label style={S.label}>Financial Year Start Month</label>
                    <select
                      style={S.input}
                      value={form.financial_year_start_month || 4}
                      onChange={e => setField('financial_year_start_month', e.target.value)}
                    >
                      {Array.from({ length: 12 }).map((_, i) => (
                        <option key={i + 1} value={i + 1}>{i + 1}</option>
                      ))}
                    </select>
                  </div>

                  <label style={S.checkLine}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.is_active)}
                      onChange={e => setField('is_active', e.target.checked)}
                    />
                    Active
                  </label>
                </div>
              </section>

              <section style={S.previewCard}>
                <div style={S.previewLabel}>Live Next Number Preview</div>
                <div style={S.preview}>{preview}</div>
                <div style={S.previewHint}>
                  Historical PO/SO/GRN/WO numbers will not change. Only future numbers use this pattern.
                </div>
              </section>

              <section style={S.card}>
                <h3 style={S.cardTitleSmall}>Example Patterns</h3>
                <div style={S.examples}>
                  {examples.map(ex => (
                    <button
                      key={`${ex.label}-${ex.pattern}-${ex.suffix || ''}`}
                      style={S.exampleBtn}
                      onClick={() => applyExample(ex.pattern, ex.suffix || '')}
                    >
                      <strong>{ex.label}</strong>
                      <span>{ex.pattern}{ex.suffix || ''}</span>
                      <em>{ex.hint}</em>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

const S = {
  page: {
    padding: 24,
    background: '#F7F9FC',
    minHeight: '100vh',
    color: '#0F172A',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 900,
  },
  sub: {
    margin: '6px 0 0',
    color: '#64748B',
    fontSize: 14,
  },
  saveBtn: {
    border: 0,
    background: '#004AC6',
    color: '#fff',
    padding: '11px 16px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 900,
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    gap: 18,
  },
  left: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 16,
    padding: 14,
    height: 'fit-content',
  },
  panelTitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: 900,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  seriesBtn: {
    width: '100%',
    border: '1px solid #E2E8F0',
    background: '#fff',
    borderRadius: 12,
    padding: 12,
    textAlign: 'left',
    cursor: 'pointer',
    marginBottom: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  seriesBtnActive: {
    borderColor: '#004AC6',
    background: '#EFF6FF',
  },
  seriesCode: {
    fontWeight: 900,
    fontSize: 14,
    color: '#0F172A',
  },
  seriesLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  main: {
    display: 'grid',
    gap: 16,
  },
  card: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 16,
    padding: 18,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  cardTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 900,
  },
  cardTitleSmall: {
    margin: '0 0 12px',
    fontSize: 16,
    fontWeight: 900,
  },
  muted: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
  },
  badgeGreen: {
    background: '#DCFCE7',
    color: '#166534',
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 900,
  },
  badgeRed: {
    background: '#FEE2E2',
    color: '#991B1B',
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 900,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 900,
    color: '#475569',
    margin: '12px 0 6px',
  },
  input: {
    width: '100%',
    border: '1px solid #CBD5E1',
    borderRadius: 10,
    padding: '11px 12px',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    background: '#fff',
  },
  help: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 8,
  },
  warn: {
    color: '#B45309',
    fontSize: 12,
    marginTop: 6,
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 14,
  },
  checkLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 800,
    marginTop: 34,
  },
  previewCard: {
    background: 'linear-gradient(135deg, #0F172A, #1E3A8A)',
    color: '#fff',
    borderRadius: 16,
    padding: 22,
  },
  previewLabel: {
    opacity: 0.8,
    fontSize: 12,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  preview: {
    marginTop: 8,
    fontSize: 34,
    fontWeight: 950,
    letterSpacing: 0.5,
  },
  previewHint: {
    marginTop: 8,
    fontSize: 12,
    opacity: 0.8,
  },
  examples: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
  },
  exampleBtn: {
    border: '1px solid #E2E8F0',
    background: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
};
