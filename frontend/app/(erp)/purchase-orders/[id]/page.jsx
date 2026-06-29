'use client';

// GRN2A-RECEIPT: PO detail receipt display — per-line Ordered/Received/Pending/Status
// columns + PO header receipt summary (derived_receipt_status, totals). Reads the
// existing v_po_line_receipt_state already merged on each line + GET
// /api/v1/purchase-orders/:id/receipt-status for the header summary. Display-only.
//
// GRN2B-NEXT: GRN buttons now reflect receipt state — Open Draft GRN + Post when a
// draft exists; Create Next GRN (pending-only) when pending remains; hidden when
// full/over-received. No posting/inventory here; create uses the existing endpoint.
//
// POSHORTCLOSE: adds Close Short (reason modal) when approved + pending; blocks if an
// open draft GRN exists; shows the close reason after; receipt history stays visible.

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';

const S = {
  page:{ padding:24, background:'#F8FAFC', minHeight:'100vh' },
  back:{ border:'1px solid #D1D5DB', background:'#fff', borderRadius:6, padding:'7px 10px', fontSize:12, fontWeight:900, cursor:'pointer', marginBottom:14 },
  title:{ margin:0, fontSize:24, fontWeight:900, color:'#111827' },
  sub:{ margin:'4px 0 18px', color:'#6B7280', fontSize:13 },
  cards:{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:14 },
  card:{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, padding:14 },
  label:{ fontSize:11, color:'#6B7280', fontWeight:900, textTransform:'uppercase' },
  val:{ marginTop:5, fontSize:18, fontWeight:900 },
  panel:{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden', marginBottom:14 },
  head:{ padding:'12px 16px', background:'#FBFCFE', borderBottom:'1px solid #E5E7EB', fontWeight:900, display:'flex', justifyContent:'space-between', alignItems:'center' },
  table:{ width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:{ textAlign:'left', padding:'10px 12px', background:'#F9FAFB', borderBottom:'1px solid #E5E7EB', fontSize:11, color:'#374151', textTransform:'uppercase' },
  td:{ padding:'11px 12px', borderBottom:'1px solid #F1F5F9', verticalAlign:'middle' },
  tdR:{ padding:'11px 12px', borderBottom:'1px solid #F1F5F9', textAlign:'right', verticalAlign:'middle' },
  pill:{ display:'inline-block', background:'#DBEAFE', color:'#1D4ED8', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  pillGreen:{ display:'inline-block', background:'#DCFCE7', color:'#166534', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  linkBtn:{ border:'1px solid #004AC6', background:'#EFF6FF', color:'#004AC6', borderRadius:6, padding:'7px 10px', fontSize:12, fontWeight:900, cursor:'pointer' },
  approveBtn:{ border:0, background:'#16A34A', color:'#fff', borderRadius:6, padding:'8px 12px', fontSize:12, fontWeight:900, cursor:'pointer', marginLeft:8 },
  grnBtn:{ border:0, background:'#7C3AED', color:'#fff', borderRadius:6, padding:'8px 12px', fontSize:12, fontWeight:900, cursor:'pointer', marginLeft:8 },
  postGrnBtn:{ border:0, background:'#EA580C', color:'#fff', borderRadius:6, padding:'8px 12px', fontSize:12, fontWeight:900, cursor:'pointer', marginLeft:8 },
  closeBtn:{ border:0, background:'#B45309', color:'#fff', borderRadius:6, padding:'8px 12px', fontSize:12, fontWeight:900, cursor:'pointer', marginLeft:8 },           // POSHORTCLOSE
  closeBlocked:{ display:'inline-block', background:'#F3F4F6', color:'#9CA3AF', borderRadius:6, padding:'8px 12px', fontSize:12, fontWeight:900, marginLeft:8 },
};

function getLines(data){
  return data?.lines || data?.po_lines || [];
}

// GRN2A-RECEIPT — colour a receipt status chip by state.
function receiptChipStyle(state){
  const base = { display:'inline-block', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900, textTransform:'capitalize' };
  switch (state) {
    case 'full':    return { ...base, background:'#DCFCE7', color:'#166534' };
    case 'partial': return { ...base, background:'#FEF3C7', color:'#92400E' };
    case 'excess':  return { ...base, background:'#FEE2E2', color:'#991B1B' };
    default:        return { ...base, background:'#F3F4F6', color:'#374151' }; // no_receipt / pending
  }
}

export default function PurchaseOrderDetailPage(){
  const params = useParams();
  const router = useRouter();
  const [data,setData] = useState(null);
  const [sourcePr,setSourcePr] = useState(null);
  const [loading,setLoading] = useState(true);
  const [approving,setApproving] = useState(false);
  const [creatingGrn,setCreatingGrn] = useState(false);
  const [postingGrn,setPostingGrn] = useState(false);
  const [receipt,setReceipt] = useState(null);   // GRN2A-RECEIPT: GET /:id/receipt-status
  const [showClose,setShowClose]     = useState(false);   // POSHORTCLOSE
  const [closeReason,setCloseReason] = useState('');
  const [closing,setClosing]         = useState(false);

  useEffect(()=>{
    async function load(){
      setLoading(true);
      const { data: poData } = await api.get(`/api/v1/purchase-orders/${params.id}`);
      setData(poData);

      // GRN2A-RECEIPT — header receipt summary (derived_receipt_status + totals).
      try {
        const { data: rsData } = await api.get(`/api/v1/purchase-orders/${params.id}/receipt-status`);
        setReceipt(rsData || null);
      } catch { setReceipt(null); }

      if (poData?.source_type === 'PURCHASE_REQUIREMENT' && poData?.source_ref_id) {
        try {
          const { data: prData } = await api.get(`/api/v1/purchase-requirements/${poData.source_ref_id}`);
          setSourcePr(prData?.header || null);
        } catch {
          setSourcePr(null);
        }
      }

      setLoading(false);
    }

    load();
  },[params.id]);

  async function approvePO(){
    if (!confirm('Approve this Purchase Order?')) return;

    try {
      setApproving(true);
      await api.post(`/api/v1/purchase-orders/${params.id}/approve`, {});
      const { data: poData } = await api.get(`/api/v1/purchase-orders/${params.id}`);
      setData(poData);
      alert('Purchase Order approved.');
    } catch (err) {
      console.error(err);
      alert('Failed to approve Purchase Order.');
    } finally {
      setApproving(false);
    }
  }

  async function createDraftGRN(){
    const supplierChallan = prompt('Supplier challan no?', `CH-${data.po_number}`);
    if (supplierChallan === null) return;

    const supplierInvoice = prompt('Supplier invoice no?', `INV-${data.po_number}`);
    if (supplierInvoice === null) return;

    try {
      setCreatingGrn(true);
      const { data: grnData } = await api.post(`/api/v1/purchase-orders/${params.id}/create-grn`, {
        warehouse_id: '55c1378c-4cb4-4718-829c-7ed414c86fee',
        supplier_challan: supplierChallan,
        supplier_invoice: supplierInvoice,
        notes: `Draft GRN created from ${data.po_number}`,
      });

      alert(`Draft GRN created: ${grnData?.grn_number || grnData?.header?.grn_number || 'Created'}`);
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.error?.message || 'Failed to create Draft GRN.');
    } finally {
      setCreatingGrn(false);
    }
  }

  async function postDraftGRN(){
    if (!confirm('Post draft GRN and update inventory?')) return;

    try {
      setPostingGrn(true);
      await api.post(`/api/v1/purchase-orders/${params.id}/post-grn`, {});
      alert('GRN posted. Inventory updated.');
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.error?.message || 'Failed to post GRN.');
    } finally {
      setPostingGrn(false);
    }
  }

  // POSHORTCLOSE — close PO short with a mandatory reason. No inventory posting.
  async function closePO(){
    if (closeReason.trim().length < 5) { alert('Reason must be at least 5 characters.'); return; }
    try {
      setClosing(true);
      await api.post(`/api/v1/purchase-orders/${params.id}/close`, { confirm_short_close: true, reason: closeReason.trim() });
      setShowClose(false);
      alert('Purchase Order closed short.');
      const { data: poData } = await api.get(`/api/v1/purchase-orders/${params.id}`);
      setData(poData);
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.error?.message || 'Failed to close short.');
    } finally {
      setClosing(false);
    }
  }

  if (loading) return <div style={S.page}>Loading...</div>;

  if (!data?.id) {
    return (
      <div style={S.page}>
        <button style={S.back} onClick={()=>router.push('/purchase-orders')}>← Back</button>
        Purchase Order not found.
      </div>
    );
  }

  const lines = getLines(data);
  const supplier = data.supplier_master || {};
  const total = lines.reduce((sum,l)=>sum + Number(l.line_total || 0), 0);

  // GRN2A-RECEIPT — header receipt summary (total_pending derived; view has no such column).
  const rsum      = receipt?.summary || null;
  const tOrdered  = Number(rsum?.total_ordered  ?? 0);
  const tReceived = Number(rsum?.total_received ?? 0);
  const tPending  = Math.max(tOrdered - tReceived, 0);
  const drs       = rsum?.derived_receipt_status || 'no_receipt';

  // GRN2B-NEXT — GRN button state from data already loaded (linked_grns + line pending).
  const openDraft  = (data.linked_grns || []).find((g) => g.status === 'draft') || null;
  const hasAnyGrn  = (data.linked_grns || []).length > 0;
  const pendingQty = lines.reduce((s, l) => s + Math.max(Number(l.v_po_line_receipt_state?.pending_qty ?? l.ordered_qty), 0), 0);
  const anyExcess  = drs === 'excess' || lines.some((l) => l.v_po_line_receipt_state?.receipt_state === 'excess');
  const canCreate  = !openDraft && pendingQty > 0 && !anyExcess;

  return (
    <div style={S.page}>
      <button style={S.back} onClick={()=>router.push('/purchase-orders')}>← Back</button>

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <div>
          <h1 style={S.title}>{data.po_number}</h1>
          <div style={S.sub}>Purchase Order detail and source tracking.</div>
        </div>

        <div>
          {data.status === 'draft' && (
            <button style={S.approveBtn} onClick={approvePO} disabled={approving}>
              {approving ? 'Approving...' : 'Approve PO'}
            </button>
          )}

          {data.status === 'approved' && (
            openDraft ? (
              <>
                <button style={S.grnBtn} onClick={()=>router.push(`/grns/${openDraft.id}`)}>
                  Open Draft GRN
                </button>
                <button style={S.postGrnBtn} onClick={postDraftGRN} disabled={postingGrn}>
                  {postingGrn ? 'Posting GRN...' : 'Post Draft GRN'}
                </button>
              </>
            ) : anyExcess ? (
              <span style={{ ...S.pill, background:'#FEE2E2', color:'#991B1B' }}>Over-received — no further GRN</span>
            ) : canCreate ? (
              <button style={S.grnBtn} onClick={createDraftGRN} disabled={creatingGrn}>
                {creatingGrn ? 'Creating GRN...' : (hasAnyGrn ? 'Create Next GRN' : 'Create Draft GRN')}
              </button>
            ) : (
              <span style={{ ...S.pill, background:'#DCFCE7', color:'#166534' }}>Fully received</span>
            )
          )}

          {/* POSHORTCLOSE — Close Short (only when approved + pending remains) */}
          {data.status === 'approved' && pendingQty > 0 && (
            openDraft
              ? <span style={S.closeBlocked} title="Resolve the open draft GRN first">Close Short — resolve draft GRN first</span>
              : <button style={S.closeBtn} onClick={()=>{ setCloseReason(''); setShowClose(true); }}>Close Short</button>
          )}
        </div>
      </div>

      <div style={S.cards}>
        <div style={S.card}><div style={S.label}>Status</div><div style={S.val}><span style={S.pill}>{data.status}</span></div></div>
        <div style={S.card}><div style={S.label}>Supplier</div><div style={S.val}>{supplier.supplier_name || '-'}</div></div>
        <div style={S.card}><div style={S.label}>PO Date</div><div style={S.val}>{data.po_date || '-'}</div></div>
        <div style={S.card}><div style={S.label}>Total</div><div style={S.val}>{total.toFixed(2)}</div></div>
      </div>

      {/* POSHORTCLOSE — closed-short banner */}
      {data.status === 'closed' && data.short_close_reason && (
        <div style={{ background:'#FEF3C7', border:'1px solid #FDE68A', color:'#92400E', borderRadius:10, padding:'12px 14px', marginBottom:14, fontSize:13, fontWeight:700 }}>
          Closed short — reason: <span style={{ fontWeight:500 }}>{data.short_close_reason}</span>
        </div>
      )}

      {data.source_type === 'PURCHASE_REQUIREMENT' && (
        <section style={S.panel}>
          <div style={S.head}>
            <span>Source Purchase Requirement</span>
            <button
              style={S.linkBtn}
              onClick={()=>router.push(`/purchase-requirements/${data.source_ref_id}`)}
            >
              Open {sourcePr?.pr_no || 'Source PR'}
            </button>
          </div>
          <div style={{padding:14}}>
            <span style={S.pill}>PURCHASE REQUIREMENT</span>
            <span style={{marginLeft:10}}>{sourcePr?.pr_no || data.source_ref_id}</span>
          </div>
        </section>
      )}

      {/* GRN2A-RECEIPT — PO header receipt summary */}
      <section style={S.panel}>
        <div style={S.head}>
          <span>Receipt Summary</span>
          <span style={receiptChipStyle(drs)}>{drs}</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, padding:14 }}>
          <div><div style={S.label}>Receipt Status</div><div style={S.val}><span style={receiptChipStyle(drs)}>{drs}</span></div></div>
          <div><div style={S.label}>Total Ordered</div><div style={S.val}>{tOrdered}</div></div>
          <div><div style={S.label}>Total Received</div><div style={S.val}>{tReceived}</div></div>
          <div><div style={S.label}>Total Pending</div><div style={S.val}>{tPending}</div></div>
        </div>
      </section>

      <section style={S.panel}>
        <div style={S.head}>PO Lines</div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Line</th>
              <th style={S.th}>Item</th>
              <th style={S.th}>Ordered</th>
              <th style={S.th}>Received</th>
              <th style={S.th}>Pending</th>
              <th style={S.th}>UOM</th>
              <th style={S.th}>Rate</th>
              <th style={S.th}>Amount</th>
              <th style={S.th}>Total</th>
              <th style={S.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.length ? lines.map((l)=>(
              <tr key={l.id}>
                <td style={S.td}>{l.line_number}</td>
                <td style={S.td}>
                  <b>{l.item_master?.item_code || '-'}</b><br/>
                  <span style={{color:'#6B7280'}}>{l.item_master?.item_name || ''}</span>
                </td>
                <td style={S.tdR}>{l.ordered_qty}</td>
                <td style={S.tdR}>{l.v_po_line_receipt_state?.received_qty ?? 0}</td>
                <td style={S.tdR}>{l.v_po_line_receipt_state?.pending_qty ?? l.ordered_qty}</td>
                <td style={S.td}>{l.uom_master?.uom_code || '-'}</td>
                <td style={S.tdR}>{l.unit_rate}</td>
                <td style={S.tdR}>{l.line_amount}</td>
                <td style={S.tdR}><b>{l.line_total}</b></td>
                <td style={S.td}><span style={receiptChipStyle(l.v_po_line_receipt_state?.receipt_state || 'no_receipt')}>{l.v_po_line_receipt_state?.receipt_state || 'no_receipt'}</span></td>
              </tr>
            )) : (
              <tr><td style={S.td} colSpan={10}>No lines found.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* POSHORTCLOSE — reason modal */}
      {showClose && (
        <div onClick={()=> !closing && setShowClose(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:10, padding:24, width:420 }}>
            <div style={{ fontSize:16, fontWeight:900, marginBottom:6 }}>Close Short — {data.po_number}</div>
            <div style={{ fontSize:13, color:'#6B7280', marginBottom:14 }}>
              Closes this PO with pending quantity not received. Pending stays visible in the
              receipt history below. A reason is required. No inventory is posted.
            </div>
            <textarea value={closeReason} onChange={e=>setCloseReason(e.target.value)} rows={3}
              placeholder="Reason for short-close (min 5 characters)…"
              style={{ width:'100%', border:'1px solid #D1D5DB', borderRadius:6, padding:'8px 10px', fontSize:13, boxSizing:'border-box', marginBottom:14 }} />
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
              <button onClick={()=>setShowClose(false)} disabled={closing} style={{ ...S.back, marginBottom:0 }}>Cancel</button>
              <button onClick={closePO} disabled={closing || closeReason.trim().length < 5}
                style={{ ...S.closeBtn, marginLeft:0, opacity:(closing || closeReason.trim().length < 5) ? 0.6 : 1 }}>
                {closing ? 'Closing…' : 'Confirm Close Short'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
