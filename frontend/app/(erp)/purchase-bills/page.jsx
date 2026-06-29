'use client';

/**
 * CERADRIVE ERP — Purchase Bill List (PB-1C)
 * Read-only list of Purchase Bills. Clones the Purchase Order list conventions.
 * Source: GET /api/v1/purchase-bills?limit=100  -> { data: [...] }.
 * No create here (bills are created from a posted GRN). No approve/edit/cancel.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api.js';

const S = {
  page:{ padding:24, background:'#F8FAFC', minHeight:'100vh' },
  title:{ margin:0, fontSize:24, fontWeight:900, color:'#111827' },
  sub:{ margin:'4px 0 18px', color:'#6B7280', fontSize:13 },
  card:{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden' },
  head:{ padding:'12px 16px', background:'#FBFCFE', borderBottom:'1px solid #E5E7EB', fontWeight:900, display:'flex', justifyContent:'space-between', alignItems:'center' },
  table:{ width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:{ textAlign:'left', padding:'10px 12px', background:'#F9FAFB', borderBottom:'1px solid #E5E7EB', fontSize:11, color:'#374151', textTransform:'uppercase' },
  td:{ padding:'11px 12px', borderBottom:'1px solid #F1F5F9', verticalAlign:'middle' },
  tdR:{ padding:'11px 12px', borderBottom:'1px solid #F1F5F9', textAlign:'right', verticalAlign:'middle' },
  link:{ border:0, background:'transparent', color:'#004AC6', fontWeight:900, cursor:'pointer', fontSize:'inherit', padding:0 },
  btn:{ border:0, background:'#004AC6', color:'#fff', borderRadius:6, padding:'7px 10px', fontSize:12, fontWeight:900, cursor:'pointer' },
  muted:{ color:'#6B7280', fontSize:12 },
};

function statusPill(status){
  const base = { display:'inline-block', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900, textTransform:'capitalize' };
  switch (status) {
    case 'approved':  return { ...base, background:'#DCFCE7', color:'#166534' };
    case 'cancelled': return { ...base, background:'#FEE2E2', color:'#991B1B' };
    default:          return { ...base, background:'#DBEAFE', color:'#1D4ED8' }; // draft
  }
}

function fmtMoney(v){
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PurchaseBillsPage(){
  const router = useRouter();
  const [rows,setRows] = useState([]);
  const [loading,setLoading] = useState(true);

  async function load(){
    setLoading(true);
    const { data } = await api.get('/api/v1/purchase-bills?limit=100');
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(()=>{ load(); },[]);

  return (
    <div style={S.page}>
      <h1 style={S.title}>Purchase Bills</h1>
      <div style={S.sub}>Supplier bills raised from posted goods receipts. Read-only.</div>

      <section style={S.card}>
        <div style={S.head}>
          <span>Purchase Bill List</span>
        </div>

        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Bill Number</th>
              <th style={S.th}>Supplier</th>
              <th style={S.th}>GRN</th>
              <th style={S.th}>PO</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Bill Date</th>
              <th style={S.th}>Total</th>
              <th style={S.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={S.td} colSpan={8}>Loading...</td></tr>
            ) : rows.length ? rows.map((b)=>(
              <tr key={b.id}>
                <td style={S.td}>
                  <button style={S.link} onClick={()=>router.push(`/purchase-bills/${b.id}`)}>
                    {b.bill_number}
                  </button>
                </td>
                <td style={S.td}><b>{b.supplier_master?.supplier_name || '-'}</b></td>
                <td style={S.td}>{b.grn_headers?.grn_number || '-'}</td>
                <td style={S.td}>{b.purchase_orders?.po_number || '-'}</td>
                <td style={S.td}><span style={statusPill(b.status)}>{b.status}</span></td>
                <td style={S.td}>{b.bill_date || '-'}</td>
                <td style={S.tdR}>{fmtMoney(b.grand_total)}</td>
                <td style={S.td}>
                  <button style={S.btn} onClick={()=>router.push(`/purchase-bills/${b.id}`)}>View</button>
                </td>
              </tr>
            )) : (
              <tr><td style={S.td} colSpan={8}>No Purchase Bills found.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
