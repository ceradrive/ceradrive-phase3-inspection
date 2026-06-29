'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';

export default function MaterialAvailabilityPage() {
  const [requirements, setRequirements] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/api/v1/production-requirements/queue').then(({ data }) => {
      setRequirements(data ?? []);
      if (data?.[0]?.id) setSelectedId(data[0].id);
    });
  }, []);

  async function check() {
    const { data, error } = await api.get(`/api/v1/material-availability/requirement/${selectedId}`);
    if (error) { alert(error.message || 'Failed'); return; }
    setResult(data);
  }

  return (
    <div style={{ padding: 28, maxWidth: 1100 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Material Availability Check</h1>
      <p style={{ color: '#6B7280', fontSize: 13 }}>Check required inputs against current stock.</p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ height: 36, minWidth: 360 }}>
          <option value="">Select requirement</option>
          {requirements.map(r => <option key={r.id} value={r.id}>{r.item?.item_code} — {r.required_qty} {r.uom?.uom_code}</option>)}
        </select>
        <button onClick={check} disabled={!selectedId}>Check</button>
      </div>

      {result && (
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {['Input Item', 'Required', 'Available', 'Shortage', 'Status'].map(h =>
                  <th key={h} style={{ padding: 11, textAlign: 'left' }}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {result.lines.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: '#9CA3AF' }}>No recipe inputs found.</td></tr>
              ) : result.lines.map((l, i) => (
                <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <td style={{ padding: 11, fontWeight: 700 }}>{l.item_code} — {l.item_name}</td>
                  <td style={{ padding: 11 }}>{l.required_qty} {l.required_uom}</td>
                  <td style={{ padding: 11 }}>{l.available_qty} {l.required_uom}</td>
                  <td style={{ padding: 11 }}>{l.shortage_qty} {l.required_uom}</td>
                  <td style={{ padding: 11, fontWeight: 700, color: l.status === 'short' ? '#DC2626' : '#059669' }}>{l.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
