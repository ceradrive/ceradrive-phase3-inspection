'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api.js';

const S = {
  page:{ padding:24, background:'#F8FAFC', minHeight:'100vh' },
  title:{ margin:0, fontSize:24, fontWeight:900, color:'#111827' },
  sub:{ margin:'4px 0 18px', color:'#6B7280', fontSize:13 },
  card:{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden' },
  head:{ padding:'12px 16px', background:'#FBFCFE', borderBottom:'1px solid #E5E7EB', fontWeight:900 },
  table:{ width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:{ textAlign:'left', padding:'10px 12px', background:'#F9FAFB', borderBottom:'1px solid #E5E7EB', fontSize:11, color:'#374151', textTransform:'uppercase' },
  td:{ padding:'11px 12px', borderBottom:'1px solid #F1F5F9' },
  btn:{ border:0, background:'#004AC6', color:'#fff', borderRadius:6, padding:'7px 10px', fontSize:12, fontWeight:900, cursor:'pointer' },
  pillRed:{ display:'inline-block', background:'#FEE2E2', color:'#991B1B', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  pillOrange:{ display:'inline-block', background:'#FEF3C7', color:'#92400E', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  pillBlue:{ display:'inline-block', background:'#DBEAFE', color:'#1D4ED8', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
};

export default function PurchaseRequirementsPage(){
  const router = useRouter();
  const [rows,setRows] = useState([]);
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    api.get('/api/v1/purchase-requirements')
      .then(({data})=>setRows(data || []))
      .finally(()=>setLoading(false));
  },[]);

  function statusStyle(status){
    if (String(status).toLowerCase() === 'draft') return S.pillBlue;
    return S.pillOrange;
  }

  return (
    <div style={S.page}>
      <h1 style={S.title}>Purchase Requirements</h1>
      <div style={S.sub}>Draft purchase requirements generated from production material shortages.</div>

      <section style={S.card}>
        <div style={S.head}>Requirement List</div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>PR No</th>
              <th style={S.th}>Source</th>
              <th style={S.th}>Material</th>
              <th style={S.th}>Shortage Lines</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Created</th>
              <th style={S.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={S.td} colSpan={7}>Loading...</td></tr>
            ) : rows.length ? rows.map((r)=>(
              <tr key={r.id}>
                <td style={S.td}><b>{r.pr_no}</b></td>
                <td style={S.td}>{r.source_type}</td>
                <td style={S.td}>
                  <span style={r.material_status === 'SHORTAGE' ? S.pillRed : S.pillBlue}>
                    {r.material_status || '-'}
                  </span>
                </td>
                <td style={S.td}>{r.shortage_count}</td>
                <td style={S.td}><span style={statusStyle(r.status)}>{r.status}</span></td>
                <td style={S.td}>{r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</td>
                <td style={S.td}>
                  <button style={S.btn} onClick={()=>router.push(`/purchase-requirements/${r.id}`)}>
                    Open
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td style={S.td} colSpan={7}>No purchase requirements yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
