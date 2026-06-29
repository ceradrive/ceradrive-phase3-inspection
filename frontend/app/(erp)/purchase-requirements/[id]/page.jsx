'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  panel:{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden' },
  head:{ padding:'12px 16px', background:'#FBFCFE', borderBottom:'1px solid #E5E7EB', fontWeight:900, display:'flex', justifyContent:'space-between', alignItems:'center' },
  table:{ width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:{ textAlign:'left', padding:'10px 12px', background:'#F9FAFB', borderBottom:'1px solid #E5E7EB', fontSize:11, color:'#374151', textTransform:'uppercase' },
  td:{ padding:'11px 12px', borderBottom:'1px solid #F1F5F9', verticalAlign:'middle' },
  tdR:{ padding:'11px 12px', borderBottom:'1px solid #F1F5F9', textAlign:'right', verticalAlign:'middle' },
  pillRed:{ display:'inline-block', background:'#FEE2E2', color:'#991B1B', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  pillBlue:{ display:'inline-block', background:'#DBEAFE', color:'#1D4ED8', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  pillGray:{ display:'inline-block', background:'#E5E7EB', color:'#374151', borderRadius:999, padding:'3px 8px', fontSize:11, fontWeight:900 },
  btnDanger:{ border:'1px solid #FCA5A5', background:'#fff', color:'#B91C1C', borderRadius:6, padding:'8px 12px', fontSize:12, fontWeight:900, cursor:'pointer' },
  input:{ width:90, height:30, border:'1px solid #D1D5DB', borderRadius:6, padding:'0 8px', textAlign:'right' },
  select:{ width:210, height:30, border:'1px solid #D1D5DB', borderRadius:6, padding:'0 8px' },
  btn:{ border:0, background:'#004AC6', color:'#fff', borderRadius:6, padding:'8px 12px', fontSize:12, fontWeight:900, cursor:'pointer' },
  btnDisabled:{ border:0, background:'#9CA3AF', color:'#fff', borderRadius:6, padding:'8px 12px', fontSize:12, fontWeight:900, cursor:'not-allowed' },
};

export default function PurchaseRequirementDetailPage(){
  const params = useParams();
  const router = useRouter();
  const [data,setData] = useState(null);
  const [suppliers,setSuppliers] = useState([]);
  const [loading,setLoading] = useState(true);
  const [creating,setCreating] = useState(false);
  const [cancelling,setCancelling] = useState(false);
  const [lineState,setLineState] = useState({});
  const editedQtyRef = useRef(new Map()); // MOQ-OPT1: keep user-edited final qty across reloads
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const formatQty = (v) => {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 4,
      minimumFractionDigits: 0,
    }).format(n);
  };
  const formatQtyInput = (v) => {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return String(Number(n.toFixed(4)));
  };

  async function load(){
    setLoading(true);

    const [{data: prData}, {data: supplierData}] = await Promise.all([
      api.get(`/api/v1/purchase-requirements/${params.id}`),
      api.get('/api/v1/suppliers?limit=100'),
    ]);

    setData(prData);
    setSuppliers(supplierData || []);

    const initial = {};
    for (const line of prData?.lines || []) {
      initial[line.id] = {
        selected: line.status === 'draft',
        supplier_id: '',
        unit_rate: 0,
        final_qty: editedQtyRef.current.has(line.id) ? editedQtyRef.current.get(line.id) : formatQtyInput(line.suggested_buy_qty), // MOQ-OPT1
      };
    }
    setLineState(initial);
    setLoading(false);
  }

  useEffect(()=>{ load(); },[params.id]);

  const selectedCount = useMemo(
    () => Object.values(lineState).filter((x)=>x.selected).length,
    [lineState]
  );

  function updateLine(id, patch){
    setLineState(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...patch }
    }));
  }

  // MOQ-OPT1: user override of final PO qty; remembered so a reload won't silently overwrite it.
  function setFinalQty(id, val){
    editedQtyRef.current.set(id, val);
    updateLine(id, { final_qty: val });
  }

  async function createDraftPOs(){
    const lines = Object.entries(lineState)
      .filter(([,v])=>v.selected)
      .map(([line_id,v])=>({
        line_id,
        supplier_id: v.supplier_id,
        unit_rate: Number(v.unit_rate || 0),
        ordered_qty: num(v.final_qty), // MOQ-OPT1: user's final buy qty -> po_lines.ordered_qty
      }));

    if (!lines.length) {
      alert('Select at least one line.');
      return;
    }

    if (lines.some((x)=>!x.supplier_id)) {
      alert('Supplier missing for selected line.');
      return;
    }

    // MOQ-OPT1: final qty must be > 0 (UI guard; backend also validates).
    if (lines.some((x)=>!(num(x.ordered_qty) > 0))) {
      alert('Final PO qty must be greater than 0 for every selected line.');
      return;
    }

    // MOQ-OPT1: warn but allow when below shortage or below MOQ.
    const lineById = new Map((data?.lines || []).map((l)=>[String(l.id), l]));
    const belowAny = lines.some((x)=>{
      const l = lineById.get(String(x.line_id));
      return l && (num(x.ordered_qty) < num(l.shortage_qty) || (num(l.min_order_qty) > 0 && num(x.ordered_qty) < num(l.min_order_qty)));
    });
    if (belowAny && !confirm('Some lines are below required shortage or MOQ. Production may remain blocked. Continue?')) {
      return;
    }

    try {
      setCreating(true);
      const { data: res } = await api.post(`/api/v1/purchase-requirements/${params.id}/create-draft-pos`, { lines });
      const count = res?.purchase_orders?.length || 0;
      alert(`${count} Draft PO(s) created.`);
      await load();
    } catch (err) {
      console.error(err);
      alert('Failed to create Draft PO.');
    } finally {
      setCreating(false);
    }
  }

  async function cancelRequirement(){
    if (!data?.header?.id) return;
    if (!confirm(`Cancel ${data.header.pr_no}? This will remove it from MRP Already Requested. Continue?`)) {
      return;
    }

    try {
      setCancelling(true);
      await api.post(`/api/v1/purchase-requirements/${params.id}/cancel`, {});
      alert('Purchase Requirement cancelled.');
      router.push('/purchase-requirements');
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Failed to cancel Purchase Requirement.');
    } finally {
      setCancelling(false);
    }
  }

  if (loading) return <div style={S.page}>Loading...</div>;
  if (!data?.header) return <div style={S.page}>Purchase requirement not found.</div>;

  const h = data.header;
  const lines = data.lines || [];

  return (
    <div style={S.page}>
      <button style={S.back} onClick={()=>router.push('/purchase-requirements')}>← Back</button>

      <h1 style={S.title}>{h.pr_no}</h1>
      <div style={S.sub}>Select supplier and rate per line, then create supplier-wise Draft PO.</div>

      <div style={S.cards}>
        <div style={S.card}><div style={S.label}>Status</div><div style={S.val}>{h.status}</div></div>
        <div style={S.card}><div style={S.label}>Material</div><div style={S.val}>{h.material_status}</div></div>
        <div style={S.card}><div style={S.label}>Shortage Lines</div><div style={S.val}>{h.shortage_count}</div></div>
        <div style={S.card}><div style={S.label}>Created</div><div style={S.val}>{h.created_at ? new Date(h.created_at).toLocaleDateString() : '-'}</div></div>
      </div>

      {h.status === 'draft' ? (
        <div style={{display:'flex', justifyContent:'flex-end', gap:8, margin:'-6px 0 14px'}}>
          <button style={S.btnDanger} onClick={cancelRequirement} disabled={cancelling || creating}>
            {cancelling ? 'Cancelling...' : 'Cancel Requirement'}
          </button>
        </div>
      ) : null}

      <section style={S.panel}>
        <div style={S.head}>
          <span>Requirement Lines</span>
          <button
            style={selectedCount && h.status === 'draft' ? S.btn : S.btnDisabled}
            onClick={createDraftPOs}
            disabled={!selectedCount || creating || h.status !== 'draft'}
          >
            {creating ? 'Creating...' : `Create Draft PO (${selectedCount})`}
          </button>
        </div>

        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Use</th>
              <th style={S.th}>Item</th>
              <th style={S.th}>Shortage</th>
              <th style={S.th}>MOQ / Min Buy</th>
              <th style={S.th}>Suggested</th>
              <th style={S.th}>Final PO Qty</th>
              <th style={S.th}>UOM</th>
              <th style={S.th}>Supplier</th>
              <th style={S.th}>Rate</th>
              <th style={S.th}>Amount</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Generated PO</th>
            </tr>
          </thead>
          <tbody>
            {/* PODRAFT-SHOW-PO: draft rows = editable controls; po_drafted rows = actual generated PO data */}
            {lines.map((l)=>{
              const st = lineState[l.id] || {};
              const locked = l.status !== 'draft';
              const dash = <span style={{color:'#6B7280'}}>—</span>;
              const fq = num(st.final_qty);
              const poQty = l.po_ordered_qty;
              const poRate = l.po_unit_rate;
              const poAmount = (l.po_line_amount != null)
                ? l.po_line_amount
                : ((poQty != null && poRate != null) ? (num(poQty) * num(poRate)) : null);
              const poSupplier = l.po_supplier_code
                ? (l.po_supplier_name ? (l.po_supplier_code + ' — ' + l.po_supplier_name) : l.po_supplier_code)
                : null;
              const amount = locked ? (poAmount != null ? num(poAmount) : null) : (fq * Number(st.unit_rate || 0));
              const belowShort = !locked && fq < num(l.shortage_qty);
              const belowMoq = !locked && num(l.min_order_qty) > 0 && fq < num(l.min_order_qty);
              const invalid = !locked && fq <= 0;

              return (
                <tr key={l.id}>
                  <td style={S.td}>
                    <input type="checkbox" checked={Boolean(st.selected) && !locked} disabled={locked}
                      onChange={(e)=>updateLine(l.id,{selected:e.target.checked})} />
                  </td>
                  <td style={S.td}><b>{l.item_code}</b><br/><span style={{color:'#6B7280'}}>{l.item_name}</span></td>
                  <td style={S.tdR}><b>{formatQty(l.shortage_qty)}</b></td>
                  <td style={S.tdR}>{num(l.min_order_qty) > 0 ? formatQty(l.min_order_qty) : dash}</td>
                  <td style={S.tdR}>{locked ? dash : formatQty(l.suggested_buy_qty)}</td>
                  <td style={S.tdR}>
                    {locked ? (poQty != null ? <b>{formatQty(poQty)}</b> : dash) : (
                      <div>
                        <input style={{...S.input, border: invalid ? '1px solid #DC2626' : '1px solid #D1D5DB'}}
                          type="number" min="0" step="0.0001" value={st.final_qty ?? ''}
                          onChange={(e)=>setFinalQty(l.id, e.target.value)} />
                        {invalid ? <div style={{fontSize:10, color:'#991B1B', fontWeight:800, marginTop:3}}>Must be &gt; 0</div>
                          : belowShort ? <div style={{fontSize:10, color:'#92400E', fontWeight:800, marginTop:3}}>Below shortage — may stay blocked</div>
                          : belowMoq ? <div style={{fontSize:10, color:'#92400E', fontWeight:800, marginTop:3}}>Below MOQ / min buy</div>
                          : null}
                      </div>
                    )}
                  </td>
                  <td style={S.td}>{l.uom_code}</td>
                  <td style={S.td}>
                    {locked ? (poSupplier ? <span>{poSupplier}</span> : dash) : (
                      <select style={S.select} value={st.supplier_id || ''} onChange={(e)=>updateLine(l.id,{supplier_id:e.target.value})}>
                        <option value="">Select supplier</option>
                        {suppliers.map((s)=>(<option key={s.id} value={s.id}>{s.supplier_code} — {s.supplier_name}</option>))}
                      </select>
                    )}
                  </td>
                  <td style={S.tdR}>
                    {locked ? (poRate != null ? poRate : dash) : (
                      <input style={S.input} type="number" min="0" value={st.unit_rate ?? 0}
                        onChange={(e)=>updateLine(l.id,{unit_rate:e.target.value})} />
                    )}
                  </td>
                  <td style={S.tdR}>{amount != null ? num(amount).toFixed(2) : dash}</td>
                  <td style={S.td}><span style={l.status === 'cancelled' ? S.pillGray : (locked ? S.pillBlue : S.pillRed)}>{l.status}</span></td>
                  <td style={S.td}>
                    {l.generated_po_id ? (
                      <button style={S.btn} onClick={()=>router.push(`/purchase-orders/${l.generated_po_id}`)}>
                        {l.generated_po_number || 'Open PO'}
                      </button>
                    ) : dash}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
