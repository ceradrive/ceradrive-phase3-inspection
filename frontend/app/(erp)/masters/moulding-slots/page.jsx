'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';

function total(a,b){ return Number(a?.num_impressions || 0) + Number(b?.num_impressions || 0); }

export default function MouldingSlotsPage() {
  const router = useRouter();
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [activatingId,setActivatingId]=useState(null); // MOUNTUX

  function load(){ // MOUNTUX
    api.get('/api/v1/moulding-slots/master').then(({data})=>{
      setRows(data??[]);
      setLoading(false);
    });
  }
  useEffect(()=>{ load(); },[]);

  async function setMounted(id){ // MOUNTUX
    setActivatingId(id);
    const { error } = await api.patch(`/api/v1/moulding-slots/master/${id}`, { is_active: true });
    setActivatingId(null);
    if (!error) load();
    else alert('Failed to set mounted: ' + (error.message || 'error'));
  }

  const machinesNoActive = (() => { // MOUNTUX
    const byMachine = {};
    for (const r of rows) {
      const code = r.machine?.machine_code || '—';
      if (!(code in byMachine)) byMachine[code] = false;
      if (r.is_active) byMachine[code] = true;
    }
    return Object.keys(byMachine).filter(c => !byMachine[c]);
  })();

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1120 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18 }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontWeight:700, color:'#111827' }}>Moulding Slot Setups</h1>
          <p style={{ margin:'4px 0 0', color:'#6B7280', fontSize:13 }}>{rows.length} records</p>
        </div>
        <button onClick={()=>router.push('/masters/moulding-slots/new')}
          style={{ height:36, padding:'0 16px', border:0, borderRadius:6, background:'#4F46E5', color:'#fff', fontWeight:600 }}>
          + New Setup
        </button>
      </div>

      {machinesNoActive.length > 0 && ( /* MOUNTUX */
        <div style={{ marginBottom:12, padding:'8px 12px', background:'#FEF3C7', color:'#92400E', borderRadius:8, fontSize:12, fontWeight:600 }}>
          ⚠ No mounted (active) setup for: {machinesNoActive.join(', ')}
        </div>
      )}
      <div style={{ border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden', background:'#fff' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:'#F9FAFB', borderBottom:'1px solid #E5E7EB' }}>
              {['Setup Code','Machine','Slot A','Slot B','PCS/Cycle','Cycle Time','24h Capacity','Status','Action'].map(h=>
                <th key={h} style={{ padding:'11px 14px', textAlign:'left', color:'#374151', fontSize:12, fontWeight:700 }}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding:30, textAlign:'center', color:'#9CA3AF' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} style={{ padding:30, textAlign:'center', color:'#9CA3AF' }}>No moulding slot setups found.</td></tr>
            ) : rows.map(r=>{
              const pcs = total(r.slot_a_die,r.slot_b_die);
              const cycle = Number(r.cycle_time_sec || 0);
              const cap24 = cycle > 0 ? Math.floor((86400 / cycle) * pcs) : 0;
              return (
                <tr key={r.id} style={{ borderBottom:'1px solid #F3F4F6' }}>
                  <td style={{ padding:'11px 14px', fontWeight:700, fontFamily:'monospace' }}>{r.setup_code}</td>
                  <td style={{ padding:'11px 14px' }}>{r.machine?.machine_code || '—'}</td>
                  <td style={{ padding:'11px 14px' }}>{r.slot_a_die?.die_code || 'Empty'}</td>
                  <td style={{ padding:'11px 14px' }}>{r.slot_b_die?.die_code || 'Empty'}</td>
                  <td style={{ padding:'11px 14px', fontWeight:700 }}>{pcs}</td>
                  <td style={{ padding:'11px 14px' }}>{r.cycle_time_sec || '—'} sec</td>
                  <td style={{ padding:'11px 14px', fontWeight:700 }}>{cap24 ? `${cap24} pcs/day` : '—'}</td>
                  <td style={{ padding:'11px 14px' }}>{ /* MOUNTUX */
                    r.is_active
                      ? <span style={{ padding:'3px 9px', borderRadius:999, background:'#DCFCE7', color:'#166534', fontWeight:700, fontSize:11 }}>● Mounted</span>
                      : <span style={{ padding:'3px 9px', borderRadius:999, background:'#F3F4F6', color:'#6B7280', fontWeight:700, fontSize:11 }}>Inactive</span>}
                  </td>
                  <td style={{ padding:'11px 14px' }}>{
                    r.is_active
                      ? <span style={{ color:'#9CA3AF', fontSize:12 }}>Currently mounted</span>
                      : <button onClick={()=>setMounted(r.id)} disabled={activatingId===r.id}
                          style={{ height:30, padding:'0 12px', border:'1px solid #4F46E5', borderRadius:6, background:'#fff', color:'#4F46E5', fontWeight:600, fontSize:12, cursor:'pointer' }}>
                          {activatingId===r.id ? 'Setting…' : 'Set as Currently Mounted'}
                        </button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
