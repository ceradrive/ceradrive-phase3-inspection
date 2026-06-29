'use client';

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
  poLink:{ border:0, background:'transparent', color:'#004AC6', fontWeight:900, cursor:'pointer', fontSize:'inherit', padding:0 },
  btn:{ border:0, background:'#004AC6', color:'#fff', borderRadius:6, padding:'7px 10px', fontSize:12, fontWeight:900, cursor:'pointer' },
  btn2:{ border:'1px solid #D1D5DB', background:'#fff', color:'#111827', borderRadius:6, padding:'7px 10px', fontSize:12, fontWeight:900, cursor:'pointer' },
  pillBlue:{ display:'inline-block', background:'#DBEAFE', color:'#1D4ED8', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  pillGreen:{ display:'inline-block', background:'#DCFCE7', color:'#166534', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  pillOrange:{ display:'inline-block', background:'#FEF3C7', color:'#92400E', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  muted:{ color:'#6B7280', fontSize:12 },
};

export default function PurchaseOrdersPage(){
  const router = useRouter();
  const [rows,setRows] = useState([]);
  const [loading,setLoading] = useState(true);

  async function load(){
    setLoading(true);
    const { data } = await api.get('/api/v1/purchase-orders?limit=100');
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(()=>{ load(); },[]);

  function receiptStatus(po){
    return po.v_po_receipt_summary?.derived_receipt_status || po.derived_receipt_status || 'pending';
  }

  function sourceLabel(po){
    if (po.source_type === 'PURCHASE_REQUIREMENT' && po.source_ref_id) return 'Purchase Requirement';
    return 'Manual / Direct';
  }

  function sourceAction(po){
    if (po.source_type === 'PURCHASE_REQUIREMENT' && po.source_ref_id) {
      return (
        <button
          style={S.btn2}
          onClick={()=>router.push(`/purchase-requirements/${po.source_ref_id}`)}
        >
          Open PR
        </button>
      );
    }

    return <span style={S.muted}>—</span>;
  }

  return (
    <div style={S.page}>
      <h1 style={S.title}>Purchase Orders</h1>
      <div style={S.sub}>Draft and approved purchase orders, including PO source tracking.</div>

      <section style={S.card}>
        <div style={S.head}>
          <span>Purchase Order List</span>
          <button style={S.btn} onClick={()=>router.push('/purchase-orders/new')}>New PO</button>
        </div>

        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>PO Number</th>
              <th style={S.th}>Supplier</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Receipt</th>
              <th style={S.th}>Source</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Total</th>
              <th style={S.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={S.td} colSpan={8}>Loading...</td></tr>
            ) : rows.length ? rows.map((po)=>(
              <tr key={po.id}>
                <td style={S.td}>
                  <button style={S.poLink} onClick={()=>router.push(`/purchase-orders/${po.id}`)}>
                    {po.po_number}
                  </button>
                </td>
                <td style={S.td}>
                  <b>{po.supplier_master?.supplier_name || po.supplier_name || '-'}</b>
                </td>
                <td style={S.td}><span style={S.pillBlue}>{po.status}</span></td>
                <td style={S.td}><span style={S.pillGreen}>{receiptStatus(po)}</span></td>
                <td style={S.td}>
                  <div>{sourceLabel(po)}</div>
                  <div style={{marginTop:5}}>{sourceAction(po)}</div>
                </td>
                <td style={S.td}>{po.po_date || '-'}</td>
                <td style={S.tdR}>{po.total_amount || po.grand_total || '-'}</td>
                <td style={S.td}>
                  <button style={S.btn} onClick={()=>router.push(`/purchase-orders/${po.id}`)}>
                    View
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td style={S.td} colSpan={8}>No Purchase Orders found.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
