'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';

export default function DieListPage() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await api.get('/api/v1/dies/master', { limit: 100 });
    setRows(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: 28, maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Die Master</h1>
          <p style={{ margin: '4px 0', color: '#6B7280', fontSize: 13 }}>{rows.length} records</p>
        </div>
        <button onClick={() => router.push('/masters/dies/new')}
          style={{ height: 36, padding: '0 16px', border: 0, borderRadius: 6, background: '#4F46E5', color: '#fff' }}>
          + New Die
        </button>
      </div>

      <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB' }}>
              {['Code','Name','Cavity','Type','Status','Active'].map(h =>
                <th key={h} style={{ padding: 10, textAlign: 'left' }}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>No dies found.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} onClick={() => router.push(`/masters/dies/${r.id}`)}
                style={{ borderTop: '1px solid #F3F4F6', cursor: 'pointer' }}>
                <td style={{ padding: 10, fontFamily: 'monospace', fontWeight: 700 }}>{r.die_code}</td>
                <td style={{ padding: 10 }}>{r.die_name}</td>
                <td style={{ padding: 10 }}>{r.num_impressions}</td>
                <td style={{ padding: 10 }}>{r.die_type || '—'}</td>
                <td style={{ padding: 10 }}>{r.status}</td>
                <td style={{ padding: 10 }}>{r.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
