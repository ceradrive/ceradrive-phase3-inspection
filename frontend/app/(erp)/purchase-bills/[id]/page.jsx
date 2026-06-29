'use client';

/**
 * CERADRIVE ERP — Purchase Bill Detail (PB-1C)
 * Read-only. Header (bill number, supplier, GRN, PO, status, invoice no, date) +
 * lines (item, uom, qty, unit rate, line total) + totals (subtotal, tax, grand total).
 * Source: GET /api/v1/purchase-bills/:id -> header + lines (PB-1 getBillById shape).
 * No approve / edit / cancel / payment / AP ledger. Clones PO detail conventions.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';

const S = {
  page:{ padding:24, background:'#F8FAFC', minHeight:'100vh' },
  back:{ border:'1px solid #D1D5DB', background:'#fff', borderRadius:6, padding:'7px 10px', fontSize:12, fontWeight:900, cursor:'pointer', marginBottom:14 },
  approveBtn:{ border:0, background:'#004AC6', color:'#fff', borderRadius:8, padding:'10px 14px', fontSize:13, fontWeight:900, cursor:'pointer' },
  approveBtnDisabled:{ border:0, background:'#93A9D9', color:'#fff', borderRadius:8, padding:'10px 14px', fontSize:13, fontWeight:900, cursor:'not-allowed' },
  title:{ margin:0, fontSize:24, fontWeight:900, color:'#111827' },
  sub:{ margin:'4px 0 18px', color:'#6B7280', fontSize:13 },
  cards:{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:14 },
  card:{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, padding:14 },
  label:{ fontSize:11, color:'#6B7280', fontWeight:900, textTransform:'uppercase' },
  val:{ marginTop:5, fontSize:18, fontWeight:900, color:'#111827' },
  valSm:{ marginTop:5, fontSize:14, fontWeight:700, color:'#111827' },
  panel:{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden', marginBottom:14 },
  head:{ padding:'12px 16px', background:'#FBFCFE', borderBottom:'1px solid #E5E7EB', fontWeight:900, display:'flex', justifyContent:'space-between', alignItems:'center' },
  table:{ width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:{ textAlign:'left', padding:'10px 12px', background:'#F9FAFB', borderBottom:'1px solid #E5E7EB', fontSize:11, color:'#374151', textTransform:'uppercase' },
  thR:{ textAlign:'right', padding:'10px 12px', background:'#F9FAFB', borderBottom:'1px solid #E5E7EB', fontSize:11, color:'#374151', textTransform:'uppercase' },
  td:{ padding:'11px 12px', borderBottom:'1px solid #F1F5F9', verticalAlign:'middle' },
  tdR:{ padding:'11px 12px', borderBottom:'1px solid #F1F5F9', textAlign:'right', verticalAlign:'middle' },
  totRow:{ display:'flex', justifyContent:'flex-end', gap:40, padding:'10px 16px', borderTop:'1px solid #F1F5F9' },
  totLabel:{ fontSize:12, color:'#6B7280', fontWeight:900, textTransform:'uppercase' },
  totVal:{ fontSize:14, fontWeight:900, color:'#111827', minWidth:120, textAlign:'right' },
};

function statusPill(status){
  const base = { display:'inline-block', borderRadius:999, padding:'4px 10px', fontSize:12, fontWeight:900, textTransform:'capitalize' };
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
function fmtQty(v){
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-IN');
}
function lineItem(l){
  const code = l.item_master?.item_code ?? l.item_code;
  const name = l.item_master?.item_name ?? l.item_name;
  if (code && name) return `${code} — ${name}`;
  return code ?? name ?? (l.item_id ? String(l.item_id) : '—');
}

export default function PurchaseBillDetailPage(){
  const params = useParams();
  const router = useRouter();
  const [bill,setBill] = useState(null);
  const [loading,setLoading] = useState(true);
  const [notFound,setNotFound] = useState(false);
  const [approving,setApproving] = useState(false);

  useEffect(()=>{
    async function load(){
      setLoading(true);
      const { data, error } = await api.get(`/api/v1/purchase-bills/${params.id}`);
      if (error || !data) { setBill(null); setNotFound(true); setLoading(false); return; }
      setBill(data);
      setLoading(false);
    }
    load();
  },[params.id]);

  async function approveBill(){
    if (!bill?.id || bill.status !== 'draft' || approving) return;
    const ok = window.confirm(`Approve ${bill.bill_number}? This is status-only; no AP ledger/payment entry will be posted.`);
    if (!ok) return;
    setApproving(true);
    const { data, error } = await api.post(`/api/v1/purchase-bills/${bill.id}/approve`, {});
    setApproving(false);
    if (error) {
      alert(error.message || 'Failed to approve Purchase Bill.');
      return;
    }
    setBill(data);
  }

  if (loading) {
    return <div style={{ padding:40, textAlign:'center', color:'#9CA3AF', fontSize:13 }}>Loading purchase bill…</div>;
  }
  if (notFound || !bill) {
    return (
      <div style={{ padding:40, textAlign:'center' }}>
        <div style={{ fontSize:14, color:'#374151', marginBottom:12 }}>Purchase Bill not found.</div>
        <button onClick={()=>router.push('/purchase-bills')} style={S.back}>Back to Purchase Bills</button>
      </div>
    );
  }

  const lines = bill.lines ?? [];

  return (
    <div style={S.page}>
      <button onClick={()=>router.push('/purchase-bills')} style={S.back}>‹ Back</button>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <h1 style={S.title}>{bill.bill_number || 'Purchase Bill'}</h1>
          <span style={statusPill(bill.status)}>{bill.status}</span>
        </div>
        {bill.status === 'draft' ? (
          <button
            onClick={approveBill}
            disabled={approving}
            style={approving ? S.approveBtnDisabled : S.approveBtn}
          >
            {approving ? 'Approving…' : 'Approve Bill'}
          </button>
        ) : null}
      </div>
      <div style={S.sub}>Raised from a posted goods receipt. Approval is status-only; no AP ledger is posted yet.</div>

      {/* Summary cards */}
      <div style={S.cards}>
        <div style={S.card}>
          <div style={S.label}>Supplier</div>
          <div style={S.valSm}>{bill.supplier_master?.supplier_name || '—'}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>GRN</div>
          <div style={S.valSm}>{bill.grn_headers?.grn_number || '—'}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>PO</div>
          <div style={S.valSm}>{bill.purchase_orders?.po_number || '—'}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Grand Total</div>
          <div style={S.val}>{fmtMoney(bill.grand_total)}</div>
        </div>
      </div>

      {/* Header detail */}
      <div style={S.cards}>
        <div style={S.card}>
          <div style={S.label}>Bill Date</div>
          <div style={S.valSm}>{bill.bill_date || '—'}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Supplier Invoice No</div>
          <div style={S.valSm}>{bill.supplier_invoice_no || '—'}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Subtotal</div>
          <div style={S.valSm}>{fmtMoney(bill.subtotal)}</div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Tax Total</div>
          <div style={S.valSm}>{fmtMoney(bill.tax_total)}</div>
        </div>
      </div>

      {/* Lines */}
      <section style={S.panel}>
        <div style={S.head}><span>Bill Lines</span></div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>#</th>
              <th style={S.th}>Item</th>
              <th style={S.th}>UOM</th>
              <th style={S.thR}>Qty</th>
              <th style={S.thR}>Unit Rate</th>
              <th style={S.thR}>Tax</th>
              <th style={S.thR}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.length ? lines.map((l, idx)=>(
              <tr key={l.id ?? idx}>
                <td style={S.td}>{l.line_number ?? idx + 1}</td>
                <td style={S.td}>{lineItem(l)}</td>
                <td style={S.td}>{l.uom_master?.uom_code || '—'}</td>
                <td style={S.tdR}>{fmtQty(l.qty)}</td>
                <td style={S.tdR}>{fmtMoney(l.unit_rate)}</td>
                <td style={S.tdR}>{fmtMoney(l.tax_amount)}</td>
                <td style={S.tdR}>{fmtMoney(l.line_total)}</td>
              </tr>
            )) : (
              <tr><td style={S.td} colSpan={7}>No lines on this bill.</td></tr>
            )}
          </tbody>
        </table>
        <div style={S.totRow}>
          <span style={S.totLabel}>Subtotal</span><span style={S.totVal}>{fmtMoney(bill.subtotal)}</span>
        </div>
        <div style={S.totRow}>
          <span style={S.totLabel}>Tax Total</span><span style={S.totVal}>{fmtMoney(bill.tax_total)}</span>
        </div>
        <div style={S.totRow}>
          <span style={S.totLabel}>Grand Total</span><span style={S.totVal}>{fmtMoney(bill.grand_total)}</span>
        </div>
      </section>
    </div>
  );
}
