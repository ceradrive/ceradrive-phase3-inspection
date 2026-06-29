'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';

export default function ProductionRequirementsPage() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get('/api/v1/production-requirements/queue').then(({ data }) => setRows(data ?? []));
  }, []);

  return (
    <div style={{ padding: 28, maxWidth: 1100 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Production Requirement Queue</h1>
      <p style={{ color: '#6B7280', fontSize: 13 }}>Demand waiting for production planning.</p>

      <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB' }}>
              {['Item', 'Required Qty', 'Due Date', 'Priority', 'Status', 'Source'].map(h =>
                <th key={h} style={{ padding: 11, textAlign: 'left' }}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: '#9CA3AF' }}>No requirements found.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={{ padding: 11, fontWeight: 700 }}>{r.item?.item_code} — {r.item?.item_name}</td>
                <td style={{ padding: 11 }}>{r.required_qty} {r.uom?.uom_code}</td>
                <td style={{ padding: 11 }}>{r.due_date || '—'}</td>
                <td style={{ padding: 11 }}>{r.priority}</td>
                <td style={{ padding: 11 }}>{r.status}</td>
                <td style={{ padding: 11 }}>{r.source_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
