'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';

export default function ProductionPlanOrdersPage(){
  const router = useRouter();
  const [rows,setRows] = useState([]);
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    api.get('/api/v1/production-plan-orders')
      .then(res=>{
        if(res.error) alert(res.error.message || 'Failed to load PPOs.');
        else setRows(res.data || []);
      })
      .finally(()=>setLoading(false));
  },[]);

  if(loading) return <div style={S.page}>Loading PPOs...</div>;

  return (
    <div style={S.page}>
      <h1 style={S.title}>Production Plan Orders</h1>
      <div style={S.sub}>Main PPO documents created from Press Planner.</div>

      <section style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              {['PPO No','Plan','Material','Press','Execution','Items','PCS','Created'].map(h=>(
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r=>(
              <tr key={r.id} style={S.tr} onClick={()=>router.push(`/production-plan-orders/${r.id}`)}>
                <td style={S.td}><button style={S.link}>{r.ppo_number}</button></td>
                <td style={S.td}>{r.plan_status}</td>
                <td style={S.td}>{r.material_status}</td>
                <td style={S.td}>{r.press_status}</td>
                <td style={S.td}>{r.execution_status}</td>
                <td style={S.td}>{r.total_items}</td>
                <td style={S.td}>{Number(r.total_qty_pcs || 0).toLocaleString()}</td>
                <td style={S.td}>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td style={S.empty} colSpan={8}>No PPO created yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const S = {
  page:{padding:24,background:'#F7F9FC',minHeight:'100vh',fontFamily:'Inter,system-ui',color:'#0F172A'},
  title:{margin:0,fontSize:28,fontWeight:950},
  sub:{margin:'6px 0 18px',color:'#64748B',fontSize:14},
  card:{background:'#fff',border:'1px solid #E2E8F0',borderRadius:16,overflow:'hidden'},
  table:{width:'100%',borderCollapse:'collapse'},
  th:{textAlign:'left',fontSize:12,color:'#64748B',padding:'12px 14px',borderBottom:'1px solid #E2E8F0',background:'#F8FAFC'},
  td:{fontSize:13,padding:'12px 14px',borderBottom:'1px solid #EEF2F7'},
  tr:{cursor:'pointer'},
  link:{border:0,background:'transparent',color:'#004AC6',fontWeight:900,cursor:'pointer'},
  empty:{padding:24,textAlign:'center',color:'#64748B'},
};
