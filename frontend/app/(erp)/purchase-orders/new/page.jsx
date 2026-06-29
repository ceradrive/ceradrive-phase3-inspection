'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';

const C = {
  bg: '#f8fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  borderDark: '#cbd5e1',
  text: '#0f172a',
  muted: '#64748b',
  primary: '#004AC6',
  primarySoft: '#eff6ff',
  danger: '#dc2626',
};

const inputStyle = { width:'100%', height:38, padding:'0 10px', boxSizing:'border-box', border:`1px solid ${C.borderDark}`, borderRadius:8, fontSize:14, color:C.text, outline:'none', background:'#fff' };
const cellInput = { width:'100%', height:34, padding:'0 8px', boxSizing:'border-box', border:`1px solid ${C.borderDark}`, borderRadius:7, fontSize:13, color:C.text, outline:'none', background:'#fff' };
const labelStyle = { display:'block', fontSize:13, fontWeight:700, color:'#334155', marginBottom:5 };

function toNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round4(v){
  return Math.round((Number(v || 0) + Number.EPSILON) * 10000) / 10000;
}

function money(v){
  return Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function SearchSelect({ endpoint, extraParams = {}, valueLabel, placeholder, onPick, render, full, rowKey, fieldName, onAfterPick }){
  const [open,setOpen] = useState(false);
  const [q,setQ] = useState('');
  const [results,setResults] = useState([]);
  const [loading,setLoading] = useState(false);
  const [activeIndex,setActiveIndex] = useState(0);
  const boxRef = useRef(null);

  useEffect(()=>{
    if(!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async ()=>{
      const { data } = await api.get(endpoint, { ...extraParams, search:q, limit:20 });
      const safe = Array.isArray(data) ? data.filter(r => r?.id) : [];
      if(!cancelled){ setResults(safe); setActiveIndex(0); setLoading(false); }
    }, 200);
    return ()=>{ cancelled = true; clearTimeout(t); };
  },[q,open,endpoint]);

  useEffect(()=>{
    function d(e){ if(boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', d);
    return ()=>document.removeEventListener('mousedown', d);
  },[]);

  async function pick(r){
    if (!r) return;
    await onPick(r);
    setOpen(false);
    setQ('');
    setActiveIndex(0);
    if(onAfterPick) setTimeout(onAfterPick, 0);
  }

  const style = full ? inputStyle : cellInput;

  return (
    <div ref={boxRef} style={{position:'relative', zIndex: open ? 80 : 'auto'}}>
      <div
        tabIndex={0}
        data-po-row={rowKey ?? undefined}
        data-po-field={fieldName ?? undefined}
        onClick={()=>setOpen(o=>!o)}
        onKeyDown={(e)=>{
          if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setOpen(true); }
          if(e.key === 'ArrowDown'){ e.preventDefault(); setOpen(true); setActiveIndex(0); }
          if(e.key === 'Escape') setOpen(false);
        }}
        style={{...style, display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer'}}
      >
        <span style={{color:valueLabel ? C.text : '#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{valueLabel || placeholder || 'Select…'}</span>
        <span style={{color:'#94a3b8', fontSize:11}}>▾</span>
      </div>

      {open && (
        <div style={{position:'absolute', zIndex:120, top:full ? 42 : 38, left:0, right:0, background:'#fff', border:`1px solid ${C.borderDark}`, borderRadius:8, boxShadow:'0 12px 28px rgba(15,23,42,0.12)', maxHeight:260, overflowY:'auto'}}>
          <input
            autoFocus
            value={q}
            onChange={e=>setQ(e.target.value)}
            placeholder="Search existing records…"
            onKeyDown={e=>{
              if(e.key === 'Escape'){ e.preventDefault(); setOpen(false); }
              if(e.key === 'ArrowDown'){
                e.preventDefault();
                setActiveIndex(i => Math.min(results.length - 1, i + 1));
              }
              if(e.key === 'ArrowUp'){
                e.preventDefault();
                setActiveIndex(i => Math.max(0, i - 1));
              }
              if(e.key === 'Enter'){
                e.preventDefault();
                if(results[activeIndex]) pick(results[activeIndex]);
              }
            }}
            style={{width:'100%', height:36, padding:'0 10px', boxSizing:'border-box', border:'none', borderBottom:`1px solid ${C.border}`, fontSize:13, outline:'none'}}
          />

          {loading ? <div style={{padding:12, fontSize:12, color:C.muted}}>Searching…</div>
            : results.length === 0 ? <div style={{padding:12, fontSize:12, color:C.muted}}>No matching existing record.</div>
            : results.map((r, idx) => (
              <div
                key={r.id}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={()=>pick(r)}
                style={{
                  padding:'9px 10px',
                  fontSize:13,
                  cursor:'pointer',
                  borderBottom:'1px solid #f1f5f9',
                  background: idx === activeIndex ? C.primarySoft : '#fff',
                  color: C.text,
                }}
              >
                {render(r)}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function focusPOField(key, field){
  setTimeout(()=>{
    const el = document.querySelector(`[data-po-row="${key}"][data-po-field="${field}"]`);
    if(el){ el.focus(); if(typeof el.select === 'function') el.select(); }
  }, 0);
}

function blankLine(){
  return {
    key: `${Date.now()}-${Math.random()}`,
    item_id:'',
    item_label:'',
    uom_id:'',
    uom_label:'',
    ordered_qty:'',
    unit_rate:'',
    notes:'',
  };
}

export default function NewPurchaseOrderPage(){
  const router = useRouter();
  const [supplier,setSupplier] = useState(null);
  const [poDate,setPoDate] = useState(new Date().toISOString().slice(0,10));
  const [expectedDelivery,setExpectedDelivery] = useState('');
  const [supplierRef,setSupplierRef] = useState('');
  const [notes,setNotes] = useState('');
  const [lines,setLines] = useState([blankLine()]);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');

  function updateLine(key, patch){
    setLines(prev => prev.map(l => l.key === key ? {...l, ...patch} : l));
  }

  function addLine(){
    const row = blankLine();
    setLines(prev => [...prev, row]);
    setTimeout(()=>focusPOField(row.key, 'item'), 0);
  }

  function removeLine(key){
    setLines(prev => prev.length <= 1 ? prev : prev.filter(l => l.key !== key));
  }

  function lineAmount(line){
    return round4(toNum(line.ordered_qty) * toNum(line.unit_rate));
  }

  const total = lines.reduce((sum,l)=>sum + lineAmount(l), 0);

  function validLines(){
    return lines
      .filter(l => l.item_id && l.uom_id && toNum(l.ordered_qty) > 0)
      .map(l => {
        const amount = lineAmount(l);
        return {
          item_id: l.item_id,
          uom_id: l.uom_id,
          ordered_qty: toNum(l.ordered_qty),
          unit_rate: toNum(l.unit_rate),
          line_amount: amount,
          tax_amount: 0,
          line_total: amount,
          tax_id: null,
          tax_name: null,
          tax_percent: null,
          notes: l.notes || null,
        };
      });
  }

  async function save(){
    setError('');
    if(!supplier?.id){
      setError('Supplier is required.');
      return;
    }

    const cleanLines = validLines();
    if(cleanLines.length === 0){
      setError('Add at least one valid PO line.');
      return;
    }

    try{
      setSaving(true);
      const { data, error: apiError } = await api.post('/api/v1/purchase-orders', {
        supplier_id: supplier.id,
        po_date: poDate,
        expected_delivery: expectedDelivery || null,
        supplier_ref: supplierRef || null,
        notes: notes || null,
        lines: cleanLines,
      });

      if(apiError) throw apiError;

      const poId = data?.id || data?.purchase_order?.id || data?.header?.id;
      if(poId) router.push(`/purchase-orders/${poId}`);
      else router.push('/purchase-orders');
    }catch(err){
      console.error(err);
      setError(err?.response?.data?.error?.message || err?.message || 'Failed to create Purchase Order.');
    }finally{
      setSaving(false);
    }
  }

  return (
    <main style={{maxWidth:1120, background:C.bg}}>
      <button onClick={()=>router.push('/purchase-orders')} style={{height:34, padding:'0 12px', border:`1px solid ${C.borderDark}`, borderRadius:8, background:'#fff', fontSize:13, color:'#334155', cursor:'pointer', marginBottom:14}}>← Back</button>

      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:20}}>
        <div>
          <h1 style={{fontSize:24, fontWeight:800, color:C.text, margin:0}}>New Purchase Order</h1>
          <p style={{fontSize:13, color:C.muted, marginTop:4}}>Create draft PO and receive material through GRN.</p>
        </div>
        <button onClick={save} disabled={saving} style={{height:38, padding:'0 16px', border:'none', borderRadius:8, background:C.primary, fontSize:13, fontWeight:700, color:'#fff', cursor:saving ? 'default' : 'pointer', opacity:saving ? 0.7 : 1}}>
          {saving ? 'Saving…' : 'Save Draft PO'}
        </button>
      </div>

      <div style={{background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16, marginBottom:14, boxShadow:'0 1px 2px rgba(15,23,42,0.04)'}}>
        <div style={{display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:12}}>
          <div>
            <label style={labelStyle}>Supplier *</label>
            <SearchSelect
              endpoint="/api/v1/suppliers"
              full
              valueLabel={supplier?.supplier_name || ''}
              placeholder="Select supplier"
              onPick={setSupplier}
              render={(s)=><><b>{s.supplier_name}</b><br/><span style={{color:C.muted}}>{s.supplier_code || ''}</span></>}
            />
          </div>
          <div>
            <label style={labelStyle}>PO Date</label>
            <input type="date" value={poDate} onChange={e=>setPoDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Expected Delivery</label>
            <input type="date" value={expectedDelivery} onChange={e=>setExpectedDelivery(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Supplier Ref</label>
            <input value={supplierRef} onChange={e=>setSupplierRef(e.target.value)} style={inputStyle} placeholder="Optional" />
          </div>
          <div style={{gridColumn:'span 2'}}>
            <label style={labelStyle}>Notes</label>
            <input value={notes} onChange={e=>setNotes(e.target.value)} style={inputStyle} placeholder="Optional" />
          </div>
        </div>
      </div>

      <div style={{background:'#fff', border:`1px solid ${C.border}`, borderRadius:14, overflow:'visible', boxShadow:'0 1px 2px rgba(15,23,42,0.04)'}}>
        <div style={{display:'grid', gridTemplateColumns:'minmax(260px,1fr) 90px 110px 110px 130px 40px', padding:'10px 14px', gap:8, background:'#f8fafc', borderBottom:`1px solid ${C.border}`}}>
          {['Item','UOM','Qty','Rate','Amount',''].map((h,i)=><div key={i} style={{fontSize:11, fontWeight:800, color:C.muted, textTransform:'uppercase', letterSpacing:'0.04em'}}>{h}</div>)}
        </div>

        {lines.map((line)=>(
          <div key={line.key} style={{display:'grid', gridTemplateColumns:'minmax(260px,1fr) 90px 110px 110px 130px 40px', padding:'8px 14px', gap:8, alignItems:'center', borderBottom:'1px solid #f1f5f9'}}>
            <SearchSelect
              endpoint="/api/v1/items/search"
              extraParams={{ purchase_only: true }}
              rowKey={line.key}
              fieldName="item"
              valueLabel={line.item_label}
              placeholder="Select item"
              onPick={(it)=>updateLine(line.key, {
                item_id: it.id,
                item_label: `${it.item_code} — ${it.item_name}`,
                uom_id: it.purchase_uom_id || it.uom_id,
                uom_label: it.purchase_uom?.uom_code || it.uom?.uom_code || it.uom_code || '',
              })}
              onAfterPick={()=>focusPOField(line.key, 'qty')}
              render={(it)=><><b>{it.item_code}</b><br/><span style={{color:C.muted}}>{it.item_name}</span></>}
            />

            <input value={line.uom_label || '—'} readOnly style={{...cellInput, background:'#f8fafc', color:C.muted}} />

            <input
              data-po-row={line.key}
              data-po-field="qty"
              value={line.ordered_qty}
              onChange={e=>updateLine(line.key, { ordered_qty:e.target.value })}
              onKeyDown={e=>{ if(e.key === 'Enter'){ e.preventDefault(); focusPOField(line.key, 'rate'); } }}
              style={cellInput}
              placeholder="0"
            />

            <input
              data-po-row={line.key}
              data-po-field="rate"
              value={line.unit_rate}
              onChange={e=>updateLine(line.key, { unit_rate:e.target.value })}
              onKeyDown={e=>{ if(e.key === 'Enter'){ e.preventDefault(); addLine(); } }}
              style={cellInput}
              placeholder="0"
            />

            <div style={{fontSize:13, color:C.text, textAlign:'right', paddingRight:8, fontWeight:700}}>₹ {money(lineAmount(line))}</div>

            <button type="button" onClick={()=>removeLine(line.key)} style={{border:`1px solid ${C.border}`, background:'#fff', borderRadius:8, height:30, cursor:'pointer', color:C.muted}}>×</button>
          </div>
        ))}

        <div style={{padding:'12px 14px', borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', background:'#fff'}}>
          <button type="button" onClick={addLine} style={{height:34, padding:'0 12px', border:`1px solid ${C.borderDark}`, borderRadius:8, background:'#fff', color:'#334155', fontSize:13, fontWeight:700, cursor:'pointer'}}>+ Add line</button>
          <div style={{fontSize:16, fontWeight:800, color:C.text}}>Total: ₹ {money(total)}</div>
        </div>
      </div>

      {error && <div style={{marginTop:12, color:C.danger, fontSize:13, fontWeight:700}}>{error}</div>}
    </main>
  );
}
