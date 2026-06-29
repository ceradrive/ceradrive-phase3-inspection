'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api.js';

// MRP-PERF-2: Module-level guard survives React/Next dev StrictMode remounts.
// It prevents duplicate /suggestions GET calls while preserving explicit force refresh after writes.
let mrpSuggestionsInFlight = null;
let mrpSuggestionsLastData = null;
let mrpSuggestionsLastAt = 0;
const MRP_SUGGESTIONS_DEV_CACHE_MS = 1500;

const S = {
  page:{ padding:'12px 18px', background:'#F9F9FF', minHeight:'100vh', fontFamily:'Inter, -apple-system, BlinkMacSystemFont, sans-serif' },
  title:{ margin:0, fontSize:22, lineHeight:'28px', fontWeight:900, color:'#041B3C', letterSpacing:'-0.02em' },
  sub:{ display:'none' },
  kpis:{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, margin:'8px 0 10px' },
  kpi:{ background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px', boxShadow:'0 1px 2px rgba(15,23,42,0.04)' },
  label:{ color:'#737685', fontSize:10, fontWeight:900, textTransform:'uppercase', letterSpacing:.45 },
  big:{ fontSize:21, lineHeight:'24px', fontWeight:900, marginTop:1, color:'#041B3C' },
  grid:{ display:'grid', gridTemplateColumns:'minmax(0,1fr)', gap:16 },
  panel:{ background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:16, overflow:'hidden', boxShadow:'0 1px 3px rgba(15,23,42,0.05)' },
  head:{ padding:'12px 16px', borderBottom:'1px solid #DCDFE4', fontWeight:900, fontSize:16, color:'#041B3C', background:'#FFFFFF' },
  tableWrap:{ overflowX:'auto', background:'#FFFFFF' },
  table:{ width:'100%', borderCollapse:'collapse', fontSize:14, minWidth:1220 },
  th:{ textAlign:'left', padding:'9px 12px', background:'#F1F3FF', borderBottom:'1px solid #DCDFE4', fontSize:11, color:'#434654', fontWeight:900, textTransform:'uppercase', letterSpacing:.3, whiteSpace:'nowrap' },
  td:{ padding:'11px 12px', borderBottom:'1px solid #EEF1F7', verticalAlign:'middle', whiteSpace:'nowrap', color:'#041B3C' },
  input:{ width:82, height:32, border:'1px solid #C3C6D6', borderRadius:8, padding:'0 8px', fontSize:13, color:'#041B3C', background:'#FFFFFF' },
  btn:{ border:0, borderRadius:12, background:'#003D9B', color:'#FFFFFF', padding:'12px 18px', fontWeight:900, cursor:'pointer', fontSize:14, boxShadow:'0 8px 18px rgba(0,61,155,0.18)' },
  btn2:{ border:'1px solid #C3C6D6', borderRadius:12, background:'#FFFFFF', color:'#041B3C', padding:'12px 18px', fontWeight:900, cursor:'pointer', fontSize:14 },
  warn:{ color:'#7D5200', background:'#FFF8ED', border:'1px solid #FFB950', borderRadius:10, padding:'8px 10px', fontSize:12, lineHeight:'17px', margin:'10px 14px 0' },
};

function keyOf(r){ return `${r.item_id}-${r.reason}`; }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isProduction(r){ return ['FG', 'STK'].includes(String(r.stage_type || '').toUpperCase()); }
function fmt(v){ return num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }

const PHASE_A_TAB_LABELS = { purchase:'Purchase Needed', make:'Manufacture Needed', requested:'Already Requested', technical:'Technical View' };
const phaseATabButton = (active) => ({
  border:'1px solid ' + (active ? '#003D9B' : '#CBD5E1'),
  background: active ? '#003D9B' : '#FFFFFF',
  color: active ? '#FFFFFF' : '#334155',
  borderRadius:999,
  padding:'8px 12px',
  fontWeight:900,
  fontSize:12,
  cursor:'pointer',
});

function productionPcs(row, qtyValue = row.approved_qty) {
  const qty = num(qtyValue);
  const uom = String(row.uom_code || '').toUpperCase();
  const pcsPerSet = num(row.pcs_per_set) || 4;
  return uom === 'SET' ? qty * pcsPerSet : qty;
}

function qtyFromPcs(row, pcsValue) {
  const pcs = Math.max(0, num(pcsValue));
  const uom = String(row.uom_code || '').toUpperCase();
  const pcsPerSet = num(row.pcs_per_set) || 4;
  return uom === 'SET' ? Math.floor(pcs / pcsPerSet) : Math.floor(pcs);
}

function statusStyle(status) {
  if (status === 'BP_READY') return { color:'#166534', background:'#DCFCE7', label:'BP READY' };
  if (status === 'BP_PARTIAL') return { color:'#92400E', background:'#FEF3C7', label:'BP PARTIAL' };
  if (status === 'BP_NOT_AVAILABLE') return { color:'#991B1B', background:'#FEE2E2', label:'NO BP' };
  if (status === 'BP_NOT_MAPPED') return { color:'#991B1B', background:'#FEE2E2', label:'MAP REQUIRED' };
  return { color:'#6B7280', background:'#F3F4F6', label:'BP MAP?' };
}

// A1-MRP-ROWSTATUS: one plain-language status per row, derived only from existing fields.
// No engine/jargon words on screen. No new statuses — grouped from guided_status / bp_status_live.
const MRP_TONE = {
  ok:{ color:'#166534', background:'#DCFCE7' },
  warn:{ color:'#92400E', background:'#FEF3C7' },
  bad:{ color:'#991B1B', background:'#FEE2E2' },
  muted:{ color:'#6B7280', background:'#F3F4F6' },
};
function mrpRowStatus(r) {
  const bp = String(r.bp_status_live || '').toUpperCase();
  const guided = String(r.guided_status || '').toUpperCase();
  const unresolved = Array.isArray(r.unresolved_items) && r.unresolved_items.length > 0;
  const need = num(r.desired_pcs) || num(r.sales_demand_pcs) || num(r.demand_qty);
  const canMake = r.press_ready_qty != null ? num(r.press_ready_qty) : num(r.bp_feasible_pcs);
  const ready = canMake > 0;
  // A1B-MRP-RECIPE-PRECEDENCE: recipe/source missing is the root cause and outranks BP mapping
  // (no recipe -> naturally no Back Plate). Matches the Mapping-Required panel's own precedence.
  if (guided === 'RECIPE_MISSING' || unresolved) return { key:'RECIPE', label:'Recipe / source missing', tone:'bad',
    reason:'No recipe or material source found for this item.',
    fixes:[{ label:'Open Recipe Setup', href:'/masters/stage-recipes' }, { label:'Open Routing Setup', href:'/masters/routings' }], selectable:false };
  if (guided === 'MATERIAL_CHECK_FAILED') return { key:'FAILED', label:'Check failed', tone:'muted',
    reason:'Could not verify material. Treated as not ready.', fixes:[], selectable:false, viewDetails:true };
  if (guided === 'NEED_PURCHASE' || (Array.isArray(r.purchase_material_shortage) && r.purchase_material_shortage.length))
    return { key:'PURCHASE', label:'Buy material first', tone:'warn',
      reason:'Purchase needed — purchasable material is short.', fixes:[], selectable:false, viewShortage:true };
  if (guided === 'NEED_PRODUCTION' || (Array.isArray(r.internal_production_gap) && r.internal_production_gap.length))
    return { key:'WIP', label:'Need to make WIP first', tone:'warn',
      reason:'An internal WIP item is short — make it first.', fixes:[], selectable:false, viewShortage:true };
  if (ready && need > 0 && canMake >= need) return { key:'READY', label:'Ready to produce', tone:'ok',
    reason:'Material available for the full quantity.', fixes:[], selectable:true };
  if (bp === 'BP_PARTIAL' || (ready && need > 0 && canMake < need)) return { key:'PARTIAL', label:'Can make partially', tone:'warn',
    reason:'Only part of the quantity can be made now.', fixes:[], selectable:true, viewShortage:true };
  if (ready) return { key:'READY', label:'Ready to produce', tone:'ok', reason:'Material available.', fixes:[], selectable:true };
  // A1C-MRP-PURCHASE-PRECEDENCE: deep guided verdicts (recipe/purchase/production/ready) outrank the
  // shallow bp_status_live heuristic. Show Missing Back Plate ONLY when the mapping is genuinely absent
  // and nothing above explained the row (e.g. BP stock-out with a mapping -> Buy material first instead).
  if (bp === 'BP_NOT_MAPPED') return { key:'MAP', label:'Missing Back Plate', tone:'bad',
    reason:'No Back Plate linked to this item.', fixes:[{ label:'Fix BP Mapping', href:'/masters/stage-recipes' }], selectable:false };
  return { key:'BLOCKED', label:'Blocked', tone:'bad', reason:'Material shortage detected.', fixes:[], selectable:false, viewDetails:true };
}

// A2-MRP-ZONES: zone grouping + reusable row + details drawer (reuses A1 mrpRowStatus; no new statuses).
function mrpZone(key) {
  // A2B-ZONE-PROD-ONLY: production rows (FG/STK) are made, never bought. Ready/Partial -> Ready to Make;
  // everything else (incl. NEED_PURCHASE / NEED_PRODUCTION / BLOCKED) -> Needs Fix (production blocked).
  // Actual purchasable items (RM/BP/components) live in the Purchase Suggestions panel, not in a zone.
  if (key === 'READY' || key === 'PARTIAL') return 'ready';
  return 'fix';
}
function MrpRow({ r, ms, onOpen, onSelect, showPlan }) { // B2-MRP-PLAN-OPTIONS: showPlan adds a compact options hint
  const tone = MRP_TONE[ms.tone] || MRP_TONE.muted;
  const need = num(r.sales_demand_pcs ?? r.demand_qty);
  const canMake = r.press_ready_qty != null ? num(r.press_ready_qty) : num(r.bp_feasible_pcs);
  const stop = (e) => e.stopPropagation();
  return (
    <tr onClick={() => onOpen(r)} style={{ cursor:'pointer', ...(r.sent_to_press_planner ? { background:'#FAFBFF' } : {}) }}>
      <td style={S.td}>
        <b>{r.item_code}</b><br/><span style={{color:'#6B7280'}}>{r.item_name}</span>
        {showPlan && r.so_plus_buffer_qty != null && (num(r.so_shortage_qty) > 0 || num(r.so_plus_buffer_qty) > 0)
          ? <><br/><span style={{fontSize:11, color:'#475569', fontWeight:700}}>Plan {fmt(r.approved_qty)} &middot; SO {fmt(r.so_shortage_qty)} &middot; +Buffer {fmt(r.so_plus_buffer_qty)} &middot; Reorder {fmt(r.reorder_suggested_qty)}</span></>
          : null}
      </td>
      <td style={S.td}>{fmt(need)} PCS</td>
      <td style={S.td}>{fmt(r.stock_qty)} PCS</td>
      <td style={S.td}><b style={{color: canMake > 0 ? '#166534' : '#6B7280'}}>{fmt(canMake)} PCS</b></td>
      <td style={S.td}><span style={{display:'inline-flex', padding:'4px 8px', borderRadius:999, fontSize:11, fontWeight:800, color:tone.color, background:tone.background}}>{ms.label}</span></td>
      <td style={S.td} onClick={stop}>
        {r.sent_to_press_planner ? (
          <span style={{display:'inline-flex', padding:'3px 7px', borderRadius:999, background:'#EEF2FF', border:'1px solid #4F46E5', color:'#3730A3', fontSize:10, fontWeight:900}}>SENT</span>
        ) : ms.selectable ? (
          <label style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:12, fontWeight:700, cursor:'pointer'}}>
            <input type="checkbox" checked={r.selected} onChange={e=>onSelect(r, e.target.checked)}/> Select
          </label>
        ) : (ms.fixes && ms.fixes.length) ? (
          <span style={{display:'inline-flex', gap:8, flexWrap:'wrap'}}>
            {ms.fixes.map(f=><Link key={f.href + f.label} href={f.href} style={{color:'#003D9B', fontWeight:800, fontSize:12, textDecoration:'none'}}>{f.label}</Link>)}
          </span>
        ) : (
          <button type="button" onClick={()=>onOpen(r)} style={{border:'1px solid #C3C6D6', borderRadius:8, background:'#FFFFFF', color:'#041B3C', fontWeight:800, fontSize:12, padding:'4px 10px', cursor:'pointer'}}>{ms.viewShortage ? 'View shortage' : 'View details'}</button>
        )}
      </td>
    </tr>
  );
}
// MRP-DASHBOARD-1: all-SKU approved-SO demand table (grouped by item). Renders every demand family
// (rows with sales_demand_pcs > 0) so the user is not forced to select one SKU at a time. Clicking
// "Plan" selects that family -> the existing item-specific detail (GuidedFamily) renders below.
function AllSkuDemand({ rows, activeKey, onSelect, onViewShortage }) {
  const list = (rows || []).filter(r => num(r.sales_demand_pcs) > 0);
  if (!list.length) return null;
  const totalPcs = list.reduce((s, r) => s + num(r.sales_demand_pcs), 0);
  const statusLabelOf = (k) => k === 'READY' ? 'Ready' : k === 'PARTIAL' ? 'Partial'
    : k === 'PURCHASE' ? 'Buy material' : (k === 'MAP' || k === 'RECIPE') ? 'Mapping'
    : k === 'WIP' ? 'WIP needed' : (k === 'FAILED' || k === 'BLOCKED') ? 'Blocked' : (k || '—');
  const cell = { padding: '10px 12px', fontSize: 13, color: '#1F2430', borderBottom: '1px solid #EEF0F5', whiteSpace: 'nowrap' };
  const head = { padding: '10px 12px', fontSize: 11, fontWeight: 800, color: '#737685', textTransform: 'uppercase', letterSpacing: '.04em', background: '#F7F8FB', borderBottom: '1px solid #E3E6EE' };
  return (
    <div style={{ ...S.panel, padding: 0, marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #E3E6EE', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={eyebrow}>All customer-order demand</div>
          <h2 style={{ fontSize: 16, margin: '4px 0 0' }}>{list.length} SKU{list.length === 1 ? '' : 's'} with approved SO demand</h2>
        </div>
        <div style={{ fontSize: 13, color: '#737685', fontWeight: 700 }}>Total Production Demand: <b style={{ color: '#1F2430' }}>{fmt(totalPcs)} PCS</b></div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
          <thead><tr>
            {['SKU', 'Item name', 'Sales Demand', 'Production Demand', 'Stock (STK)', 'To make', 'Shortage', 'Status', ''].map((h, i) => (
              <th key={i} style={{ ...head, textAlign: (i >= 2 && i <= 6) ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {list.map(r => {
              const sources = Array.isArray(r.sales_sources) ? r.sales_sources : [];
              const setSrc = sources[0] || null;
              const setCode = (setSrc && setSrc.item_code) || r.item_code;
              // PLANNING-UX-1B: Sales Demand = total SO-line qty in SO-line UOM (sum across SOs, e.g. VO101S 500+10).
              const salesQtySum = sources.reduce((acc, x) => acc + num(x.qty), 0);
              const salesQty = r.sales_demand_qty != null ? num(r.sales_demand_qty) : salesQtySum;
              const salesUom = String(r.sales_uom || (setSrc && setSrc.uom_code) || '').toUpperCase();
              const prodPcs = num(r.production_demand_pcs != null ? r.production_demand_pcs : r.sales_demand_pcs);
              const prodUom = r.production_uom || 'PCS';
              const salesDemand = (sources.length || r.sales_demand_qty != null)
                ? (fmt(salesQty) + (salesUom ? ' ' + salesUom : ''))
                : (fmt(prodPcs) + ' ' + prodUom);
              const productionDemand = fmt(prodPcs) + ' ' + prodUom;
              const ms = mrpRowStatus(r);
              const tone = MRP_TONE[ms.tone] || MRP_TONE.muted;
              const k = keyOf(r);
              const selected = k === activeKey;
              const shortage = num(r.so_shortage_qty);
              return (
                <tr key={k} style={{ background: selected ? '#EEF3FF' : '#FFFFFF' }}>
                  <td style={{ ...cell, fontWeight: 800, color: '#003D9B' }}>{setCode}</td>
                  <td style={{ ...cell, color: '#475569', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.item_name || '\u2014'}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{salesDemand}{r.pcs_per_set_missing ? <span title="pcs_per_set missing" style={{ color: '#B45309' }}> &#9888;</span> : null}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{productionDemand}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmt(num(r.stock_qty))}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmt(num(r.suggested_qty))}</td>
                  <td style={{ ...cell, textAlign: 'right', color: shortage > 0 ? '#B42318' : '#166534', fontWeight: 800 }}>{fmt(shortage)}</td>
                  <td style={cell}><span style={{ display: 'inline-flex', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800, color: tone.color, background: tone.background }}>{statusLabelOf(ms.key)}</span></td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <button onClick={() => onViewShortage(r)} style={{ background: 'none', border: '1px solid #C3C6D6', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, color: '#334155', cursor: 'pointer', marginRight: 6 }}>View shortage</button>
                    <button onClick={() => onSelect(k)} style={{ background: '#003D9B', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, color: '#FFFFFF', cursor: 'pointer' }}>Plan</button>
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

function GuidedFamily(props) {
  const { families, active, ms, onSelectFamily, onPickQty, blockers, stages,
          onCreatePurchase, onCreatePlan, onCreatePlanAssist, onAddStagesAssist, onReviewMaterials, openDrawer } = props;
  const [pick, setPick] = useState({ key: null, for: null }); // G1C-OPT-HIGHLIGHT: which option the user actually clicked
  if (!active) {
    return <div style={{...S.panel, padding:'16px 18px', marginBottom:12}}>No customer-order demand to show yet.</div>;
  }
  const sources = Array.isArray(active.sales_sources) ? active.sales_sources : [];
  const setSrc = sources[0] || null;
  const setCode = (setSrc && setSrc.item_code) || active.item_code;
  const oneSet = sources.length === 1 && String(setSrc.uom_code || '').toUpperCase() === 'SET';
  const demandPcs = num(active.sales_demand_pcs);
  const stock = num(active.stock_qty);
  const shortQty = num(active.so_shortage_qty);
  const bufferQty = num(active.so_plus_buffer_qty);
  const desired = num(active.desired_stock);
  const cur = num(active.approved_qty);
  const reorderQty = num(active.reorder_suggested_qty);
  const suggested = num(active.suggested_qty);
  const planInvalid = cur <= 0;
  const planChanged = cur !== suggested;
  const factor = (setSrc && num(setSrc.qty) > 0) ? Math.round(num(setSrc.pcs) / num(setSrc.qty)) : (num(active.pcs_per_set) || 4);
  const afterA = stock + shortQty - demandPcs;
  const afterB = stock + bufferQty - demandPcs;
  const statusLabel = ms.key === 'READY' ? 'Ready to produce' : ms.key === 'PARTIAL' ? 'Partially ready' : 'Material not ready';
  const statusTone = ms.key === 'READY' ? MRP_TONE.ok : ms.key === 'PARTIAL' ? MRP_TONE.warn : MRP_TONE.bad;

  // single recommended action by state
  let recText, cta;
  if (ms.key === 'PURCHASE') {
    recText = setCode + ' order ke liye ' + active.item_code + ' short hai aur raw material available nahi hai. Next: Purchase request create karein.';
    cta = <button style={btnPrimary} onClick={onCreatePurchase}>Create Purchase Request</button>;
  } else if (ms.key === 'RECIPE' || ms.key === 'MAP') {
    const f = (ms.fixes && ms.fixes[0]) || { label: 'Open Recipe Setup', href: '/masters/stage-recipes' };
    recText = active.item_code + ' ki mapping/recipe missing hai. Next: ' + f.label + '.';
    cta = <Link href={f.href} style={{...btnPrimary, textDecoration:'none', display:'inline-block'}}>{f.label}</Link>;
  } else if (ms.key === 'WIP') {
    recText = active.item_code + ' banane se pehle internal WIP stages chahiye. Next: stages ko Internal Plan me add karein.';
    cta = <button style={btnPrimary} onClick={onAddStagesAssist}>Add STK stages to Internal Plan</button>;
  } else if (ms.key === 'READY' || ms.key === 'PARTIAL') {
    recText = setCode + ' order ke liye ' + active.item_code + ' ban sakta hai. Next: production plan create karein.';
    cta = <button style={{...btnPrimary, opacity: planInvalid ? .6 : 1}} disabled={planInvalid} onClick={onCreatePlan}>Create Plan</button>;
  } else {
    recText = active.item_code + ' abhi blocked hai. Next: shortage dekhein.';
    cta = <button style={btnPrimary} onClick={() => openDrawer(active)}>View shortage</button>;
  }

  // G1C-OPT-HIGHLIGHT: priority order; default to the first option matching current qty, unless the user
  // explicitly clicked one (and it still matches). Equal-valued options no longer both show selected.
  const optKeys = [{ key:'so', qty: shortQty }, { key:'buf', qty: bufferQty }, { key:'reo', qty: reorderQty }];
  const rk = active ? keyOf(active) : null;
  const explicitPick = (pick && pick.for === rk) ? pick.key : null;
  const selKey = (explicitPick && optKeys.find(o => o.key === explicitPick && o.qty === cur && cur > 0))
    ? explicitPick
    : ((optKeys.find(o => o.qty === cur && o.qty > 0) || {}).key || null);
  const opt = (optKey, label, meta, qty, recommended) => {
    const selected = selKey === optKey;
    return (
    <div onClick={() => { setPick({ key: optKey, for: rk }); onPickQty(qty); }} style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, cursor:'pointer',
      border: selected ? '2px solid #003D9B' : '1px solid #C3C6D6', borderRadius:10, background: selected ? '#EEF3FF' : '#FFFFFF', padding:'11px 13px', marginTop:8}}>
      <div><div style={{fontWeight:900}}>{label}</div>
        <div style={{fontSize:12, color:'#737685', marginTop:2}}>{meta}</div>
        {recommended ? <div style={{fontSize:11, color:'#9A6B00', fontWeight:800, marginTop:2}}>Recommended if you want to restore STK buffer</div> : null}</div>
      <div style={{fontWeight:900, fontSize:15, whiteSpace:'nowrap'}}>{fmt(qty)} PCS{selected ? '  \u2713' : ''}</div>
    </div>
    );
  };

  return (
    <div style={{marginBottom:14}}>
      {families.length > 1 ? (
        <div style={{marginBottom:10}}>
          <label style={{fontSize:12, fontWeight:800, color:'#737685', marginRight:8}}>Viewing demand for:</label>
          <select value={active ? keyOf(active) : ''} onChange={(e) => onSelectFamily(e.target.value)}
            style={{fontWeight:800, border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px'}}>
            {families.map(f => <option key={f.key} value={f.key}>{f.setCode} &rarr; {f.stkCode}</option>)}
          </select>
        </div>
      ) : null}

      <div style={{...S.panel, border:'1px solid #C9D8FF', padding:'16px 18px', marginBottom:12}}>
        <div style={eyebrow}>Recommended next action</div>
        <div style={{color:'#334155', margin:'6px 0 12px'}}>{recText}</div>
        {cta}
      </div>

      <div style={{...S.panel, padding:'16px 18px', marginBottom:12}}>
        <div style={eyebrow}>Order demand</div>
        <div style={{display:'flex', alignItems:'center', gap:10, margin:'4px 0 8px'}}>
          <h2 style={{fontSize:16, margin:0}}>{setCode} customer order</h2>
          <span style={{display:'inline-flex', padding:'4px 10px', borderRadius:999, fontSize:12, fontWeight:800, color:statusTone.color, background:statusTone.background}}>{statusLabel}</span>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px,1fr))', gap:10}}>
          <div style={statBox}><div style={statK}>Order item</div><div style={statV}>{setCode}</div></div>
          <div style={statBox}><div style={statK}>Sales demand</div><div style={statV}>{(() => { const ss = Array.isArray(active.sales_sources) ? active.sales_sources : []; const q = active.sales_demand_qty != null ? num(active.sales_demand_qty) : ss.reduce((a,x)=>a+num(x.qty),0); const u = String(active.sales_uom || (ss[0] && ss[0].uom_code) || '').toUpperCase(); return (ss.length || active.sales_demand_qty != null) ? (fmt(q) + (u ? ' ' + u : '')) : (fmt(demandPcs) + ' PCS'); })()}</div></div>
          <div style={statBox}><div style={statK}>Production demand</div><div style={statV}>{fmt(num(active.production_demand_pcs != null ? active.production_demand_pcs : active.sales_demand_pcs))} {active.production_uom || 'PCS'}</div></div>
          <div style={statBox}><div style={statK}>Source</div><div style={{...statV, fontSize:13}}>From Sales Order</div></div>
        </div>
        <details style={{marginTop:8}}>
          <summary style={{cursor:'pointer', fontWeight:800, color:'#334155', fontSize:13}}>How calculated?</summary>
          <div style={{fontSize:13, color:'#334155', marginTop:8, display:'grid', gap:4}}>
            {oneSet ? <div>Order demand: {fmt(setSrc.qty)} SET &times; {factor} PCS = <b>{fmt(demandPcs)} PCS</b></div> : <div>Order demand: <b>{fmt(demandPcs)} PCS</b></div>}
            <div>STK available (in stock): <b>{fmt(stock)} PCS</b></div>
            <div>Order shortage: {fmt(demandPcs)} &minus; {fmt(stock)} = <b>{fmt(shortQty)} PCS</b></div>
            <div>Buffer target ({active.item_code} max): <b>{fmt(desired)} PCS</b></div>
            <div>Order + buffer: {fmt(demandPcs)} + {fmt(desired)} &minus; {fmt(stock)} = <b>{fmt(bufferQty)} PCS</b></div>
          </div>
        </details>
      </div>

      {(shortQty > 0 || bufferQty > 0 || reorderQty > 0) ? (
        <div style={{...S.panel, padding:'16px 18px', marginBottom:12}}>
          <div style={eyebrow}>STK buffer decision</div>
          <h2 style={{fontSize:16, margin:'4px 0 0'}}>How much {active.item_code} to make?</h2>
          {opt('so', 'Make only SO shortage', 'After order, STK balance: ' + fmt(afterA) + ' PCS', shortQty)}
          {opt('buf', 'Make SO + restore buffer', 'After order, STK balance: ' + fmt(afterB) + ' PCS', bufferQty, true)}
          {reorderQty > 0 ? opt('reo', 'Reorder batch', 'Standard reorder quantity for ' + active.item_code, reorderQty) : null}
          <div style={{display:'flex', alignItems:'center', gap:8, marginTop:12, flexWrap:'wrap'}}>
            <label style={{fontSize:12, fontWeight:800, color:'#737685'}}>Plan Qty</label>
            <input type="number" min="0" value={cur} onChange={(e) => { setPick({ key: null, for: rk }); onPickQty(e.target.value); }}
              style={{width:130, border: planInvalid ? '1px solid #DC2626' : '1px solid #C3C6D6', borderRadius:8, padding:'8px 10px', fontWeight:800, fontSize:15}} />
            <span style={{fontSize:12, color:'#737685'}}>PCS</span>
          </div>
          {planInvalid ? <div style={{fontSize:12, color:'#991B1B', fontWeight:800, marginTop:6}}>Plan qty must be greater than 0.</div> : null}
          {planChanged && !planInvalid ? <div style={{fontSize:12, color:'#1E3A8A', fontWeight:800, marginTop:6}}>You changed plan qty from system suggestion {fmt(suggested)} to {fmt(cur)}.</div> : null}
          {/* G1D-OPT-HELPER: helper text follows the selected option */}
          <div style={{fontSize:12, color:'#737685', marginTop:8}}>{
            planInvalid ? 'Enter a plan qty greater than 0 to continue.'
            : selKey === 'so' ? ('Makes only the quantity needed for this order. STK balance after order: ' + fmt(afterA) + ' PCS.')
            : selKey === 'buf' ? ('Recommended only if policy is to restore the STK buffer. STK balance after order: ' + fmt(afterB) + ' PCS.')
            : selKey === 'reo' ? ('Uses standard reorder quantity for ' + active.item_code + '.')
            : 'Custom plan qty selected. Review before creating plan.'
          }</div>
        </div>
      ) : null}

      {blockers.length ? (
        <div style={{...S.panel, padding:'16px 18px', marginBottom:12}}>
          <div style={eyebrow}>Current blocker</div>
          <h2 style={{fontSize:16, margin:'4px 0 8px'}}>To make {active.item_code}, buy:</h2>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px,1fr))', gap:'4px 18px'}}>
            {blockers.map((b, i) => (
              <div key={b.item_id || i} style={{display:'flex', justifyContent:'space-between', borderBottom:'1px dashed #DCDFE4', padding:'7px 0', fontSize:14}}>
                <span>{b.item_code} <span style={{fontSize:10, fontWeight:900, background:'#FEF3C7', color:'#92400E', borderRadius:6, padding:'2px 6px'}}>buy</span></span>
                <b>{fmt(b.shortage_qty)} {b.required_uom || ''}</b>
              </div>
            ))}
          </div>
          <div style={{marginTop:10}}>
            <button style={btnGhost} onClick={onReviewMaterials}>Review materials</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
const eyebrow = { fontSize:11, fontWeight:900, letterSpacing:.6, textTransform:'uppercase', color:'#003D9B', marginBottom:2 };
const statBox = { background:'#FAFBFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'9px 12px' };
const statK = { fontSize:10, fontWeight:900, textTransform:'uppercase', letterSpacing:.4, color:'#737685' };
const statV = { fontSize:17, fontWeight:900, marginTop:2, color:'#041B3C' };
const btnPrimary = { border:0, borderRadius:10, background:'#003D9B', color:'#FFFFFF', fontWeight:800, fontSize:14, padding:'11px 16px', cursor:'pointer' };
const btnGhost = { border:'1px solid #C3C6D6', borderRadius:10, background:'#FFFFFF', color:'#041B3C', fontWeight:800, fontSize:14, padding:'9px 14px', cursor:'pointer' };
function MrpDrawer({ r, ms, onClose, onPickQty }) { // B2-MRP-PLAN-OPTIONS
  const [drawerPick, setDrawerPick] = useState(null); // G1C-OPT-HIGHLIGHT
  const tone = MRP_TONE[ms.tone] || MRP_TONE.muted;
  const why = r.reason === 'SALES_PLUS_REORDER' ? 'Sales + reorder' : r.reason === 'SALES_ORDER' ? 'Sales visible' : 'Reorder trigger';
  const dLbl = { color:'#737685', fontSize:10, fontWeight:900, textTransform:'uppercase', letterSpacing:.4 };
  const dVal = { fontSize:13, fontWeight:800, color:'#041B3C', marginTop:2 };
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(4,27,60,0.32)', display:'flex', justifyContent:'flex-end', zIndex:50}} onClick={onClose}>
      <div style={{width:'min(560px, 96vw)', height:'100%', background:'#F9F9FF', boxShadow:'-12px 0 30px rgba(15,23,42,0.18)', overflowY:'auto', padding:'16px 18px'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12}}>
          <div>
            <div style={{fontSize:18, fontWeight:900, color:'#041B3C'}}>{r.item_code}</div>
            <div style={{color:'#6B7280', fontSize:13}}>{r.item_name}</div>
            <div style={{marginTop:8}}><span style={{display:'inline-flex', padding:'4px 10px', borderRadius:999, fontSize:12, fontWeight:800, color:tone.color, background:tone.background}}>{ms.label}</span></div>
          </div>
          <button type="button" onClick={onClose} style={{border:'1px solid #C3C6D6', borderRadius:12, background:'#FFFFFF', color:'#041B3C', padding:'10px 16px', fontWeight:900, cursor:'pointer'}}>Close</button>
        </div>
        <div style={{fontSize:13, color:'#334155', marginBottom:12, background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'10px 12px'}}>
          <div style={{marginBottom:6}}><b>Why suggested:</b> {why}</div>
          <div><b>What to do:</b> {ms.reason}</div>
        </div>
        {/* MRP-UX-PHASE-2-MERGED: drawer simple top — Need to buy / Need to make + compact chain. */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12}}>
          <div style={{background:'#FFF7ED', border:'1px solid #FED7AA', borderRadius:10, padding:'10px 12px'}}>
            <div style={dLbl}>Need to buy</div>
            <div style={{...dVal, color:'#9A3412'}}>{(Array.isArray(r.purchase_material_shortage) && r.purchase_material_shortage.length) ? r.purchase_material_shortage.map(l => l.item_code).join(', ') : 'Nothing'}</div>
          </div>
          <div style={{background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:10, padding:'10px 12px'}}>
            <div style={dLbl}>Need to make</div>
            <div style={{...dVal, color:'#1E3A8A'}}>{(Array.isArray(r.internal_production_gap) && r.internal_production_gap.length) ? (r.internal_production_gap.length + ' stage(s)') : 'Nothing'}</div>
          </div>
        </div>
        {(Array.isArray(r.internal_production_gap) && r.internal_production_gap.length) ? (
          <div style={{background:'#F8FAFC', border:'1px dashed #C3C6D6', borderRadius:10, padding:'8px 12px', marginBottom:12}}>
            <div style={{fontSize:11, fontWeight:900, color:'#64748B', marginBottom:4, textTransform:'uppercase', letterSpacing:.4}}>Auto chain &middot; on Create Plan</div>
            <div style={{fontSize:12.5, fontWeight:800, color:'#041B3C', lineHeight:1.7}}>
              {r.internal_production_gap.map((l, i) => (
                <span key={(l.item_id || l.item_code || i) + '-top'}>{i > 0 ? <span style={{color:'#94A3B8'}}> &rarr; </span> : null}{l.item_code}</span>
              ))}
            </div>
          </div>
        ) : null}
        {/* MRP-UX-PHASE-2-MERGED: drawer technical detail collapsed by default. */}
        <details style={{marginBottom:12}}>
          <summary style={{cursor:'pointer', fontWeight:800, color:'#334155', padding:'6px 2px'}}>Technical details &mdash; stock, materials &amp; stages</summary>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px,1fr))', gap:8, marginBottom:12}}>
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px'}}><div style={dLbl}>Current stock</div><div style={dVal}>{fmt(r.stock_qty)} PCS</div></div>
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px'}}><div style={dLbl}>After sales stock</div><div style={dVal}>{fmt(r.projected_stock_qty)} PCS</div></div>
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px'}}><div style={dLbl}>Reorder level</div><div style={dVal}>{fmt(r.reorder_level)} PCS</div></div>
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px'}}><div style={dLbl}>Reorder qty</div><div style={dVal}>{fmt(r.reorder_qty)} PCS</div></div>
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px'}}><div style={dLbl}>Plan qty</div><div style={dVal}>{fmt(r.approved_qty)} PCS</div></div>
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px'}}><div style={dLbl}>Back Plate item</div><div style={dVal}>{r.bp_item_code || '\u2014'}</div></div>
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px'}}><div style={dLbl}>Back Plate available</div><div style={dVal}>{fmt(r.bp_available_before_pcs)} PCS</div></div>
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px'}}><div style={dLbl}>Pending</div><div style={dVal}>{fmt(r.bp_pending_pcs)} PCS</div></div>
        </div>
        {((!Array.isArray(r.purchase_material_shortage) || r.purchase_material_shortage.length === 0)
          && (!Array.isArray(r.internal_production_gap) || r.internal_production_gap.length === 0)
          && num(r.so_shortage_qty) <= 0 && num(r.bp_pending_pcs) <= 0) ? (
          <div style={{fontSize:13, color:'#475569', fontWeight:700, background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'12px 14px', marginBottom:12}}>No detailed shortage available for this item.</div>
        ) : null}
        {/* MRP-DEEP-SHORTAGE-2: chain from THIS drawer row's OWN arrays (r = drawerRow,
            uniquely keyed). Never the shared activeFamily chain -> clicked SKU only. */}
        {(Array.isArray(r.purchase_material_shortage) && r.purchase_material_shortage.length) ? (
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'12px 14px', marginBottom:12}}>
            <div style={{fontSize:13, fontWeight:900, color:'#041B3C', marginBottom:8}}>Purchase needed &mdash; RM / Back Plate ({r.purchase_material_shortage.length})</div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {r.purchase_material_shortage.map((l, i) => (
                <div key={(l.item_id || l.item_code || i) + '-buy'} style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, borderBottom:'1px solid #EEF0F4', paddingBottom:6}}>
                  <span style={{fontWeight:800, fontSize:13, color:'#041B3C'}}>{l.item_code}{l.stage_type ? <span style={{color:'#737685', fontWeight:700, fontSize:11, marginLeft:6}}>{l.stage_type}</span> : null}</span>
                  <span style={{fontWeight:900, fontSize:13, color:'#991B1B'}}>{fmt(num(l.shortage_qty))} {l.required_uom || ''}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {(Array.isArray(r.internal_production_gap) && r.internal_production_gap.length) ? (
          <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'12px 14px', marginBottom:12}}>
            <div style={{fontSize:13, fontWeight:900, color:'#041B3C', marginBottom:8}}>Production needed &mdash; SFG / stages ({r.internal_production_gap.length})</div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {r.internal_production_gap.map((l, i) => (
                <div key={(l.item_id || l.item_code || i) + '-mfg'} style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, borderBottom:'1px solid #EEF0F4', paddingBottom:6}}>
                  <span style={{fontWeight:800, fontSize:13, color:'#041B3C'}}>{l.item_code}{l.stage_type ? <span style={{color:'#737685', fontWeight:700, fontSize:11, marginLeft:6}}>{l.stage_type}</span> : null}</span>
                  <span style={{fontWeight:900, fontSize:13, color:'#92400E'}}>{fmt(num(l.shortage_qty))} {l.required_uom || 'PCS'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        </details>
        {(r.so_plus_buffer_qty != null && (num(r.so_shortage_qty) > 0 || num(r.so_plus_buffer_qty) > 0 || num(r.reorder_suggested_qty) > 0)) ? (() => {
          const cur = num(r.approved_qty);
          const opts = [
            { key:'so',  label:'Make only SO shortage',          qty: num(r.so_shortage_qty) },
            { key:'buf', label:'Make SO + restore STK buffer',   qty: num(r.so_plus_buffer_qty) },
            { key:'reo', label:'Current reorder batch',          qty: num(r.reorder_suggested_qty) },
          ];
          return (
            <div style={{background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'12px 14px', marginBottom:12}}>
              <div style={{fontSize:13, fontWeight:900, color:'#041B3C', marginBottom:2}}>Planning options</div>
              <div style={{fontSize:12, color:'#737685', marginBottom:10}}>Choose how much to make. This sets only this row&rsquo;s plan qty &mdash; nothing else changes until you Create Plan.</div>
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {opts.map(o => {
                  const dSel = (drawerPick && opts.find(x => x.key === drawerPick && x.qty === cur && cur > 0))
                    ? drawerPick
                    : ((opts.find(x => x.qty === cur && x.qty > 0) || {}).key || null);
                  const active = o.key === dSel;
                  return (
                    <button key={o.key} type="button" onClick={() => { setDrawerPick(o.key); onPickQty(o.qty); }}
                      style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, textAlign:'left',
                        border: active ? '2px solid #003D9B' : '1px solid #C3C6D6', borderRadius:10,
                        background: active ? '#EEF3FF' : '#FFFFFF', color:'#041B3C', padding:'10px 12px', cursor:'pointer'}}>
                      <span style={{fontWeight:800, fontSize:13}}>{o.label}</span>
                      <span style={{fontWeight:900, fontSize:14}}>{fmt(o.qty)} PCS{active ? '  \u2713' : ''}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8, marginTop:10, flexWrap:'wrap'}}>
                <span style={{fontSize:12, fontWeight:800, color:'#737685'}}>Custom qty</span>
                <input type="number" min="0" value={cur}
                  onChange={(e) => { setDrawerPick(null); onPickQty(Math.max(0, num(e.target.value))); }}
                  style={{width:120, border:'1px solid #C3C6D6', borderRadius:8, padding:'8px 10px', fontWeight:800, fontSize:14}} />
                <span style={{fontSize:12, color:'#737685'}}>PCS (current plan qty)</span>
              </div>
              {num(r.approved_qty) <= 0
                ? <div style={{fontSize:12, color:'#991B1B', fontWeight:800, marginTop:6}}>Plan qty must be greater than 0.</div>
                : (num(r.approved_qty) !== num(r.suggested_qty)
                    ? <div style={{fontSize:12, color:'#1E3A8A', fontWeight:800, marginTop:6}}>You changed plan qty from system suggestion {fmt(r.suggested_qty)} to {fmt(r.approved_qty)}.</div>
                    : null)}
            </div>
          );
        })() : null}
        {ms.fixes && ms.fixes.length ? (
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            {ms.fixes.map(f=><Link key={f.href + f.label} href={f.href} style={{display:'inline-flex', border:0, borderRadius:12, background:'#003D9B', color:'#FFFFFF', padding:'10px 16px', fontWeight:900, fontSize:14, textDecoration:'none'}}>{f.label}</Link>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// P-1: single source of truth for the 5-state guided result.
// Pure mapping from Engine B (checkTentativePlan) output. No new engine.
// Note: true "Can Produce Partially (qty)" needs a feasible-qty number Engine B
// does not return today -> deferred to P-2; here it collapses into NEED_* states.
function deriveGuidedStatus(result, error) {
  if (error || !result) {
    return { code: 'MATERIAL_CHECK_FAILED', label: 'Material Check Failed', detail: 'Could not verify material feasibility. Treated as NOT READY.' };
  }
  const status = String(result.material_status || '').toUpperCase();
  const unresolved = Array.isArray(result.unresolved_items) ? result.unresolved_items : [];
  const purchase = Array.isArray(result.purchase_material_shortage) ? result.purchase_material_shortage : [];
  const internal = Array.isArray(result.internal_production_gap) ? result.internal_production_gap : [];

  if (status === 'NEEDS_RECIPE' || unresolved.length) {
    return { code: 'RECIPE_MISSING', label: 'Recipe / Mapping Missing', detail: 'No recipe / material source found for this item.' };
  }
  if (status === 'READY') {
    return { code: 'READY', label: 'Ready to Plan', detail: 'Material is available for the requested quantity.' };
  }
  if (purchase.length) {
    return { code: 'NEED_PURCHASE', label: 'Need Purchase First', detail: `${purchase.length} purchasable material(s) short.` };
  }
  if (internal.length) {
    return { code: 'NEED_PRODUCTION', label: 'Need Internal Production First', detail: `${internal.length} internal WIP item(s) short.` };
  }
  return { code: 'BLOCKED', label: 'Blocked — material short', detail: 'Material shortage detected.' };
}

function readPressDraftItemKeys() {
  if (typeof window === 'undefined') return new Set();

  try {
    const draft = JSON.parse(localStorage.getItem('production_plan_draft') || '{}');
    return new Set((draft.items || []).map(x => String(x.item_id || x.id || x.item_code || '')).filter(Boolean));
  } catch {
    return new Set();
  }
}

function isSentToPressPlanner(row, keys) {
  return keys.has(String(row.item_id || '')) || keys.has(String(row.item_code || ''));
}

// P-2D: Engine-B-first readiness gate. press_ready_qty (Engine B) is the
// truth when present; otherwise fall back to BP-only feasibility. Mirrors the
// hasReady / readyQty decision already used in sendToPlanning. Boolean only.
function isEngineReady(r){
  if (r.press_ready_qty != null) return Number(r.press_ready_qty) > 0;
  return num(r.bp_feasible_qty) > 0 || num(r.bp_feasible_pcs) > 0;
}

function withBpFeasibleRows(rows) {
  const remainingByBp = new Map();

  return rows.map((r) => {
    const desiredQty = num(r.approved_qty);
    const desiredPcs = productionPcs(r, desiredQty);
    const bpKey = r.bp_item_id || r.bp_item_code || `NO_BP_${r.item_id}`;

    if (!remainingByBp.has(bpKey)) {
      remainingByBp.set(bpKey, num(r.bp_available_pcs));
    }

    let availableBefore = remainingByBp.get(bpKey);
    let feasiblePcs = 0;

    if (r.selected && r.bp_item_id) {
      feasiblePcs = Math.min(desiredPcs, availableBefore);
      const pcsPerSet = num(r.pcs_per_set) || 4;
      if (String(r.uom_code || '').toUpperCase() === 'SET') {
        feasiblePcs = Math.floor(feasiblePcs / pcsPerSet) * pcsPerSet;
      } else {
        feasiblePcs = Math.floor(feasiblePcs);
      }
      remainingByBp.set(bpKey, Math.max(0, availableBefore - feasiblePcs));
    } else if (!r.selected && r.bp_item_id) {
      feasiblePcs = Math.min(desiredPcs, availableBefore);
    }

    const pendingPcs = Math.max(0, desiredPcs - feasiblePcs);
    const status =
      !r.bp_item_id ? 'BP_NOT_MAPPED' :
      feasiblePcs >= desiredPcs && desiredPcs > 0 ? 'BP_READY' :
      feasiblePcs > 0 ? 'BP_PARTIAL' :
      'BP_NOT_AVAILABLE';

    return {
      ...r,
      desired_pcs: desiredPcs,
      bp_available_before_pcs: availableBefore,
      bp_feasible_pcs: feasiblePcs,
      bp_feasible_qty: qtyFromPcs(r, feasiblePcs),
      bp_pending_pcs: pendingPcs,
      bp_pending_qty: qtyFromPcs(r, pendingPcs),
      bp_status_live: status,
    };
  });
}

export default function DemandProductionEnginePage(){
  const router = useRouter();
  const [rows,setRows] = useState([]);
  const [pressDraftKeys,setPressDraftKeys] = useState(new Set());
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    item_id: null,
    item_code: '',
    item_name: '',
    qty: '',
    uom_code: 'PCS',
    reason: 'Manual Production',
    notes: '',
  });
  const [manualSearchResults, setManualSearchResults] = useState([]);
  const [manualSearching, setManualSearching] = useState(false);
  const [manualSearchMessage, setManualSearchMessage] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [internalDraft, setInternalDraft] = useState(null); // P-3B: internal_production_draft review state
  const [creatingPlan, setCreatingPlan] = useState(false); // P-3E.4: Create Internal Production Plan submit guard
  const [creatingPlanItemId, setCreatingPlanItemId] = useState(null); // MRP-PHASE-3C-MAKE: per-row plan create guard
  const [creatingBulkPlan, setCreatingBulkPlan] = useState(false); // MRP-PHASE-3C-MAKE-BULK: selected STK plan submit guard
  const [selectedMrpMakeIds, setSelectedMrpMakeIds] = useState(new Set()); // MRP-PHASE-3C-MAKE-BULK: Manufacture tab STK selections
  const [drawerRowId, setDrawerRowId] = useState(null); // A2-MRP-ZONES: row details drawer
  const [activeFamilyKey, setActiveFamilyKey] = useState(null); // G1-GUIDED: active demand family
  const [previewKind, setPreviewKind] = useState(null);         // G1-GUIDED: action-result preview ('purchase')
  const [submittingPR, setSubmittingPR] = useState(false);       // G1-GUIDED: double-click guard
  const [moreOpen, setMoreOpen] = useState(false);               // G1-GUIDED: collapse old tables
  const [activeMrpTab, setActiveMrpTab] = useState('purchase'); // PHASE-A-UX: decision tabs (frontend-only)
  const editedQtyRef = useRef(new Map());                         // G1B-QTY-OVERRIDE: preserve user qty across re-fetch

  // P-3B: load the review-only internal_production_draft AFTER mount (avoids
  // SSR/hydration mismatch). localStorage-only; no DB/API/Press Planner.
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem('internal_production_draft') || 'null');
      setInternalDraft(d && Array.isArray(d.items) ? d : null);
    } catch {
      setInternalDraft(null);
    }
  }, []);

  // MRP-PHASE-3C-MAKE: reusable loader so we can refetch after creating a plan.
  // MRP-PERF-2: Strong dev/StrictMode guard. useRef resets on remount, so this uses
  // module-level in-flight/cache state to prevent duplicate MRP engine computes.
  const applySuggestionRows = (data, sentKeys) => {
    setRows((data ?? []).map(r=>{
      const sent = isProduction(r) && isSentToPressPlanner(r, sentKeys);
      return {
        ...r,
        sent_to_press_planner: sent,
        selected:isProduction(r) && isEngineReady(r) && !sent, // P-2D: Engine-B-first
        approved_qty: editedQtyRef.current.has(`${r.item_id}-${r.reason}`) ? editedQtyRef.current.get(`${r.item_id}-${r.reason}`) : r.suggested_qty, // G1B-QTY-OVERRIDE: keep user edit
      };
    }));
    return data;
  };

  const loadSuggestions = ({ force = false } = {}) => {
    const sentKeys = readPressDraftItemKeys();
    setPressDraftKeys(sentKeys);

    if (!force && mrpSuggestionsInFlight) {
      return mrpSuggestionsInFlight.then(data => applySuggestionRows(data, sentKeys));
    }

    if (!force && mrpSuggestionsLastData && (Date.now() - mrpSuggestionsLastAt) < MRP_SUGGESTIONS_DEV_CACHE_MS) {
      return Promise.resolve(applySuggestionRows(mrpSuggestionsLastData, sentKeys));
    }

    const request = api.get('/api/v1/demand-production-engine/suggestions')
      .then(({data})=>{
        mrpSuggestionsLastData = data ?? [];
        mrpSuggestionsLastAt = Date.now();
        return mrpSuggestionsLastData;
      })
      .finally(()=>{
        if (mrpSuggestionsInFlight === request) mrpSuggestionsInFlight = null;
      });

    mrpSuggestionsInFlight = request;
    return request.then(data => applySuggestionRows(data, sentKeys));
  };

  useEffect(()=>{ loadSuggestions(); },[]);

  const production = useMemo(()=>rows.filter(isProduction),[rows]);
  const purchase = useMemo(()=>rows.filter(r=>!isProduction(r)),[rows]);
  const bpRows = useMemo(()=>withBpFeasibleRows(production),[production]);

  const selectedProduction = bpRows.filter(r=>r.selected && !r.sent_to_press_planner);
  const feasibleProduction = bpRows.filter(r=>r.selected && !r.sent_to_press_planner && isEngineReady(r)); // P-2D: Engine-B-first
  // A2-MRP-ZONES: group rows + summary counts from the same mrpRowStatus (no new statuses).
  const mrpRows = bpRows.map(r => ({ r, ms: mrpRowStatus(r) }));
  const zoneReady = mrpRows.filter(x => mrpZone(x.ms.key) === 'ready');
  const zoneFix   = mrpRows.filter(x => mrpZone(x.ms.key) === 'fix');
  const mrpCounts = {
    ready:    mrpRows.filter(x => x.ms.key === 'READY' || x.ms.key === 'PARTIAL').length,
    mapping:  mrpRows.filter(x => x.ms.key === 'MAP' || x.ms.key === 'RECIPE').length,
    purchase: mrpRows.filter(x => x.ms.key === 'PURCHASE').length,
    blocked:  mrpRows.filter(x => x.ms.key === 'WIP' || x.ms.key === 'FAILED' || x.ms.key === 'BLOCKED').length,
  };
  const openDrawer = (r) => setDrawerRowId(keyOf(r));
  // MRP-UX-PHASE-A-MERGED: open per-SKU drawer for the demand SKU driving an aggregated line.
  const openFromEntry = (entry) => {
    const src = ((entry && entry.sources) || [])[0];
    const row = src ? familyRows.find(r => r.item_code === src) : null;
    if (row) openDrawer(row);
  };
  // G1-GUIDED: active demand family (one connected SET -> STK -> materials -> stages at a time).
  // MRP-SO-1: customer-order demand families come from ALL rows carrying sales_demand_pcs (incl SET
  // items whose code lacks the _SET suffix and thus stay stage_type='SET'), not production-typed rows
  // only. isProduction / selection / press-planner / purchase split are unchanged.
  const familyRows = (() => { const fam = rows.filter(r => num(r.sales_demand_pcs) > 0); return fam.length ? fam : bpRows; })();
  // MRP-SET-DEMAND-CG1: customer-order material totals come only from approved-SO demand rows.
  // Reorder/MTS rows remain in the separate Reorder / Stock Level section.
  const customerDemandRows = useMemo(() => rows.filter(r => num(r.sales_demand_pcs) > 0), [rows]);
  // PLANNING-UX-1B: View Shortage opens for dashboard SKUs too — search demand rows, not only bpRows.
  const drawerRow = drawerRowId
    ? (bpRows.find(r => keyOf(r) === drawerRowId)
       || familyRows.find(r => keyOf(r) === drawerRowId)
       || null)
    : null;
  const families = familyRows.map(r => ({ key: keyOf(r), setCode: (Array.isArray(r.sales_sources) && r.sales_sources[0] && r.sales_sources[0].item_code) || r.item_code, stkCode: r.item_code }));
  const activeFamily = (activeFamilyKey && familyRows.find(r => keyOf(r) === activeFamilyKey)) || familyRows[0] || null;
  const activeFamilyMs = activeFamily ? mrpRowStatus(activeFamily) : null;
  const activeFamilyItemCode = activeFamily ? activeFamily.item_code : '';
  const activeBlockers = (activeFamily && Array.isArray(activeFamily.purchase_material_shortage)) ? activeFamily.purchase_material_shortage : [];
  const activeStages = (activeFamily && Array.isArray(activeFamily.internal_production_gap)) ? activeFamily.internal_production_gap : [];
  const activeBlockerLines = activeBlockers.map(e => ({ item_id:e.item_id, item_code:e.item_code, item_name:e.item_name, stage_type:e.stage_type, required_qty:Number(e.required_qty || e.shortage_qty || 0), available_qty:Number(e.available_qty || 0), shortage_qty:Number(e.shortage_qty || 0), uom_code:e.required_uom, sources:Array.isArray(e.sources) ? e.sources : [], reason:'REORDER' })).filter(l => Number(l.shortage_qty) > 0);
  const scrollTo = (id) => { setMoreOpen(true); setTimeout(() => { const el = typeof document !== 'undefined' ? document.getElementById(id) : null; if (el) el.scrollIntoView({ behavior:'smooth', block:'start' }); }, 60); };
  // G1B-QTY-OVERRIDE: user override wins. Clamp >= 0; remember the edit so a re-fetch will not silently reset it.
  const setPlanQty = (row, qty) => { const q = Math.max(0, num(qty)); editedQtyRef.current.set(keyOf(row), q); updateRow(row, { approved_qty: q }); };
  const selectRow = (r, checked) => updateRow(r, { selected: checked });
  const selectedPurchase = purchase.filter(r=>r.selected);

  // P-2E2: Purchase Suggestions sourced from Engine B purchase_material_shortage[].
  // Flatten production rows' entries; keep purchasable shortages only; dedup by
  // item_id; sum shortage_qty; merge sources. internal_production_gap is never read.
  // MRP-PHASE-3C-BUY.2: aggregate purchasable shortage per item AND net open Purchase Requirement qty.
  // already_requested_purchase_qty is item-level (identical across demand rows), so it is captured ONCE
  // per item and subtracted after summing gross shortage. net <= 0 -> item fully requested, so it drops
  // out of Purchase Needed and shows under Already Requested instead. Partial cover -> only balance shows.
  const purchaseSuggestions = useMemo(() => {
    const map = new Map();
    for (const row of customerDemandRows) {
      const arr = Array.isArray(row.purchase_material_shortage) ? row.purchase_material_shortage : [];
      for (const e of arr) {
        if (!e || e.is_purchasable !== true) continue;
        const shortage = Number(e.shortage_qty);
        if (!(shortage > 0) || !e.item_id) continue;
        const srcs = Array.isArray(e.sources) ? e.sources : [];
        const alreadyReq = Math.max(0, Number(e.already_requested_purchase_qty || 0));
        const refs = Array.isArray(e.already_requested_purchase_refs) ? e.already_requested_purchase_refs : [];
        const prev = map.get(e.item_id);
        if (prev) {
          prev.gross_shortage_qty += shortage;
          prev.required_qty += Number(e.required_qty || 0);
          prev.already_requested_purchase_qty = Math.max(prev.already_requested_purchase_qty, alreadyReq);
          for (const s of srcs) if (!prev.sources.includes(s)) prev.sources.push(s);
          for (const r of refs) if (!prev.refs.some(x => (x.pr_id || x.request_no) === (r.pr_id || r.request_no))) prev.refs.push(r);
        } else {
          map.set(e.item_id, {
            item_id: e.item_id,
            item_code: e.item_code,
            item_name: e.item_name,
            stage_type: e.stage_type,
            required_uom: e.required_uom || e.uom_code || '',
            required_qty: Number(e.required_qty || 0),
            available_qty: Number(e.available_qty || 0),
            gross_shortage_qty: shortage,
            already_requested_purchase_qty: alreadyReq,
            sources: [...srcs],
            refs: [...refs],
          });
        }
      }
    }
    return Array.from(map.values())
      .map((e) => {
        const net = Math.max(0, Number(e.gross_shortage_qty || 0) - Number(e.already_requested_purchase_qty || 0));
        return { ...e, shortage_qty: net, net_shortage_qty: net };
      })
      .filter((e) => Number(e.shortage_qty) > 0);
  }, [customerDemandRows]);

  const [purchaseDeselected, setPurchaseDeselected] = useState(() => new Set());
  const isPurchaseSelected = (id) => !purchaseDeselected.has(id);
  function togglePurchase(id, checked) {
    setPurchaseDeselected(prev => {
      const next = new Set(prev);
      if (checked) next.delete(id); else next.add(id);
      return next;
    });
  }
  // 3C-Buy.1: selectable purchase rows = aggregated purchasable shortages with qty > 0.
  // purchaseSuggestions already excludes STK/manufacture rows (sourced from purchase_material_shortage,
  // is_purchasable===true) and drops shortage_qty<=0, so this stays purchase-only.
  const isPurchaseSelectable = (e) => Number(e?.shortage_qty) > 0;
  const selectablePurchaseSuggestions = purchaseSuggestions.filter(isPurchaseSelectable);
  const selectedPurchaseSuggestions = purchaseSuggestions.filter(e => isPurchaseSelectable(e) && isPurchaseSelected(e.item_id));
  const allPurchaseSelected = selectablePurchaseSuggestions.length > 0
    && selectablePurchaseSuggestions.every(e => isPurchaseSelected(e.item_id));
  function toggleAllPurchase(checked) {
    setPurchaseDeselected(prev => {
      const next = new Set(prev);
      for (const e of selectablePurchaseSuggestions) { if (checked) next.delete(e.item_id); else next.add(e.item_id); }
      return next;
    });
  }

  // P-2F: read-only MRP guidance aggregators (additive; no purchase/gating change).
  const mappingRequired = useMemo(() => {
    return bpRows.filter(r =>
      r.bp_status_live === 'BP_NOT_MAPPED' ||
      r.guided_status === 'RECIPE_MISSING' ||
      (Array.isArray(r.unresolved_items) && r.unresolved_items.length > 0)
    );
  }, [bpRows]);

  const internalProductionNeeded = useMemo(() => {
    const map = new Map();
    for (const row of customerDemandRows) {
      const arr = Array.isArray(row.internal_production_gap) ? row.internal_production_gap : [];
      for (const g of arr) {
        if (!g || !g.item_id) continue;
        const rawShortage = Number(g.original_shortage_qty ?? g.shortage_qty);
        if (!(rawShortage > 0)) continue;
        const openRequested = Math.min(rawShortage, Math.max(0, Number(g.open_requested_qty || 0)));
        const shortage = Math.max(0, rawShortage - openRequested);
        if (!(shortage > 0)) continue;
        const srcs = Array.isArray(g.sources) ? g.sources : [];
        const prev = map.get(g.item_id);
        if (prev) {
          prev.shortage_qty += shortage;
          prev.required_qty += Number(g.required_qty || rawShortage || 0); // MRP-UX-PHASE-A-MERGED
          prev.open_requested_qty += openRequested;
          prev.original_shortage_qty += rawShortage;
          for (const s of srcs) if (!prev.sources.includes(s)) prev.sources.push(s);
        } else {
          map.set(g.item_id, {
            item_id: g.item_id,
            item_code: g.item_code,
            item_name: g.item_name,
            stage_type: g.stage_type,
            required_uom: g.required_uom || g.uom_code || '',
            required_qty: Number(g.required_qty || rawShortage || 0),   // MRP-UX-PHASE-A-MERGED
            available_qty: Number(g.available_qty || 0), // MRP-UX-PHASE-A-MERGED
            shortage_qty: shortage,
            original_shortage_qty: rawShortage,
            open_requested_qty: openRequested,
            sources: [...srcs],
          });
        }
      }
    }
    return Array.from(map.values());
  }, [customerDemandRows]);

  // MRP-PHASE-3C-BUY.2: BP/RM already requested via open Purchase Requirements (item-level dedup).
  const purchaseAlreadyRequested = useMemo(() => {
    const map = new Map();
    for (const row of customerDemandRows) {
      const arr = Array.isArray(row.purchase_material_shortage) ? row.purchase_material_shortage : [];
      for (const e of arr) {
        if (!e || e.is_purchasable !== true || !e.item_id) continue;
        const openReq = Math.max(0, Number(e.already_requested_purchase_qty || 0));
        if (!(openReq > 0)) continue;
        const gross = Math.max(0, Number(e.shortage_qty || e.original_shortage_qty || 0));
        const refs = Array.isArray(e.already_requested_purchase_refs) ? e.already_requested_purchase_refs : [];
        const prev = map.get(e.item_id);
        if (prev) {
          prev.required_qty += gross;
          for (const r of refs) if (!prev.refs.some(x => (x.pr_id || x.request_no) === (r.pr_id || r.request_no))) prev.refs.push(r);
        } else {
          map.set(e.item_id, {
            item_id: e.item_id,
            item_code: e.item_code,
            item_name: e.item_name,
            stage_type: e.stage_type,
            kind: 'BUY',
            request_type: 'PR',
            required_uom: e.required_uom || e.uom_code || '',
            required_qty: gross,
            open_requested_qty: openReq,
            refs: [...refs],
            sources: Array.isArray(e.sources) ? [...e.sources] : [],
          });
        }
      }
    }
    return Array.from(map.values()).map((e) => ({
      ...e,
      balance_qty: Math.max(0, Number(e.required_qty || 0) - Number(e.open_requested_qty || 0)),
    }));
  }, [customerDemandRows]);

  const manufactureAlreadyRequested = useMemo(() => {
    const map = new Map();
    for (const row of customerDemandRows) {
      const entries = Array.isArray(row.already_requested_make) && row.already_requested_make.length
        ? row.already_requested_make
        : (Array.isArray(row.internal_production_gap) ? row.internal_production_gap : []).filter(g => Number(g?.open_requested_qty || 0) > 0);
      for (const g of entries) {
        if (!g || !g.item_id) continue;
        const openRequested = Math.max(0, Number(g.open_requested_qty || 0));
        if (!(openRequested > 0)) continue;
        const required = Math.max(openRequested, Number(g.required_qty || g.original_shortage_qty || g.shortage_qty || 0));
        const balance = Math.max(0, Number(g.balance_qty ?? g.balance_after_requested_qty ?? (required - openRequested)));
        const srcs = Array.isArray(g.sources) ? g.sources : [];
        const refs = Array.isArray(g.refs) ? g.refs : (Array.isArray(g.already_requested_refs) ? g.already_requested_refs : []);
        const prev = map.get(g.item_id);
        if (prev) {
          prev.required_qty += required;
          prev.open_requested_qty += openRequested;
          prev.balance_qty += balance;
          for (const s of srcs) if (!prev.sources.includes(s)) prev.sources.push(s);
          for (const ref of refs) prev.refs.push(ref);
        } else {
          map.set(g.item_id, {
            item_id: g.item_id,
            item_code: g.item_code,
            item_name: g.item_name,
            stage_type: g.stage_type,
            kind: 'MAKE',
            request_type: g.request_type || 'PPO',
            required_uom: g.uom_code || g.required_uom || 'PCS',
            required_qty: required,
            open_requested_qty: openRequested,
            balance_qty: balance,
            sources: [...srcs],
            refs: [...refs],
          });
        }
      }
    }
    return Array.from(map.values()).filter(e => String(e.stage_type || '').toUpperCase() === 'STK' || Number(e.open_requested_qty) > 0);
  }, [customerDemandRows]);


  // MRP-PHASE-A-UX: decision page derives a top make-target list from the existing exploded chain.
  // Main Manufacture Needed shows STK/output planning targets only; full PF/SBBP/... chain stays in Technical View/drawer.
  const manufactureNeededTop = useMemo(() => {
    return internalProductionNeeded.filter(g => String(g.stage_type || '').toUpperCase() === 'STK');
  }, [internalProductionNeeded]);
  const visibleProductionNeeded = activeMrpTab === 'make' ? manufactureNeededTop : internalProductionNeeded;
  const selectableMrpMakeRows = useMemo(() => {
    if (activeMrpTab !== 'make') return [];
    return manufactureNeededTop.filter(g =>
      String((g && g.stage_type) || '').toUpperCase() === 'STK' && Math.max(0, num(g && (g.balance_qty ?? g.shortage_qty))) > 0
    );
  }, [activeMrpTab, manufactureNeededTop]);
  const selectableMrpMakeIds = useMemo(() => new Set(selectableMrpMakeRows.map(g => String(g.item_id))), [selectableMrpMakeRows]);
  const selectedMrpMakeRows = useMemo(() => selectableMrpMakeRows.filter(g => selectedMrpMakeIds.has(String(g.item_id))), [selectableMrpMakeRows, selectedMrpMakeIds]);
  const allVisibleMrpMakeSelected = selectableMrpMakeRows.length > 0 && selectedMrpMakeRows.length === selectableMrpMakeRows.length;

  useEffect(() => {
    setSelectedMrpMakeIds(prev => {
      const next = new Set([...prev].filter(id => selectableMrpMakeIds.has(String(id))));
      return next.size === prev.size ? prev : next;
    });
  }, [selectableMrpMakeIds]);
  const drivingDemandText = useMemo(() => {
    const list = (customerDemandRows || []).map(r => {
      const sources = Array.isArray(r.sales_sources) ? r.sales_sources : [];
      const first = sources[0] || null;
      const salesQty = r.sales_demand_qty != null ? num(r.sales_demand_qty) : sources.reduce((acc, x) => acc + num(x.qty), 0);
      const salesUom = String(r.sales_uom || (first && first.uom_code) || '').toUpperCase();
      const code = (first && first.item_code) || r.item_code;
      return `${code} ${fmt(salesQty)}${salesUom ? ' ' + salesUom : ''}`;
    }).filter(Boolean);
    return list.join(', ');
  }, [customerDemandRows]);

  // MRP-UX-3: actionable read-only derivations (no engine/DB/schema change).
  // (B) Reorder/stock-level shortage: demand rows whose current stock is below the
  //     min/reorder level. short = reorder_level - stock (clamped). 0-short hidden.
  const reorderShortage = useMemo(() => {
    return (Array.isArray(production) ? production : [])
      .map(r => {
        const stock = num(r.stock_qty);
        const level = num(r.reorder_level);
        return { item_id: r.item_id, item_code: r.item_code, item_name: r.item_name,
                 stock_qty: stock, reorder_level: level, reorder_qty: num(r.reorder_qty),
                 short_qty: Math.max(0, level - stock), row: r };
      })
      .filter(x => x.reorder_level > 0 && x.short_qty > 0);
  }, [production]);
  // Why-needed: union of demand reasons across the source SKUs that drove a line.
  // sales = that SKU has customer demand; reorder = that SKU is below reorder level.
  const reasonByCode = useMemo(() => {
    const m = new Map();
    for (const r of (Array.isArray(rows) ? rows : [])) {
      m.set(r.item_code, {
        sales: num(r.sales_demand_pcs) > 0 || num(r.so_shortage_qty) > 0,
        reorder: num(r.reorder_level) > 0 && num(r.stock_qty) < num(r.reorder_level),
      });
    }
    return m;
  }, [rows]);
  const whyForSources = (sources) => {
    let sales = false, reorder = false;
    for (const code of (Array.isArray(sources) ? sources : [])) {
      const rr = reasonByCode.get(code);
      if (rr) { sales = sales || rr.sales; reorder = reorder || rr.reorder; }
    }
    if (sales && reorder) return 'Both';
    if (sales) return 'Sales order';
    if (reorder) return 'Reorder level';
    return '\u2014';
  };

  const readyCount = production.filter(r => Number(r.press_ready_qty) > 0).length;
  const blockedCount = production.filter(r => Number(r.blocked_qty) > 0).length;

  // P-3A: stage Internal Production Needed items into a SEPARATE localStorage
  // draft (internal_production_draft). Review-only: NO WO/PPO, NO backend, NO
  // route push, and NOT the press draft (production_plan_draft). Dedup by
  // item_id; merge/sum qty on re-add. No consumer yet (P-3B will wire review).
  function addToInternalProductionDraft() {
    const items = (internalProductionNeeded || []).filter(g => g && g.item_id && Number(g.shortage_qty) > 0);
    if (!items.length) {
      alert('No internal production shortage to add.');
      return;
    }
    const now = new Date().toISOString();
    let draft;
    try {
      draft = JSON.parse(localStorage.getItem('internal_production_draft') || '{}');
    } catch {
      draft = {};
    }
    const existing = Array.isArray(draft.items) ? draft.items : [];
    const byId = new Map(existing.map(x => [String(x.item_id), { ...x }]));
    for (const g of items) {
      const key = String(g.item_id);
      const addQty = Number(g.shortage_qty) || 0;
      const prev = byId.get(key);
      if (prev) {
        prev.qty = (Number(prev.qty) || 0) + addQty; // P-3A: merge/sum on re-add
        prev.uom = g.required_uom || prev.uom || '';
        prev.sources = Array.from(new Set([...(prev.sources || []), ...((g.sources) || [])]));
        prev.updated_at = now;
      } else {
        byId.set(key, {
          item_id: g.item_id,
          item_code: g.item_code,
          item_name: g.item_name,
          stage_type: g.stage_type,
          qty: addQty,
          uom: g.required_uom || '',
          sources: Array.isArray(g.sources) ? [...g.sources] : [],
          source_type: 'INTERNAL_PRODUCTION',
          selected: true, // P-3C: new internal draft items default selected
          created_at: now,
          updated_at: now,
        });
      }
    }
    const next = {
      ...draft,
      key: 'internal_production_draft',
      created_at: draft.created_at || now,
      updated_at: now,
      items: Array.from(byId.values()),
    };
    localStorage.setItem('internal_production_draft', JSON.stringify(next));
    setInternalDraft(next); // P-3B: refresh review panel after add
    alert(`Internal Production Draft updated (review only). Items: ${next.items.length}.`);
  }

  // P-3B: review-only local edits on internal_production_draft. localStorage-only;
  // no DB/API/WO/PPO/route/Press Planner.
  function clearInternalDraft() {
    if (!confirm('Clear the Internal Production Draft? This only clears the local review draft.')) return;
    localStorage.removeItem('internal_production_draft');
    setInternalDraft(null);
  }

  function removeInternalDraftItem(itemId) {
    setInternalDraft(prev => {
      const items = (prev && Array.isArray(prev.items) ? prev.items : []).filter(x => String(x.item_id) !== String(itemId));
      if (!items.length) {
        localStorage.removeItem('internal_production_draft');
        return null;
      }
      const next = { ...prev, items, updated_at: new Date().toISOString() };
      localStorage.setItem('internal_production_draft', JSON.stringify(next));
      return next;
    });
  }

  // P-3C: selection-only on the internal draft (which WIP items to send later).
  // localStorage-only; no press-draft write, no navigation, no API/fetch, no
  // Press Planner, no WO/PPO/inventory. No send write-path yet.
  function toggleInternalDraftSelect(itemId, value) {
    setInternalDraft(prev => {
      if (!prev || !Array.isArray(prev.items)) return prev;
      const items = prev.items.map(x =>
        String(x.item_id) === String(itemId) ? { ...x, selected: !!value } : x
      );
      const next = { ...prev, items, updated_at: new Date().toISOString() };
      localStorage.setItem('internal_production_draft', JSON.stringify(next));
      return next;
    });
  }

  function setAllInternalDraftSelected(value) {
    setInternalDraft(prev => {
      if (!prev || !Array.isArray(prev.items) || !prev.items.length) return prev;
      const items = prev.items.map(x => ({ ...x, selected: !!value }));
      const next = { ...prev, items, updated_at: new Date().toISOString() };
      localStorage.setItem('internal_production_draft', JSON.stringify(next));
      return next;
    });
  }

  // P-3D: read-only summary/export of SELECTED internal draft items. Selected =
  // checkbox-checked (selected !== false). Source: internal_production_draft only.
  // Clipboard copy only; no network, no navigation, no WO/PPO, no Press Planner.
  function computeInternalSelectedSummary() {
    const all = (internalDraft && Array.isArray(internalDraft.items)) ? internalDraft.items : [];
    const items = all.filter(x => x && x.selected !== false);
    const totalsMap = new Map();
    for (const it of items) {
      const stage = String(it.stage_type || '—');
      const uom = String(it.uom || '');
      const key = stage + '|' + uom;
      totalsMap.set(key, (Number(totalsMap.get(key)) || 0) + (Number(it.qty) || 0));
    }
    const totals = Array.from(totalsMap.entries()).map(([k, qty]) => {
      const parts = k.split('|');
      return { stage_type: parts[0], uom: parts[1] || '', qty };
    }).sort((a, b) => (a.stage_type + a.uom).localeCompare(b.stage_type + b.uom));
    return { items, count: items.length, totals };
  }

  function internalSummaryToText() {
    const s = computeInternalSelectedSummary();
    const lines = [];
    lines.push('Selected Internal Items (' + s.count + ')');
    lines.push('Totals by stage / uom:');
    if (!s.totals.length) lines.push('  (none)');
    for (const t of s.totals) lines.push('  ' + t.stage_type + ' / ' + (t.uom || '-') + ': ' + fmt(t.qty));
    lines.push('Items:');
    if (!s.items.length) lines.push('  (none)');
    for (const it of s.items) {
      lines.push(('  ' + (it.item_code || '') + '  ' + (it.stage_type || '-') + '  ' + fmt(it.qty) + ' ' + (it.uom || '') + '  ' + (it.item_name || '')).replace(/\s+$/, ''));
    }
    return lines.join('\n');
  }

  function copyToClipboardSafe(text, okMsg) {
    if (!text) { alert('No selected internal items to copy.'); return; }
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => alert(okMsg),
          () => alert('Copy failed. Please select and copy the text manually.')
        );
      } else {
        alert('Clipboard not available in this browser.');
      }
    } catch {
      alert('Clipboard not available in this browser.');
    }
  }

  function copyInternalSummary() {
    copyToClipboardSafe(internalSummaryToText(), 'Selected Internal Items summary copied.');
  }

  function copyInternalSummaryJSON() {
    const s = computeInternalSelectedSummary();
    if (!s.items.length) { alert('No selected internal items to copy.'); return; }
    const payload = {
      kind: 'internal_production_selected',
      count: s.count,
      totals: s.totals,
      items: s.items.map(it => ({
        item_id: it.item_id,
        item_code: it.item_code,
        item_name: it.item_name,
        stage_type: it.stage_type,
        qty: Number(it.qty) || 0,
        uom: it.uom || '',
        sources: Array.isArray(it.sources) ? it.sources : [],
      })),
    };
    copyToClipboardSafe(JSON.stringify(payload, null, 2), 'Selected Internal Items JSON copied.');
  }

  // P-3E.4: send the SELECTED internal draft items (selected !== false) to the backend
  // Internal Production Plan create API via the existing api client. On success show the
  // returned plan number and remove ONLY the sent items from internal_production_draft
  // (unselected rows stay; if none remain, drop the key). Submit-only: no scheduling, no
  // work orders, no navigation, no other local keys.
  async function createInternalPlan() {
    const all = (internalDraft && Array.isArray(internalDraft.items)) ? internalDraft.items : [];
    const selected = all.filter(x => x && x.selected !== false);
    if (!selected.length) { alert('No selected internal items to send.'); return; }
    setCreatingPlan(true);
    try {
      const payload = {
        notes: 'Created from MRP selected internal items',
        items: selected.map(d => ({
          item_id: d.item_id,
          qty: d.qty,
          ...(d.uom_id ? { uom_id: d.uom_id } : {}),
          uom_code: d.uom || undefined,
          stage_type: d.stage_type,
          sources: Array.isArray(d.sources) ? d.sources : [],
          item_code: d.item_code,
        })),
      };
      const res = await api.post('/api/v1/internal-production-plans', payload);
      if (res && res.error) {
        alert((res.error && res.error.message) || 'Failed to create internal production plan.');
        return; // leave draft untouched on failure
      }
      const planNumber = (res && res.data && res.data.plan_number) || '(created)';
      const remaining = all.filter(x => x && x.selected === false);
      if (remaining.length) {
        const next = { ...(internalDraft || {}), items: remaining, updated_at: new Date().toISOString() };
        localStorage.setItem('internal_production_draft', JSON.stringify(next));
        setInternalDraft(next);
      } else {
        localStorage.removeItem('internal_production_draft');
        setInternalDraft(null);
      }
      alert('Internal Production Plan created: ' + planNumber);
    } catch (e) {
      alert((e && e.message) || 'Failed to create internal production plan.');
    } finally {
      setCreatingPlan(false);
    }
  }

  // MRP-PHASE-3C-MAKE: create an Internal Production Plan for ONE STK make-target row.
  // STK-only (chain MIX->...->STK auto-generates downstream from recipe/routing); qty = netted balance.
  // MRP-PHASE-3C-MAKE (merged): plan only from the Manufacture Needed tab, STK targets only, positive balance.
  function mrpPlanQty(g) { return Math.max(0, num(g && (g.balance_qty ?? g.shortage_qty))); }
  function canCreateMrpPlan(g) {
    return activeMrpTab === 'make'
      && String((g && g.stage_type) || '').toUpperCase() === 'STK'
      && mrpPlanQty(g) > 0
      && !creatingPlanItemId
      && !creatingBulkPlan;
  }
  function createMrpPlanTitle(g) {
    if (activeMrpTab !== 'make') return 'Create plans only from the Manufacture Needed tab.';
    if (String((g && g.stage_type) || '').toUpperCase() !== 'STK') return 'MRP sends only STK/output targets to plan; the chain generates later.';
    if (!(mrpPlanQty(g) > 0)) return 'Already covered / requested.';
    if (creatingPlanItemId || creatingBulkPlan) return 'Creating production plan\u2026';
    return 'Create an Internal Production Plan for this STK target.';
  }
  function isSelectableMrpMakeRow(g) {
    return activeMrpTab === 'make'
      && String((g && g.stage_type) || '').toUpperCase() === 'STK'
      && mrpPlanQty(g) > 0;
  }
  function toggleMrpMakeRow(g, checked) {
    if (!isSelectableMrpMakeRow(g)) return;
    const key = String(g.item_id);
    setSelectedMrpMakeIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }
  function toggleAllMrpMakeRows(checked) {
    setSelectedMrpMakeIds(checked ? new Set(selectableMrpMakeRows.map(g => String(g.item_id))) : new Set());
  }

  async function createPlansForSelectedMrpRows() {
    const selected = selectedMrpMakeRows.filter(isSelectableMrpMakeRow);
    if (!selected.length) { alert('Select at least one STK row to create a production plan.'); return; }
    if (creatingBulkPlan || creatingPlanItemId) return;
    const items = selected.map(g => ({
      item_id: g.item_id,
      item_code: g.item_code,
      stage_type: 'STK',
      qty: mrpPlanQty(g),
      ...(g.uom_id ? { uom_id: g.uom_id } : {}),
      uom_code: g.uom_code || g.required_uom || 'PCS',
      sources: Array.isArray(g.sources) ? g.sources : [],
    })).filter(x => x.item_id && x.stage_type === 'STK' && Number(x.qty) > 0);
    if (!items.length) { alert('Selected rows have no STK quantity left to plan.'); return; }
    setCreatingBulkPlan(true);
    try {
      const res = await api.post('/api/v1/internal-production-plans', {
        notes: 'From MRP Manufacture Needed',
        items,
      });
      if (res && res.error) {
        alert((res.error && res.error.message) || 'Failed to create internal production plan.');
        return;
      }
      const planNumber = (res && res.data && res.data.plan_number) || '(created)';
      alert('Internal Production Plan created: ' + planNumber + ' with ' + items.length + ' STK line(s).');
      setSelectedMrpMakeIds(new Set());
      setActiveMrpTab('make');
      await loadSuggestions({ force: true }); // Phase 3A nets the new DRAFT/PLANNED plan -> covered STK rows move to Already Requested
    } catch (e) {
      alert((e && e.message) || 'Failed to create internal production plan.');
    } finally {
      setCreatingBulkPlan(false);
    }
  }

  async function createPlanForRow(g) {
    const stage = String((g && g.stage_type) || '').toUpperCase();
    if (stage !== 'STK') { alert('Only STK targets can be planned from MRP. The full chain auto-generates from the recipe.'); return; }
    const qty = mrpPlanQty(g);
    if (!(qty > 0)) { alert('Nothing left to plan for this item (already covered / requested).'); return; }
    if (creatingPlanItemId || creatingBulkPlan) return;
    setCreatingPlanItemId(g.item_id);
    try {
      const payload = {
        notes: 'From MRP Manufacture Needed',
        items: [{
          item_id: g.item_id,
          item_code: g.item_code,
          stage_type: 'STK',
          qty,
          ...(g.uom_id ? { uom_id: g.uom_id } : {}),
          uom_code: g.uom_code || g.required_uom || 'PCS',
          sources: Array.isArray(g.sources) ? g.sources : [],
        }],
      };
      const res = await api.post('/api/v1/internal-production-plans', payload);
      if (res && res.error) {
        alert((res.error && res.error.message) || 'Failed to create internal production plan.');
        return;
      }
      const planNumber = (res && res.data && res.data.plan_number) || '(created)';
      alert('Internal Production Plan created: ' + planNumber + ' for ' + (g.item_code || g.item_id));
      await loadSuggestions(); // Phase 3A nets the new DRAFT/PLANNED plan -> covered STK row moves to Already Requested
    } catch (e) {
      alert((e && e.message) || 'Failed to create internal production plan.');
    } finally {
      setCreatingPlanItemId(null);
    }
  }

  function updateRow(row, patch){
    setRows(prev => prev.map(x => keyOf(x)===keyOf(row) ? { ...x, ...patch } : x));
  }

  async function searchManualItems(){
    const q = String(manualForm.item_code || '').trim();

    if (q.length < 2) {
      setManualSearchResults([]);
      setManualSearchMessage('Type at least 2 characters to search.');
      return;
    }

    setManualSearching(true);
    setManualSearchMessage('');

    const { data, error } = await api.get('/api/v1/items/search', { search: q, limit: 10 });

    setManualSearching(false);

    if (error) {
      setManualSearchResults([]);
      setManualSearchMessage(error.message || 'Item search failed.');
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    setManualSearchResults(rows);
    setManualSearchMessage(rows.length ? '' : 'No matching SKU found.');
  }

  function selectManualItem(item){
    const code = String(item?.item_code || '').trim().toUpperCase();

    setManualForm(prev => ({
      ...prev,
      item_id: item?.id || null,
      item_code: code,
      item_name: item?.item_name || '',
      uom_code: item?.uom_code || prev.uom_code || 'PCS',
    }));

    setManualSearchResults([]);
    setManualSearchMessage(item?.item_name ? `Selected: ${code} — ${item.item_name}` : `Selected: ${code}`);
  }

  async function submitManualProduction(){
    const code = String(manualForm.item_code || '').trim().toUpperCase();
    const qty = Number(manualForm.qty);

    if (!code) {
      alert('Item Code / SKU is required.');
      return;
    }

    if (!(qty > 0)) {
      alert('Qty must be greater than 0.');
      return;
    }

    const uom = String(manualForm.uom_code || 'PCS').trim().toUpperCase() || 'PCS';
    const pcsPerSet = 4;
    const productionPcs = uom === 'SET' ? qty * pcsPerSet : qty;

    // P-1: feasibility must come from Engine B (deep resolver). Reuse the existing
    // tentative-plan-check for this single item. Never add a manual item as ready
    // without checking; Press Planner Material tab remains the final recheck.
    setManualSubmitting(true);
    let feasibility = null;
    let feasibilityError = null;
    try {
      const { data, error } = await api.post('/api/v1/material-availability/tentative-plan-check', {
        items: [{
          item_code: code,
          item_name: manualForm.item_name || '',
          approved_qty: qty,
          suggested_qty: qty,
          uom_code: uom,
          pcs_per_set: pcsPerSet,
        }],
      });
      if (error) feasibilityError = error;
      else feasibility = data || null;
    } catch (err) {
      feasibilityError = err;
    } finally {
      setManualSubmitting(false);
    }

    const guided = deriveGuidedStatus(feasibility, feasibilityError);

    // Fail-safe: never silently mark infeasible/unknown as ready.
    if (guided.code !== 'READY') {
      const proceed = confirm(
        `${guided.label}\n\n${guided.detail}\n\nAdd to Press Planner anyway as NOT READY? It will not be plan-ready until material is resolved.`
      );
      if (!proceed) return;
    }

    const existingDraft = (() => {
      try {
        return JSON.parse(localStorage.getItem('production_plan_draft') || '{}');
      } catch {
        return {};
      }
    })();

    const existingItems = Array.isArray(existingDraft.items) ? existingDraft.items : [];
    const keyOfDraftItem = (x) => String(x?.item_id || x?.id || x?.item_code || '');
    const manualKey = String(manualForm.item_id || code);

    const manualItem = {
      item_id: manualForm.item_id || null,
      id: manualForm.item_id || null,
      item_code: code,
      item_name: manualForm.item_name || '',
      reason: manualForm.reason || 'Manual Production',
      approved_qty: qty,
      suggested_qty: qty,
      full_demand_qty: qty,
      uom_code: uom,
      stage_type: '',
      pcs_per_set: pcsPerSet,
      production_pcs: productionPcs,
      pending_pcs: 0,
      pending_qty: 0,
      bp_status: 'MANUAL',
      bp_item_id: null,
      bp_item_code: null,
      bp_available_pcs: 0,
      source_type: 'MANUAL_PRODUCTION',
      manual_notes: manualForm.notes || '',
      // P-1.1 guided feasibility stamp (Engine B). Advisory; Material tab stays final.
      material_status: feasibility?.material_status || (guided.code === 'MATERIAL_CHECK_FAILED' ? 'CHECK_FAILED' : 'UNKNOWN'),
      guided_status: guided.code,
      guided_label: guided.label,
      is_material_ready: guided.code === 'READY',
      purchase_material_shortage: feasibility?.purchase_material_shortage || [],
      internal_production_gap: feasibility?.internal_production_gap || [],
      unresolved_items: feasibility?.unresolved_items || [],
      p1_stamp_version: 'P1.1',
    };

    const mergedItems = [
      ...existingItems.filter((x) => keyOfDraftItem(x) !== manualKey),
      manualItem,
    ];

    // P-1.1: verifiable marker so the running build can be confirmed live.
    console.log('[P1.1] manual stamp ->', manualItem.item_code, 'guided=', manualItem.guided_status, 'material_status=', manualItem.material_status, 'version=', manualItem.p1_stamp_version);

    localStorage.setItem('production_plan_draft', JSON.stringify({
      ...existingDraft,
      plan_status: 'TENTATIVE',
      // P-1.1: do not hardcode MANUAL; reflect the guided feasibility result.
      material_status: feasibility?.material_status || (guided.code === 'MATERIAL_CHECK_FAILED' ? 'CHECK_FAILED' : guided.code),
      execution_status: existingDraft.execution_status || 'DRAFT',
      source_type: 'MANUAL_PRODUCTION',
      created_at: existingDraft.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: mergedItems,
    }));

    setManualOpen(false);
    setManualForm({
      item_id: null,
      item_code: '',
      item_name: '',
      qty: '',
      uom_code: 'PCS',
      reason: 'Manual Production',
      notes: '',
    });
    setManualSearchResults([]);
    setManualSearchMessage('');

    alert(`Manual Production added (${guided.label}). Total items in Press Planner: ${mergedItems.length}.`);
    router.push('/press-planner');
  }

  function sendToPlanning(){
    const payload = feasibleProduction.map(r=>{
      // P-2B: prefer Engine B press_ready_qty; fall back to BP-only when absent.
      const hasReady = r.press_ready_qty != null;
      const readyQty = hasReady ? Number(r.press_ready_qty) : Number(r.bp_feasible_qty || 0);
      const readyPcs = hasReady ? productionPcs(r, readyQty) : Number(r.bp_feasible_pcs || 0);
      return {
      item_id:r.item_id,
      item_code:r.item_code,
      item_name:r.item_name,
      reason:r.reason,
      approved_qty:readyQty,
      full_demand_qty:Number(r.approved_qty || 0),
      uom_code:r.uom_code,
      stage_type:r.stage_type,
      pcs_per_set:r.pcs_per_set,
      production_pcs:readyPcs,
      pending_pcs:Number(r.bp_pending_pcs || 0),
      pending_qty:Number(r.bp_pending_qty || 0),
      bp_status:r.bp_status_live,
      bp_item_id:r.bp_item_id,
      bp_item_code:r.bp_item_code,
      bp_available_pcs:Number(r.bp_available_pcs || 0),
      press_ready_qty: hasReady ? readyQty : null,
      blocked_qty: r.blocked_qty != null ? Number(r.blocked_qty) : null,
      press_ready_basis: r.press_ready_basis || null,
      source_type: hasReady ? 'PRESS_READY_MRP' : 'BP_FEASIBLE_MRP',
      };
    });

    if (!payload.length) {
      alert('No BP-feasible quantity available. PPO cannot be created.');
      return;
    }

    const existingDraft = (() => {
      try {
        return JSON.parse(localStorage.getItem('production_plan_draft') || '{}');
      } catch {
        return {};
      }
    })();

    const existingItems = Array.isArray(existingDraft.items) ? existingDraft.items : [];
    const keyOfDraftItem = (x) => String(x?.item_id || x?.id || x?.item_code || '');
    const newKeys = new Set(payload.map(keyOfDraftItem).filter(Boolean));

    const mergedItems = [
      ...existingItems.filter((x) => !newKeys.has(keyOfDraftItem(x))),
      ...payload,
    ];

    const partialCount = mergedItems.filter(x => x.bp_status === 'BP_PARTIAL').length;
    const skippedCount = selectedProduction.length - payload.length;

    localStorage.setItem('production_plan_draft', JSON.stringify({
      ...existingDraft,
      plan_status: 'TENTATIVE',
      material_status: partialCount ? 'BP_PARTIAL' : 'BP_READY',
      execution_status: 'BLOCKED',
      source_type: 'BP_FEASIBLE_MRP',
      created_at: existingDraft.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: mergedItems,
    }));

    alert(`MTS plan updated. Added: ${payload.length}. Total in Press Planner: ${mergedItems.length}. Partial BP: ${partialCount}. Skipped: ${skippedCount}.`);
    router.push('/press-planner');
  }

  async function createPurchaseRequest(){
    if (!selectedPurchaseSuggestions.length) return;

    // P-2E2: lines come from Engine B purchasable shortages (aggregated),
    // not the old non-production purchase rows. Backend payload shape unchanged.
    const lines = selectedPurchaseSuggestions
      .map((e) => ({
        item_id: e.item_id,
        item_code: e.item_code,
        item_name: e.item_name,
        stage_type: e.stage_type,
        required_qty: Number(e.required_qty || e.shortage_qty || 0),
        available_qty: Number(e.available_qty || 0),
        shortage_qty: Number(e.shortage_qty || 0),
        uom_code: e.required_uom,
        sources: Array.isArray(e.sources) ? e.sources : [],
        reason: 'REORDER',
      }))
      .filter((l) => Number(l.shortage_qty) > 0);

    if (!lines.length) {
      alert('Selected purchase suggestions have zero suggested quantity. Nothing to order.');
      return;
    }

    await submitPurchaseLines(lines);
  }

  // G1-GUIDED: faithful extract of the confirmed Purchase Request submit (behavior preserved; adds a
  // double-click guard only). Both the Purchase Suggestions panel and the guided card call this.
  async function submitPurchaseLines(lines){
    if (!Array.isArray(lines) || !lines.length) return;
    if (submittingPR) return;
    setSubmittingPR(true);
    try {
      const { data, error } = await api.post('/api/v1/material-availability/purchase-requirement', {
        lines,
        source_type: 'REORDER',
        material_status: 'SHORTAGE',
        notes: 'Created from Demand / MRP Engine. Reason: REORDER.',
      });
      if (error) {
        alert(`Failed to create Purchase Request: ${error.message || error.code || 'Unknown error'}`);
        return;
      }
      const pr = data?.purchase_requirement || data || {};
      const prId = pr.id ?? null;
      alert(`Purchase Request created${pr.pr_no ? ` (${pr.pr_no})` : ''} with ${lines.length} item(s).`);
      router.push(prId ? `/purchase-requirements/${prId}` : '/purchase-requirements');
    } finally {
      setSubmittingPR(false);
    }
  }

  return (
    <div style={S.page}>
      <h1 style={S.title}>Demand / MRP Engine</h1>

      {/* MRP-PHASE-A-UX: main page is a decision board. Demand table and exploded chain moved to Technical View. */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:10, margin:'10px 0 12px'}}>
        <button type="button" onClick={() => setActiveMrpTab('purchase')} style={{...S.kpi, textAlign:'left', cursor:'pointer', borderColor: activeMrpTab === 'purchase' ? '#003D9B' : '#DCDFE4'}}>
          <div style={S.label}>Purchase Needed</div><div style={S.big}>{purchaseSuggestions.length}</div>
        </button>
        <button type="button" onClick={() => setActiveMrpTab('make')} style={{...S.kpi, textAlign:'left', cursor:'pointer', borderColor: activeMrpTab === 'make' ? '#003D9B' : '#DCDFE4'}}>
          <div style={S.label}>Manufacture Needed</div><div style={S.big}>{manufactureNeededTop.length}</div>
        </button>
        <button type="button" onClick={() => setActiveMrpTab('requested')} style={{...S.kpi, textAlign:'left', cursor:'pointer', borderColor: activeMrpTab === 'requested' ? '#003D9B' : '#DCDFE4'}}>
          <div style={S.label}>Already Requested</div><div style={S.big}>{manufactureAlreadyRequested.length + purchaseAlreadyRequested.length}</div>
        </button>
      </div>

      <div style={{...S.panel, padding:'10px 14px', marginBottom:12, display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap'}}>
        <div style={{fontSize:13, color:'#334155'}}><b>Driving demand:</b> {drivingDemandText || 'No approved sales-order demand'}</div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          {Object.entries(PHASE_A_TAB_LABELS).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setActiveMrpTab(key)} style={phaseATabButton(activeMrpTab === key)}>{label}</button>
          ))}
        </div>
      </div>

      {/* MRP-UX-PHASE-2: Reorder/stock-level details are no longer a separate daily-planning block. */}

      {/* MRP-PHASE-A-UX: Purchase Needed decision tab — purchasable shortages only. */}
      <div style={{...S.panel, marginTop:12, display: activeMrpTab === 'purchase' ? 'block' : 'none'}}>
        {/* MRP-PHASE-3C-BUY.1: bulk select -> ONE Purchase Requirement (reuses createPurchaseRequest). */}
        <div style={{display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', padding:'10px 14px 0'}}>
          <div style={{fontSize:15, fontWeight:900, color:'#041B3C'}}>Purchase Needed — buy material (BP / RM) ({purchaseSuggestions.length})</div>
          <button type="button"
            disabled={!selectedPurchaseSuggestions.length || submittingPR}
            title={!selectedPurchaseSuggestions.length ? 'Select at least one purchasable row.' : 'Create one Purchase Request with the selected BP/RM lines.'}
            style={{...S.btn, ...((selectedPurchaseSuggestions.length && !submittingPR) ? {cursor:'pointer'} : {opacity:.55, cursor:'not-allowed'})}}
            onClick={createPurchaseRequest}>
            {submittingPR ? 'Creating…' : `Create Purchase Request for Selected${selectedPurchaseSuggestions.length ? ` (${selectedPurchaseSuggestions.length})` : ''}`}
          </button>
        </div>
        <div style={{fontSize:12, color:'#737685', padding:'8px 14px'}}>Select one or more purchasable BP / RM rows; all selected rows go into a single draft Purchase Request (one request, multiple lines). Rows with no shortage are not selectable.</div>
        <div style={{overflowX:'auto'}}>
          <table style={{...S.table, minWidth:860}}>
            <thead><tr>{['','Item','Item name','Required','Available','Short','Why needed'].map((h, idx)=><th key={idx} style={S.th}>{idx === 0 ? <input type="checkbox" checked={allPurchaseSelected} disabled={!selectablePurchaseSuggestions.length || submittingPR} onChange={(ev) => toggleAllPurchase(ev.target.checked)} title="Select all purchasable rows." /> : h}</th>)}</tr></thead>
            <tbody>
              {purchaseSuggestions.map(e => {
                const selectable = isPurchaseSelectable(e);
                const checked = selectable && isPurchaseSelected(e.item_id);
                return (
                  <tr key={e.item_id} style={{cursor:'pointer'}} onClick={() => openFromEntry(e)}>
                    <td style={S.td} onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox"
                        checked={checked}
                        disabled={!selectable || submittingPR}
                        title={selectable ? 'Select this BP/RM row for the Purchase Request.' : 'No shortage — not selectable.'}
                        onChange={(ev) => togglePurchase(e.item_id, ev.target.checked)} />
                    </td>
                    <td style={S.td}><b>{e.item_code}</b>{e.stage_type ? <span style={{color:'#737685', fontSize:11, marginLeft:6}}>{e.stage_type}</span> : null}</td>
                    <td style={S.td}><span style={{color:'#6B7280'}}>{e.item_name}</span></td>
                    <td style={S.td}>{fmt(num(e.required_qty))} {e.required_uom}</td>
                    <td style={S.td}>{fmt(num(e.available_qty))} {e.required_uom}</td>
                    <td style={{...S.td, color:'#991B1B', fontWeight:800}}>{fmt(num(e.shortage_qty))} {e.required_uom}</td>
                    <td style={S.td}>{whyForSources(e.sources)}</td>
                  </tr>
                );
              })}
              {purchaseSuggestions.length === 0 && <tr><td style={S.td} colSpan={7}>All covered — nothing to purchase.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* MRP-UX-PHASE-A-MERGED: Manufacture Needed = STK make-targets only (decision columns + row->drawer).
          Technical View reuses the SAME table (DRY) with full chain + debug columns (Stage / Parent SKU). */}
      <div style={{...S.panel, marginTop:12, display: activeMrpTab === 'make' ? 'block' : 'none'}}>
        <div style={{display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', padding:'10px 14px 0'}}>
          <div style={{fontSize:15, fontWeight:900, color:'#041B3C'}}>Manufacture Needed — what to make (STK targets) ({visibleProductionNeeded.length})</div>
          <button type="button"
            disabled={!selectedMrpMakeRows.length || creatingBulkPlan || !!creatingPlanItemId}
            title={!selectedMrpMakeRows.length ? 'Select at least one STK row.' : 'Create one draft Internal Production Plan with selected STK lines.'}
            style={{...S.btn, ...((selectedMrpMakeRows.length && !creatingBulkPlan && !creatingPlanItemId) ? {cursor:'pointer'} : {opacity:.55, cursor:'not-allowed'})}}
            onClick={createPlansForSelectedMrpRows}>
            {creatingBulkPlan ? 'Creating…' : `Create Production Plan for Selected${selectedMrpMakeRows.length ? ` (${selectedMrpMakeRows.length})` : ''}`}
          </button>
        </div>
        {activeMrpTab === 'make' ? <div style={{fontSize:12, color:'#737685', padding:'8px 14px'}}>Top make-target (STK) per demand. Select one or more STK rows to create one draft plan; PF / SBBP / ACBP / MLD / GRD / CUR chain is generated later from recipe/routing.</div> : null}
        <div style={{overflowX:'auto'}}>
          <table style={{...S.table, minWidth:860}}>
            <thead><tr>{['','Item','Required','Available','Short','Why'].map((h, idx)=><th key={idx} style={S.th}>{idx === 0 ? <input type="checkbox" checked={allVisibleMrpMakeSelected} disabled={!selectableMrpMakeRows.length || creatingBulkPlan || !!creatingPlanItemId} onChange={(ev) => toggleAllMrpMakeRows(ev.target.checked)} /> : h}</th>)}</tr></thead>
            <tbody>
              {visibleProductionNeeded.map(g => {
                const selectable = isSelectableMrpMakeRow(g);
                const checked = selectedMrpMakeIds.has(String(g.item_id));
                return (
                  <tr key={g.item_id} style={{cursor:'pointer'}} onClick={() => openFromEntry(g)}>
                    <td style={S.td} onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox"
                        checked={checked && selectable}
                        disabled={!selectable || creatingBulkPlan || !!creatingPlanItemId}
                        title={selectable ? 'Select STK row for bulk production plan.' : createMrpPlanTitle(g)}
                        onChange={(ev) => toggleMrpMakeRow(g, ev.target.checked)} />
                    </td>
                    <td style={S.td}><b>{g.item_code}</b><br/><span style={{color:'#6B7280'}}>{g.item_name}</span></td>
                    <td style={S.td}>{fmt(num(g.required_qty))} {g.required_uom || 'PCS'}</td>
                    <td style={S.td}>{fmt(num(g.available_qty))} {g.required_uom || 'PCS'}</td>
                    <td style={{...S.td, color:'#92400E', fontWeight:800}}>{fmt(num(g.shortage_qty))} {g.required_uom || 'PCS'}</td>
                    <td style={S.td}>{whyForSources(g.sources)}{(g.sources || []).length ? <span style={{color:'#737685'}}> &middot; {(g.sources || []).join(', ')}</span> : null}</td>
                  </tr>
                );
              })}
              {visibleProductionNeeded.length === 0 && <tr><td style={S.td} colSpan={6}>All covered — no STK/output item needs manufacturing.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* MRP-UX-PHASE-2-MERGED: spec-4 — STK/manufactured reorder folded into Manufacture tab (compact). Full table in Technical View. */}
      <div style={{...S.panel, marginTop:12, display: activeMrpTab === 'make' ? 'block' : 'none'}}>
        <div style={S.head}>Reorder / Stock Level &middot; Why: Reorder level ({reorderShortage.length})</div>
        <div style={{fontSize:12, color:'#737685', padding:'0 14px 8px'}}>STK items below reorder level &mdash; separate from sales-order demand (not double-counted). Full detail in Technical View.</div>
        <div style={{overflowX:'auto'}}>
          <table style={{...S.table, minWidth:560}}>
            <thead><tr>{['Item','Short','Why','Action'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {reorderShortage.map(x => (
                <tr key={x.item_id} style={{cursor:'pointer'}} onClick={() => openDrawer(x.row)}>
                  <td style={S.td}><b>{x.item_code}</b> <span style={{color:'#6B7280', fontWeight:600}}>{x.item_name}</span></td>
                  <td style={{...S.td, color:'#991B1B', fontWeight:800}}>{fmt(x.short_qty)} PCS</td>
                  <td style={S.td}>Reorder level</td>
                  <td style={S.td}><button type="button" disabled title="Production Plan linking comes in the next phase." style={{...S.btn2, opacity:.6, cursor:'not-allowed'}} onClick={(ev) => ev.stopPropagation()}>Create Production Plan</button></td>
                </tr>
              ))}
              {reorderShortage.length === 0 && <tr><td style={S.td} colSpan={4}>None &mdash; all STK items at/above reorder level.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {activeMrpTab === 'requested' ? (
        <div style={{...S.panel, marginTop:12}}>
          <div style={S.head}>Already Requested — Manufacture / PPO ({manufactureAlreadyRequested.length})</div>
          <div style={{fontSize:12, color:'#737685', padding:'0 14px 8px'}}>Phase 3A nets open PPO/production-plan quantities from Manufacture Needed. Phase 3C-Buy.2 nets open Purchase Requirement (draft) quantities from Purchase Needed.</div>
          <div style={{overflowX:'auto'}}>
            <table style={{...S.table, minWidth:860}}>
              <thead><tr>{['Item','Type','Required','Already requested','Balance','Request / status','Why'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {manufactureAlreadyRequested.map(e => (
                  <tr key={e.item_id} style={{cursor:'pointer'}} onClick={() => openFromEntry(e)}>
                    <td style={S.td}><b>{e.item_code}</b><br/><span style={{color:'#6B7280'}}>{e.item_name}</span></td>
                    <td style={S.td}>{e.kind || 'MAKE'} / {e.request_type || 'PPO'}</td>
                    <td style={S.td}>{fmt(num(e.required_qty))} {e.required_uom || 'PCS'}</td>
                    <td style={{...S.td, color:'#166534', fontWeight:800}}>{fmt(num(e.open_requested_qty))} {e.required_uom || 'PCS'}</td>
                    <td style={{...S.td, color:num(e.balance_qty) > 0 ? '#92400E' : '#166534', fontWeight:800}}>{fmt(num(e.balance_qty))} {e.required_uom || 'PCS'}</td>
                    <td style={S.td}>{(e.refs || []).length ? (e.refs || []).slice(0,2).map(r => `${r.request_no || r.plan_order_id || 'PPO'}${r.status ? ' · ' + r.status : ''}`).join(', ') : 'Open PPO'}</td>
                    <td style={S.td}>{whyForSources(e.sources)}{(e.sources || []).length ? <span style={{color:'#737685'}}> · {(e.sources || []).join(', ')}</span> : null}</td>
                  </tr>
                ))}
                {manufactureAlreadyRequested.length === 0 && <tr><td style={S.td} colSpan={7}>Nothing already requested yet. Manufacture rows will appear here after open PPO/plan quantities exist.</td></tr>}
              </tbody>
            </table>
          </div>
          {/* MRP-PHASE-3C-BUY.2: BP/RM already requested via open Purchase Requirements (draft). */}
          <div style={{...S.head, marginTop:14}}>Already Requested — Purchase BP / RM ({purchaseAlreadyRequested.length})</div>
          <div style={{overflowX:'auto'}}>
            <table style={{...S.table, minWidth:860}}>
              <thead><tr>{['Item','Type','Required','Already requested','Balance','Request / status','Why'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {purchaseAlreadyRequested.map(e => (
                  <tr key={e.item_id} style={{cursor:'pointer'}} onClick={() => openFromEntry(e)}>
                    <td style={S.td}><b>{e.item_code}</b>{e.stage_type ? <span style={{color:'#737685', fontSize:11, marginLeft:6}}>{e.stage_type}</span> : null}<br/><span style={{color:'#6B7280'}}>{e.item_name}</span></td>
                    <td style={S.td}>{e.kind || 'BUY'} / {e.request_type || 'PR'}</td>
                    <td style={S.td}>{fmt(num(e.required_qty))} {e.required_uom}</td>
                    <td style={{...S.td, color:'#166534', fontWeight:800}}>{fmt(num(e.open_requested_qty))} {e.required_uom}</td>
                    <td style={{...S.td, color:num(e.balance_qty) > 0 ? '#92400E' : '#166534', fontWeight:800}}>{fmt(num(e.balance_qty))} {e.required_uom}</td>
                    <td style={S.td}>{(e.refs || []).length ? (e.refs || []).slice(0,2).map(r => `${r.request_no || r.pr_id || 'PR'}${r.status ? ' \u00b7 ' + r.status : ''}`).join(', ') : 'Open PR'}</td>
                    <td style={S.td}>{whyForSources(e.sources)}</td>
                  </tr>
                ))}
                {purchaseAlreadyRequested.length === 0 && <tr><td style={S.td} colSpan={7}>No open BP/RM Purchase Requests yet. Create one from Purchase Needed.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeMrpTab === 'technical' ? (
        <div style={{...S.panel, marginTop:12}}>
          <div style={S.head}>Technical / audit view — not for daily planning</div>
          <div style={{padding:'10px 14px', color:'#64748B', fontSize:13}}>Daily planning stays in Purchase Needed and Manufacture Needed. Expand these only when you need to audit the full engine output.</div>
          <details style={{borderTop:'1px solid #EEF1F7'}}>
            <summary style={{cursor:'pointer', padding:'12px 14px', fontWeight:900, color:'#334155'}}>Reorder / stock-level details ({reorderShortage.length})</summary>
            <div style={{overflowX:'auto'}}>
              <table style={{...S.table, minWidth:760}}>
                <thead><tr>{['Item','Item name','Current stock','Min / Reorder','Short qty',''].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {reorderShortage.map(x => (
                    <tr key={x.item_id}>
                      <td style={S.td}><b>{x.item_code}</b></td>
                      <td style={S.td}><span style={{color:'#6B7280'}}>{x.item_name}</span></td>
                      <td style={S.td}>{fmt(x.stock_qty)} PCS</td>
                      <td style={S.td}>{fmt(x.reorder_level)} PCS</td>
                      <td style={{...S.td, color:'#991B1B', fontWeight:800}}>{fmt(x.short_qty)} PCS</td>
                      <td style={S.td}><button type="button" onClick={() => openDrawer(x.row)} style={S.btn2}>View details</button></td>
                    </tr>
                  ))}
                  {reorderShortage.length === 0 && <tr><td style={S.td} colSpan={6}>None &mdash; all SKUs at/above reorder level.</td></tr>}
                </tbody>
              </table>
            </div>
          </details>
          <details style={{borderTop:'1px solid #EEF1F7'}}>
            <summary style={{cursor:'pointer', padding:'12px 14px', fontWeight:900, color:'#334155'}}>Full purchase technical list ({purchaseSuggestions.length})</summary>
            <div style={{overflowX:'auto'}}>
              <table style={{...S.table, minWidth:820}}>
                <thead><tr>{['Item','Item name','Required','Available','Short','Why needed'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {purchaseSuggestions.map(e => (
                    <tr key={e.item_id} style={{cursor:'pointer'}} onClick={() => openFromEntry(e)}>
                      <td style={S.td}><b>{e.item_code}</b>{e.stage_type ? <span style={{color:'#737685', fontSize:11, marginLeft:6}}>{e.stage_type}</span> : null}</td>
                      <td style={S.td}><span style={{color:'#6B7280'}}>{e.item_name}</span></td>
                      <td style={S.td}>{fmt(num(e.required_qty))} {e.required_uom}</td>
                      <td style={S.td}>{fmt(num(e.available_qty))} {e.required_uom}</td>
                      <td style={{...S.td, color:'#991B1B', fontWeight:800}}>{fmt(num(e.shortage_qty))} {e.required_uom}</td>
                      <td style={S.td}>{whyForSources(e.sources)}</td>
                    </tr>
                  ))}
                  {purchaseSuggestions.length === 0 && <tr><td style={S.td} colSpan={6}>None.</td></tr>}
                </tbody>
              </table>
            </div>
          </details>
          <details style={{borderTop:'1px solid #EEF1F7'}}>
            <summary style={{cursor:'pointer', padding:'12px 14px', fontWeight:900, color:'#334155'}}>Full exploded manufacturing chain ({internalProductionNeeded.length})</summary>
            <div style={{overflowX:'auto'}}>
              <table style={{...S.table, minWidth:820}}>
                <thead><tr>{['Item','Stage','Short','Parent SKU / demand'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {internalProductionNeeded.map(g => (
                    <tr key={g.item_id}>
                      <td style={S.td}><b>{g.item_code}</b><br/><span style={{color:'#6B7280'}}>{g.item_name}</span></td>
                      <td style={S.td}>{g.stage_type}</td>
                      <td style={{...S.td, color:'#92400E', fontWeight:800}}>{fmt(num(g.shortage_qty))} {g.required_uom || 'PCS'}</td>
                      <td style={S.td}>{(g.sources || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                  {internalProductionNeeded.length === 0 && <tr><td style={S.td} colSpan={4}>None.</td></tr>}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ) : null}

      <div id="sku-detail" />
      {/* MRP-UX-3 (E): technical guided card moved behind a default-closed disclosure. */}
      <details style={{marginTop:12, display: activeMrpTab === 'technical' ? 'block' : 'none'}}>
        <summary style={{cursor:'pointer', fontWeight:900, color:'#334155', padding:'10px 2px'}}>Planning Assistant / Debug — collapsed</summary>
      <GuidedFamily
        families={families}
        active={activeFamily}
        ms={activeFamilyMs || { key:'', fixes:[] }}
        blockers={activeBlockers}
        stages={activeStages}
        onSelectFamily={(k) => setActiveFamilyKey(k)}
        onPickQty={(qty) => { if (activeFamily) setPlanQty(activeFamily, qty); }}
        onCreatePlan={() => setPreviewKind('produce')}
        onCreatePurchase={() => setPreviewKind('purchase')}
        onCreatePlanAssist={() => scrollTo('more-grid')}
        onAddStagesAssist={() => scrollTo('stages-needed')}
        onReviewMaterials={() => scrollTo('purchase-suggestions')}
        openDrawer={openDrawer}
      />
      </details>
      {activeMrpTab === 'technical' && previewKind === 'purchase' ? ( /* MRP-UX-PHASE-2-MERGED */
        <div style={{position:'fixed', inset:0, background:'rgba(4,27,60,0.32)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:60}} onClick={() => setPreviewKind(null)}>
          <div style={{background:'#FFFFFF', borderRadius:14, padding:'18px 20px', width:'min(520px,94vw)'}} onClick={(e) => e.stopPropagation()}>
            <h3 style={{margin:'0 0 8px'}}>Confirm purchase request</h3>
            <div style={{fontSize:13, color:'#334155', marginBottom:10}}>This action will:</div>
            <ul style={{margin:'0 0 12px', paddingLeft:18, fontSize:14}}>
              {activeBlockerLines.map((l, i) => <li key={l.item_id || i}>request {fmt(l.shortage_qty)} {l.uom_code || ''} of {l.item_code}</li>)}
              <li>not create a Work Order yet</li>
              <li>not move inventory</li>
            </ul>
            <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
              <button style={btnGhost} onClick={() => setPreviewKind(null)}>Cancel</button>
              <button style={{...btnPrimary, opacity: submittingPR ? .6 : 1}} disabled={submittingPR || !activeBlockerLines.length} onClick={() => { submitPurchaseLines(activeBlockerLines); setPreviewKind(null); }}>{submittingPR ? 'Creating…' : 'Confirm — Create Purchase Request'}</button>
            </div>
          </div>
        </div>
      ) : null}
      <div style={S.sub}>Sales order demand + reorder level se production / purchase suggestions.</div>
      <div style={S.sub}>BP availability ke hisaab se PPO quantity auto-cap hogi. RM shortage warning/purchase action hai.</div>

      {activeMrpTab === 'technical' ? (
        <div style={S.kpis}>
          <div style={S.kpi}><div style={S.label}>Ready to produce</div><div style={{...S.big, color:'#166534'}}>{mrpCounts.ready}</div></div>
          <div style={S.kpi}><div style={S.label}>Mapping needed</div><div style={{...S.big, color:'#991B1B'}}>{mrpCounts.mapping}</div></div>
          <div style={S.kpi}><div style={S.label}>Purchase needed</div><div style={{...S.big, color:'#92400E'}}>{mrpCounts.purchase}</div></div>
          <div style={S.kpi}><div style={S.label}>Blocked</div><div style={{...S.big, color:'#92400E'}}>{mrpCounts.blocked}</div></div>
        </div>
      ) : null}

      {manualOpen && (
        <div
          onClick={() => setManualOpen(false)}
          style={{
            position:'fixed',
            inset:0,
            background:'rgba(15,23,42,0.45)',
            zIndex:1000,
            display:'flex',
            alignItems:'center',
            justifyContent:'center',
            padding:16,
          }}
        >
          <div
            onClick={(e)=>e.stopPropagation()}
            style={{
              width:'min(460px, 100%)',
              background:'#FFFFFF',
              border:'1px solid #DCDFE4',
              borderRadius:16,
              boxShadow:'0 18px 50px rgba(15,23,42,0.22)',
              padding:18,
            }}
          >
            <div style={{fontSize:18, fontWeight:900, color:'#041B3C', marginBottom:4}}>Add Manual Production</div>
            <div style={{fontSize:12, color:'#737685', marginBottom:14}}>
              For new SKU, trial, launch stock, exhibition, forecast, or management planned production.
            </div>

            <label style={{display:'block', fontSize:12, fontWeight:900, color:'#434654', marginBottom:4}}>Item Code / SKU *</label>
            <div style={{display:'flex', gap:8, marginBottom:8}}>
              <input
                style={{...S.input, width:'100%'}}
                value={manualForm.item_code}
                onChange={(e)=>{
                  setManualForm(prev=>({ ...prev, item_id:null, item_name:'', item_code:e.target.value }));
                  setManualSearchResults([]);
                  setManualSearchMessage('');
                }}
                onKeyDown={(e)=>{
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    searchManualItems();
                  }
                }}
                placeholder="Search item code/name"
              />
              <button type="button" style={S.btn2} onClick={searchManualItems} disabled={manualSearching}>
                {manualSearching ? 'Searching...' : 'Search'}
              </button>
            </div>

            {manualSearchMessage && (
              <div style={{fontSize:12, color:'#737685', marginBottom:8}}>{manualSearchMessage}</div>
            )}

            {manualSearchResults.length > 0 && (
              <div style={{border:'1px solid #DCDFE4', borderRadius:10, overflow:'hidden', marginBottom:10, background:'#FFFFFF'}}>
                {manualSearchResults.map((item)=>(
                  <button
                    key={item.id || item.item_code}
                    type="button"
                    onClick={()=>selectManualItem(item)}
                    style={{
                      width:'100%',
                      textAlign:'left',
                      border:0,
                      borderBottom:'1px solid #EEF1F7',
                      background:'#FFFFFF',
                      padding:'9px 10px',
                      cursor:'pointer',
                    }}
                  >
                    <div style={{fontWeight:900, color:'#041B3C'}}>{item.item_code}</div>
                    <div style={{fontSize:12, color:'#737685'}}>{item.item_name || 'Unnamed item'}</div>
                  </button>
                ))}
              </div>
            )}

            {manualForm.item_name && (
              <div style={{fontSize:12, color:'#166534', background:'#DCFCE7', borderRadius:8, padding:'7px 9px', marginBottom:10}}>
                Selected SKU: <b>{manualForm.item_code}</b> — {manualForm.item_name}
              </div>
            )}

            <label style={{display:'block', fontSize:12, fontWeight:900, color:'#434654', marginBottom:4}}>Qty *</label>
            <input
              type="number"
              min="0"
              style={{...S.input, width:'100%', marginBottom:10}}
              value={manualForm.qty}
              onChange={(e)=>setManualForm(prev=>({ ...prev, qty:e.target.value }))}
              placeholder="Example: 50"
            />

            <label style={{display:'block', fontSize:12, fontWeight:900, color:'#434654', marginBottom:4}}>UOM</label>
            <select
              style={{...S.input, width:'100%', marginBottom:10}}
              value={manualForm.uom_code}
              onChange={(e)=>setManualForm(prev=>({ ...prev, uom_code:e.target.value }))}
            >
              <option value="PCS">PCS</option>
              <option value="SET">SET</option>
            </select>

            <label style={{display:'block', fontSize:12, fontWeight:900, color:'#434654', marginBottom:4}}>Reason</label>
            <input
              style={{...S.input, width:'100%', marginBottom:10}}
              value={manualForm.reason}
              onChange={(e)=>setManualForm(prev=>({ ...prev, reason:e.target.value }))}
              placeholder="Manual Production"
            />

            <label style={{display:'block', fontSize:12, fontWeight:900, color:'#434654', marginBottom:4}}>Notes</label>
            <textarea
              style={{width:'100%', minHeight:76, border:'1px solid #C3C6D6', borderRadius:8, padding:8, fontSize:13, color:'#041B3C', marginBottom:14}}
              value={manualForm.notes}
              onChange={(e)=>setManualForm(prev=>({ ...prev, notes:e.target.value }))}
              placeholder="Optional notes"
            />

            <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
              <button type="button" style={S.btn2} onClick={()=>setManualOpen(false)}>Cancel</button>
              <button type="button" style={S.btn} onClick={submitManualProduction} disabled={manualSubmitting}>{manualSubmitting ? 'Checking material…' : 'Add and Open Press Planner'}</button>
            </div>
          </div>
        </div>
      )}

      {activeMrpTab === 'technical' && previewKind === 'produce' ? ( /* MRP-UX-PHASE-2-MERGED */
        <div style={{position:'fixed', inset:0, background:'rgba(4,27,60,0.32)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:60}} onClick={() => setPreviewKind(null)}>
          <div style={{background:'#FFFFFF', borderRadius:14, padding:'18px 20px', width:'min(520px,94vw)'}} onClick={(e) => e.stopPropagation()}>
            <h3 style={{margin:'0 0 8px'}}>Confirm production plan</h3>
            <div style={{fontSize:14, color:'#334155', marginBottom:12}}>This will create a plan for <b>{fmt(num(activeFamily && activeFamily.approved_qty))} PCS</b>{activeFamily ? ' of ' + activeFamily.item_code : ''} (up to STK only, not final SET). It will not move inventory until you run production.</div>
            <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
              <button style={btnGhost} onClick={() => setPreviewKind(null)}>Cancel</button>
              <button style={{...btnPrimary, opacity: (activeFamily && num(activeFamily.approved_qty) > 0) ? 1 : .6}} disabled={!(activeFamily && num(activeFamily.approved_qty) > 0)} onClick={() => { setPreviewKind(null); scrollTo('more-grid'); }}>Continue to create</button>
            </div>
          </div>
        </div>
      ) : null}
      <details open={activeMrpTab === 'technical' && moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)} style={{marginTop:8, display: activeMrpTab === 'technical' ? 'block' : 'none'}}>
        <summary style={{cursor:'pointer', fontWeight:800, color:'#334155', padding:'6px 2px'}}>More planning details / old debug panels</summary>
      <div id="more-grid" style={S.grid}>
        {(() => {
          const HEAD = ['Item','Need','Available','Can Make','Status','Next Action'];
          const Zone = ({ title, items, accent, footer, showPlan }) => items.length === 0 ? null : (
            <div style={S.panel}>
              <div style={S.head}>{title} ({items.length})</div>
              <div style={S.tableWrap}>
                <table style={{...S.table, minWidth:760}}>
                  <thead><tr>{HEAD.map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {items.length === 0
                      ? <tr><td style={S.td} colSpan={6}><div style={{padding:'18px 12px', textAlign:'center', color:'#737685', fontWeight:700}}>None</div></td></tr>
                      : items.map(x => <MrpRow key={keyOf(x.r)} r={x.r} ms={x.ms} onOpen={openDrawer} onSelect={selectRow} showPlan={showPlan} />)}
                  </tbody>
                </table>
              </div>
              {footer || null}
            </div>
          );
          const readyFooter = (
            <div style={{padding:14, display:'flex', justifyContent:'flex-end', gap:8, alignItems:'flex-start'}}>
              <button type="button" style={S.btn2} onClick={() => setManualOpen(true)}>+ Add Manual Production</button>
              {(() => {
                const anyReady = bpRows.some(r => mrpRowStatus(r).selectable);
                const reason = !anyReady ? 'No ready quantity available' : (!feasibleProduction.length ? 'Select at least one Ready item' : '');
                return (
                  <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4}}>
                    <button style={S.btn} onClick={sendToPlanning} disabled={!feasibleProduction.length} title={reason || 'Create a production plan from the selected ready items.'}>Create Plan</button>
                    {reason ? <span style={{fontSize:11, color:'#64748B'}}>{reason}</span> : null}
                  </div>
                );
              })()}
            </div>
          );
          return (
            <>
              <Zone title="Ready to Make" items={zoneReady} footer={readyFooter} showPlan />
              <Zone title="Needs Fix" items={zoneFix} />
            </>
          );
        })()}
        <div style={S.panel}>
          <div id="purchase-suggestions" style={S.head}>Purchase Suggestions</div>
          <table style={{...S.table, minWidth:420}}>
            <thead>
              <tr>
                {['Buy','Item','Reason','Suggested'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {purchaseSuggestions.map(e=>(
                <tr key={e.item_id}>
                  <td style={S.td}>
                    <input type="checkbox" checked={isPurchaseSelected(e.item_id)} onChange={ev=>togglePurchase(e.item_id, ev.target.checked)}/>
                  </td>
                  <td style={S.td}><b>{e.item_code}</b><br/><span style={{color:'#6B7280'}}>{e.item_name}</span></td>
                  <td style={S.td}>{(e.sources || []).join(', ')}</td>
                  <td style={S.td}>{fmt(e.shortage_qty)} {e.required_uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{padding:14, display:'flex', justifyContent:'flex-end'}}>
            <button style={S.btn2} onClick={createPurchaseRequest} disabled={!selectedPurchaseSuggestions.length}>
              Create Purchase Request
            </button>
          </div>
        </div>

        {/* P-2F: read-only Mapping Required panel */}
        <div style={S.panel}>
          <div id="stages-needed" style={S.head}>Stages needed to make {activeFamilyItemCode || 'STK'} ({internalProductionNeeded.length}) &middot; order not shown</div>
          {/* P-3A: stage to internal_production_draft (review only; no WO/PPO, no Press Planner) */}
          <div style={{padding:'8px 14px', display:'flex', justifyContent:'flex-end'}}>
            <button style={S.btn2} onClick={addToInternalProductionDraft} disabled={!internalProductionNeeded.length} title="Stages these internal WIP items into a review-only draft. Does NOT create any WO/PPO and does NOT touch Press Planner.">
              Add to Internal Production Draft (review only)
            </button>
          </div>
          <table style={{...S.table, minWidth:420}}>
            <thead>
              <tr>
                {['Item','Stage','Short'].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {internalProductionNeeded.map(g=>(
                <tr key={g.item_id}>
                  <td style={S.td}><b>{g.item_code}</b><br/><span style={{color:'#6B7280'}}>{g.item_name}</span></td>
                  <td style={S.td}>{g.stage_type}</td>
                  <td style={S.td}>{fmt(g.shortage_qty)} {g.required_uom}</td>
                </tr>
              ))}
              {internalProductionNeeded.length === 0 && (
                <tr><td style={S.td} colSpan={3}>None &mdash; no internal WIP shortage.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* P-3B: Internal Production Draft review (localStorage-only; no WO/PPO, no Press Planner) */}
        <div style={S.panel}>
          <div style={S.head}>Internal Production Draft — review only{internalDraft && Array.isArray(internalDraft.items) ? ` (${internalDraft.items.length})` : ''}{internalDraft && internalDraft.updated_at ? ` · updated ${new Date(internalDraft.updated_at).toLocaleString('en-IN')}` : ''}</div>
          <div style={{padding:'8px 14px', display:'flex', justifyContent:'flex-end', gap:8}}>
            <button style={S.btn2} onClick={()=>setAllInternalDraftSelected(true)} disabled={!(internalDraft && Array.isArray(internalDraft.items) && internalDraft.items.length)} title="Mark all draft items selected (review only; no send yet).">
              Select all
            </button>
            <button style={S.btn2} onClick={()=>setAllInternalDraftSelected(false)} disabled={!(internalDraft && Array.isArray(internalDraft.items) && internalDraft.items.length)} title="Unmark all draft items (review only; no send yet).">
              Select none
            </button>
            <button style={S.btn2} onClick={clearInternalDraft} disabled={!(internalDraft && Array.isArray(internalDraft.items) && internalDraft.items.length)} title="Clears the local review draft only. No WO/PPO, no Press Planner, no backend.">
              Clear Draft
            </button>
          </div>
          <table style={{...S.table, minWidth:420}}>
            <thead>
              <tr>
                {['Sel','Item','Stage','Qty','Sources','Updated',''].map((h,i)=><th key={i} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(internalDraft && Array.isArray(internalDraft.items) ? internalDraft.items : []).map(d=>(
                <tr key={d.item_id}>
                  <td style={S.td}>
                    <input type="checkbox" checked={d.selected !== false} onChange={e=>toggleInternalDraftSelect(d.item_id, e.target.checked)} title="Select this item for internal production (review only; no send yet)."/>
                  </td>
                  <td style={S.td}><b>{d.item_code}</b><br/><span style={{color:'#6B7280'}}>{d.item_name}</span></td>
                  <td style={S.td}>{d.stage_type}</td>
                  <td style={S.td}>{fmt(d.qty)} {d.uom}</td>
                  <td style={S.td}>{(d.sources || []).join(', ')}</td>
                  <td style={S.td}>{d.updated_at ? new Date(d.updated_at).toLocaleString('en-IN') : ''}</td>
                  <td style={S.td}>
                    <button style={S.btn2} onClick={()=>removeInternalDraftItem(d.item_id)} title="Remove this item from the local review draft only.">Remove</button>
                  </td>
                </tr>
              ))}
              {!(internalDraft && Array.isArray(internalDraft.items) && internalDraft.items.length) && (
                <tr><td style={S.td} colSpan={7}>No internal production draft yet. Add items using the button above.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* P-3D: Selected Internal Items Summary / Export (read-only; localStorage only) */}
        {(() => {
          const sum = computeInternalSelectedSummary();
          return (
            <div style={S.panel}>
              <div style={S.head}>Selected Internal Items ({sum.count})</div>
              <div style={{padding:'8px 14px', display:'flex', justifyContent:'flex-end', gap:8}}>
                <button style={S.btn} onClick={createInternalPlan} disabled={!sum.count || creatingPlan} title="Create a backend Internal Production Plan from the selected internal items.">{creatingPlan ? 'Creating…' : 'Create Internal Production Plan'}</button>
                <button style={S.btn2} onClick={copyInternalSummary} disabled={!sum.count} title="Copy a text summary of the selected internal items (review only).">Copy Summary</button>
                <button style={S.btn2} onClick={copyInternalSummaryJSON} disabled={!sum.count} title="Copy the selected internal items as JSON (review only).">Copy JSON</button>
              </div>
              <table style={{...S.table, minWidth:420}}>
                <thead>
                  <tr>{['Stage','UOM','Total Qty'].map((h,i)=><th key={i} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sum.totals.map((t,i)=>(
                    <tr key={i}>
                      <td style={S.td}>{t.stage_type}</td>
                      <td style={S.td}>{t.uom || '—'}</td>
                      <td style={S.td}>{fmt(t.qty)}</td>
                    </tr>
                  ))}
                  {!sum.totals.length && (
                    <tr><td style={S.td} colSpan={3}>No selected internal items.</td></tr>
                  )}
                </tbody>
              </table>
              <table style={{...S.table, minWidth:420}}>
                <thead>
                  <tr>{['Item','Stage','Qty'].map((h,i)=><th key={i} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sum.items.map(it=>(
                    <tr key={it.item_id}>
                      <td style={S.td}><b>{it.item_code}</b><br/><span style={{color:'#6B7280'}}>{it.item_name}</span></td>
                      <td style={S.td}>{it.stage_type}</td>
                      <td style={S.td}>{fmt(it.qty)} {it.uom}</td>
                    </tr>
                  ))}
                  {!sum.items.length && (
                    <tr><td style={S.td} colSpan={3}>No selected internal items.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
      </details>
      {drawerRow ? <MrpDrawer r={drawerRow} ms={mrpRowStatus(drawerRow)} onClose={() => setDrawerRowId(null)} onPickQty={(qty) => setPlanQty(drawerRow, qty)} /> : null}
    </div>
  );
}
