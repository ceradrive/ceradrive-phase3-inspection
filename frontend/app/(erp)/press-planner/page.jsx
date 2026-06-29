'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api.js';

const S = {
  page: { minHeight:'100vh', background:'#F3F4F6', color:'#111827' },
  topbar: { height:52, background:'#fff', borderBottom:'1px solid #DDE2EA', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 18px', position:'sticky', top:0, zIndex:20 },
  brand: { fontSize:16, fontWeight:900, color:'#004AC6' },
  nav: { display:'flex', gap:20, alignItems:'center', fontSize:12, color:'#505F76' },
  navActive: { color:'#004AC6', fontWeight:900, borderBottom:'2px solid #004AC6', paddingBottom:14 },
  executeLocked: { opacity:.55, background:'#737686', color:'#fff', border:0, borderRadius:4, padding:'7px 12px', fontSize:11, fontWeight:900, textTransform:'uppercase' },
  checkBtn: { background:'#004AC6', color:'#fff', border:0, borderRadius:4, padding:'7px 12px', fontSize:11, fontWeight:900, textTransform:'uppercase', cursor:'pointer', marginRight:8 },
  lockSub: { fontSize:9, color:'#BA1A1A', textAlign:'right', marginTop:2 },

  main: { padding:14, display:'flex', flexDirection:'column', gap:14 },
  statusGrid: { display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12 },
  statusCard: { background:'#fff', border:'1px solid #DDE2EA', borderRadius:6, minHeight:76, padding:12, display:'flex', flexDirection:'column', justifyContent:'space-between' },
  statusLabel: { fontSize:10, fontWeight:900, color:'#505F76', textTransform:'uppercase', letterSpacing:.4 },
  pillBlue: { display:'inline-block', background:'#D3E4FE', color:'#003EA8', borderRadius:3, padding:'3px 7px', fontSize:10, fontWeight:900 },
  pillOrange: { display:'inline-block', background:'#FFDBCD', color:'#7D2D00', borderRadius:3, padding:'3px 7px', fontSize:10, fontWeight:900 },
  pillRed: { display:'inline-block', background:'#FFDAD6', color:'#93000A', borderRadius:3, padding:'3px 7px', fontSize:10, fontWeight:900 },
  volume: { color:'#004AC6', fontSize:22, fontWeight:900 },

  grid: { display:'grid', gridTemplateColumns:'9fr 3fr', gap:12, alignItems:'start' },
  leftCol: { display:'flex', flexDirection:'column', gap:12 },
  rightCol: { display:'flex', flexDirection:'column', gap:12 },

  panel: { background:'#fff', border:'1px solid #DDE2EA', borderRadius:6, overflow:'hidden' },
  panelHead: { background:'#EDEDFA', borderBottom:'1px solid #DDE2EA', padding:'9px 12px', display:'flex', alignItems:'center', justifyContent:'space-between' },
  panelTitle: { fontSize:14, fontWeight:900, color:'#111827' },
  search: { height:28, width:190, border:'1px solid #C8CEDA', borderRadius:4, padding:'0 8px', fontSize:11, background:'#fff' },
  qtyInput: { width:78, height:28, border:'1px solid #C8CEDA', borderRadius:4, padding:'0 6px', fontSize:12, fontFamily:'monospace', textAlign:'right', background:'#fff' },

  table: { width:'100%', borderCollapse:'collapse', fontSize:12 },
  th: { background:'#F7F8FC', borderBottom:'1px solid #DDE2EA', padding:'7px 9px', fontSize:10, fontWeight:900, color:'#505F76', textTransform:'uppercase', textAlign:'left' },
  td: { borderBottom:'1px solid #E9EDF4', padding:'8px 9px', verticalAlign:'middle' },
  tdRight: { borderBottom:'1px solid #E9EDF4', padding:'8px 9px', verticalAlign:'middle', textAlign:'right' },
  tdCenter: { borderBottom:'1px solid #E9EDF4', padding:'8px 9px', verticalAlign:'middle', textAlign:'center' },
  code: { fontWeight:900, color:'#111827', fontSize:12 },
  muted: { color:'#6B7280', fontSize:10, lineHeight:1.35 },
  mono: { fontFamily:'monospace', fontSize:12 },

  currentRow: { background:'#F0FDF4' },
  queueRow: { background:'#FFF7ED' },
  runRow: { background:'#F0FDF4' },
  changeRow: { background:'#FEFCE8' },
  alertRow: { background:'#FEF2F2' },

  slotControls: { display:'flex', flexDirection:'column', gap:4, alignItems:'center' },
  slotLine: { display:'flex', alignItems:'center', gap:4 },
  slotLabel: { width:44, fontSize:8, fontWeight:900, color:'#737686', textTransform:'uppercase', textAlign:'right' },
  btn: { border:'1px solid #C8CEDA', background:'#fff', borderRadius:4, minWidth:28, height:23, fontSize:10, fontWeight:900, cursor:'pointer' },
  btnActive: { border:'1px solid #004AC6', background:'#004AC6', color:'#fff', borderRadius:4, minWidth:28, height:23, fontSize:10, fontWeight:900, cursor:'pointer' },
  btnNext: { border:'1px solid #BC4800', background:'#BC4800', color:'#fff', borderRadius:4, minWidth:28, height:23, fontSize:10, fontWeight:900, cursor:'pointer' },
  statusSmall: { fontSize:10, fontWeight:900 },
  greenDot: { display:'inline-block', width:7, height:7, borderRadius:999, background:'#16A34A', marginRight:5 },
  orangeDot: { display:'inline-block', width:7, height:7, borderRadius:999, background:'#BC4800', marginRight:5 },

  pressHead: { background:'#2563EB', color:'#fff', padding:'9px 12px', display:'flex', justifyContent:'space-between', alignItems:'center' },
  pressTabs: { display:'flex', gap:4 },
  pressTab: { border:0, background:'rgba(255,255,255,.25)', color:'#fff', padding:'4px 9px', borderRadius:3, fontSize:10, fontWeight:900, cursor:'pointer' },
  pressTabActive: { border:0, background:'#fff', color:'#004AC6', padding:'4px 9px', borderRadius:3, fontSize:10, fontWeight:900, cursor:'pointer' },
  pressBody: { padding:10, display:'flex', flexDirection:'column', gap:10 },
  slotCard: { border:'1px solid #BBF7D0', background:'#F0FDF4', borderRadius:5, padding:10 },
  slotCardEmpty: { border:'1px solid #DDE2EA', background:'#fff', borderRadius:5, padding:10, minHeight:118, display:'flex', flexDirection:'column' },
  slotBadge: { display:'inline-block', background:'#16A34A', color:'#fff', padding:'3px 7px', borderRadius:3, fontSize:10, fontWeight:900, marginBottom:8 },
  slotBadgeGrey: { display:'inline-block', background:'#737686', color:'#fff', padding:'3px 7px', borderRadius:3, fontSize:10, fontWeight:900, marginBottom:8 },
  slotMiniGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:11 },
  clearBtn: { marginTop:8, border:'1px solid #C8CEDA', background:'#fff', borderRadius:4, padding:'5px 9px', fontSize:11, fontWeight:900, cursor:'pointer' },

  timelineMeta: { display:'flex', gap:22, fontSize:12, marginBottom:8, color:'#505F76' },
  actionRun: { background:'#DCFCE7', color:'#166534', borderRadius:3, padding:'3px 8px', fontSize:10, fontWeight:900, textAlign:'center' },
  actionChange: { background:'#FEF3C7', color:'#92400E', borderRadius:3, padding:'3px 8px', fontSize:10, fontWeight:900, textAlign:'center' },
  actionAlert: { background:'#FEE2E2', color:'#991B1B', borderRadius:3, padding:'3px 8px', fontSize:10, fontWeight:900, textAlign:'center' },

  queueHead: { background:'#EDEDFA', borderBottom:'1px solid #DDE2EA', padding:'9px 12px', fontSize:14, fontWeight:900 },
  queueBody: { padding:12 },
  queueTitleA: { fontSize:10, fontWeight:900, color:'#166534', textTransform:'uppercase', marginBottom:8 },
  queueTitleB: { fontSize:10, fontWeight:900, color:'#505F76', textTransform:'uppercase', marginBottom:8 },
  queueList: { borderLeft:'1px solid #C8CEDA', paddingLeft:12, display:'flex', flexDirection:'column', gap:8 },
  queueItem: { position:'relative', background:'#F7F8FC', border:'1px solid #DDE2EA', borderRadius:5, padding:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 },
  removeBtn: { border:0, background:'transparent', color:'#BA1A1A', fontWeight:900, cursor:'pointer' },
  emptyQueue: { border:'1px dashed #C8CEDA', borderRadius:5, padding:14, textAlign:'center', color:'#6B7280', fontSize:11 },
  fulfillTrack: { height:6, width:'100%', background:'#E5E7EB', borderRadius:999, overflow:'hidden' },
  summaryBox: { background:'#fff', border:'1px solid #DDE2EA', borderRadius:6, padding:12, marginBottom:10 },
  actionSecondary: { width:'100%', border:'1px solid #C8CEDA', background:'#fff', borderRadius:5, padding:'9px 12px', fontSize:11, fontWeight:900, cursor:'pointer', marginTop:8 },
  actionDisabled: { width:'100%', border:'1px solid #DDE2EA', background:'#F3F4F6', color:'#737686', borderRadius:5, padding:'9px 12px', fontSize:11, fontWeight:900, cursor:'not-allowed', marginTop:8 },
};

const PHASES = ['Press Plan','Material'];
const PRESSES = [{ id:'PRESS_1', name:'P01' }, { id:'PRESS_2', name:'P02' }];

function normalizeDraft(raw){
  if (!raw) return { plan_status:'NO_PLAN', material_status:'-', execution_status:'-', items:[] };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { plan_status:'TENTATIVE', material_status:'NOT_CHECKED', execution_status:'BLOCKED', items: parsed };
    return { ...parsed, items: parsed.items || [] };
  } catch {
    return { plan_status:'NO_PLAN', material_status:'-', execution_status:'-', items:[] };
  }
}

function num(v){ return Number(v || 0); }
function setQty(item){ return num(item.approved_qty || item.suggested_qty); }

function pcsQty(item){
  if (item.production_pcs != null) return Number(item.production_pcs);
  const uom = String(item.uom_code || '').toUpperCase();
  const pcsPerSet = Number(item.pcs_per_set || 4);
  return uom === 'SET' ? setQty(item) * pcsPerSet : setQty(item);
}

function fmt(v){
  if (v === null || v === undefined || v === '') return '-';
  return `${v}`;
}

function sameItem(a, b){
  return Boolean(a && b && a.item_code === b.item_code);
}

function plannerItemKey(item) {
  return String(item?.item_code || item?.item_id || item?.id || '');
}

function removeItemFromQueue(queue, item){
  return {
    A:(queue.A || []).filter(x => !sameItem(x,item)),
    B:(queue.B || []).filter(x => !sameItem(x,item)),
  };
}

function dayRowStyle(action){
  const a = String(action || '').toUpperCase();
  if (a === 'RUN') return S.runRow;
  if (a === 'DIE CHANGE' || a === 'SETUP') return S.changeRow;
  if (a === 'HEAT') return S.changeRow;
  if (a === 'WAIT' || a === 'ERROR') return S.alertRow;
  return undefined;
}

function actionBadge(action){
  const a = String(action || '').toUpperCase();
  if (a === 'RUN') return S.actionRun;
  if (a === 'DIE CHANGE' || a === 'SETUP' || a === 'HEAT') return S.actionChange;
  return S.actionAlert;
}

function buildSlotSchedule(slotName, mainItem, queueItems, mountedDieCode){
  // B1CORE: event-level schedule. Setup/heat applied per die-change / cold-start, NOT per row.
  // Dynamic times from item.setup_time_min / item.heating_time_min. No hardcoded 20/90.
  const jobs = [];
  if (mainItem) jobs.push(mainItem);
  for (const q of (queueItems || [])) jobs.push(q);

  const rows = [];
  let day = 1;
  let hoursLeft = 24;
  let currentDie = mountedDieCode || null; // mounted die at plan start (null = unknown)
  let hotToday = false;                    // press cold at start of each planning day
  let idx = 0;
  const bal = jobs.map((j) => pcsQty(j));

  const startNewDay = () => { day += 1; hoursLeft = 24; hotToday = false; };

  while (idx < jobs.length && day <= 60) {
    const item = jobs[idx];
    const jobDie = item.die_code || null;
    const cavity = Number(item.cavity || 0);
    const cycleSec = Number(item.cycle_time_sec) > 0 ? Number(item.cycle_time_sec) : null;
    const setupMin = item.setup_time_min != null ? Number(item.setup_time_min) : null;
    const heatMin = item.heating_time_min != null ? Number(item.heating_time_min) : null;

    if (!cavity) { rows.push({ day, slot:slotName, action:'ERROR', item:item.item_code, output:0, balance:bal[idx], note:'Missing cavity' }); break; }
    if (!cycleSec) { rows.push({ day, slot:slotName, action:'ERROR', item:item.item_code, output:0, balance:bal[idx], note:'Missing slot cycle time' }); break; }

    const needSetup = (currentDie === null) || (jobDie !== currentDie);
    const needHeat = (!hotToday) || needSetup;
    const setupHours = (needSetup && setupMin != null) ? setupMin / 60 : 0;
    const heatHours = (needHeat && heatMin != null) ? heatMin / 60 : 0;
    const eventHours = setupHours + heatHours;

    if (eventHours > 0 && eventHours > hoursLeft) {
      rows.push({ day, slot:slotName, action:'WAIT', item:item.item_code, output:0, balance:bal[idx], note:'Waiting for setup/heat window next day' });
      startNewDay();
      continue;
    }

    if (needSetup) {
      rows.push({ day, slot:slotName, action:'DIE CHANGE', item:item.item_code, die:jobDie, setupMin:(setupMin != null ? setupMin : null), heatMin:null, runHours:0, output:0, balance:bal[idx], note: setupMin != null ? `Setup ${setupMin}m` : 'Setup (no master time)' }); /* B2DISP */
      hoursLeft = Number((hoursLeft - setupHours).toFixed(2));
      currentDie = jobDie;
    }
    if (needHeat) {
      rows.push({ day, slot:slotName, action:'HEAT', item:item.item_code, die:jobDie, setupMin:null, heatMin:(heatMin != null ? heatMin : null), runHours:0, output:0, balance:bal[idx], note: heatMin != null ? `Heat ${heatMin}m` : 'Heat (no master time)' });
      hoursLeft = Number((hoursLeft - heatHours).toFixed(2));
    }
    hotToday = true;

    const cyclesAvailable = Math.floor((hoursLeft * 3600) / cycleSec);
    if (cyclesAvailable <= 0) { startNewDay(); continue; }

    const possible = cyclesAvailable * cavity;
    const output = Math.min(bal[idx], possible);
    const cyclesUsed = Math.ceil(output / cavity);
    const runHours = (cyclesUsed * cycleSec) / 3600;
    bal[idx] = Math.max(0, bal[idx] - output);
    hoursLeft = Number(Math.max(0, hoursLeft - runHours).toFixed(2));

    rows.push({ day, slot:slotName, action:'RUN', item:item.item_code, die:jobDie, setupMin:null, heatMin:null, runHours:Number(runHours.toFixed(2)), output, balance:bal[idx], note: bal[idx] > 0 ? 'Carry forward' : 'Complete' });

    if (bal[idx] <= 0) { idx += 1; }
    if (hoursLeft <= 0) { startNewDay(); }
  }

  return rows;
}

function buildDayPlan(slotA, slotB, queueA, queueB, mountedDieA, mountedDieB){
  const mainCyc = Number(slotA?.cycle_time_sec) > 0 ? Number(slotA.cycle_time_sec) : null;
  const cyclesPerDay = mainCyc ? Math.floor((24 * 60 * 60) / mainCyc) : null;
  const rows = [
    ...buildSlotSchedule('A', slotA, queueA || [], mountedDieA),
    ...buildSlotSchedule('B', slotB, queueB || [], mountedDieB),
  ];

  rows.sort((a,b) => (a.day - b.day) || String(a.slot).localeCompare(String(b.slot)));

  return {
    cyclesPerDay,
    totalDays: rows.reduce((m,r)=>Math.max(m,r.day),0),
    rows
  };
}

function SlotCard({ title, item, onClear }){
  return (
    <div style={item ? S.slotCard : S.slotCardEmpty}>
      <div>
        <span style={item ? S.slotBadge : S.slotBadgeGrey}>{title}</span>
      </div>

      {!item ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#6B7280', fontStyle:'italic', fontSize:12 }}>
          No Part Assigned
        </div>
      ) : (
        <>
          <div style={{ fontWeight:900, marginBottom:8 }}>{item.item_code}</div>
          <div style={S.slotMiniGrid}>
            <div>
              <div style={S.muted}>CYCLES</div>
              <b>{fmt(item.cycles_required)}</b>
            </div>
            <div>
              <div style={S.muted}>RUNTIME</div>
              <b>{item.runtime_hours ? `${item.runtime_hours} hr` : (item.missing_standard ? 'Setup needed' : '-')}</b>
              {/* PHASEC: informational setup/heat ingredients (no runtime impact) */}
              {(item.setup_time_min != null || item.heating_time_min != null) && (
                <div style={{ fontSize:10, color:'#6B7280', marginTop:2, fontWeight:600 }}>
                  {item.setup_time_min != null ? `Setup ${item.setup_time_min}m` : ''}
                  {item.setup_time_min != null && item.heating_time_min != null ? ' · ' : ''}
                  {item.heating_time_min != null ? `Heat ${item.heating_time_min}m` : ''}
                  {item.setup_time_source && item.setup_time_source !== 'NONE' ? ` (${String(item.setup_time_source).toLowerCase()})` : ''}
                </div>
              )}
            </div>
            <div>
              <div style={S.muted}>DAYS</div>
              <b>{fmt(item.press_days)}</b>
            </div>
          </div>
          <button style={S.clearBtn} onClick={onClear}>Clear</button>
        </>
      )}
    </div>
  );
}

export default function PressPlannerPage(){
  const router = useRouter();
  const [draft,setDraft] = useState({ plan_status:'NO_PLAN', material_status:'-', execution_status:'-', items:[] });
  const [resolved,setResolved] = useState([]);
  const [selectedPress,setSelectedPress] = useState('PRESS_1');
  const [slots,setSlots] = useState({
    PRESS_1:{ A:null, B:null },
    PRESS_2:{ A:null, B:null },
  });
  const [queues,setQueues] = useState({
    PRESS_1:{ A:[], B:[] },
    PRESS_2:{ A:[], B:[] },
  });
  const [loading,setLoading] = useState(false);
  const [activePhase,setActivePhase] = useState('Press Plan');
  const [checkingMaterial,setCheckingMaterial] = useState(false);
  const [materialCheck,setMaterialCheck] = useState(null);
  const [creatingPpo,setCreatingPpo] = useState(false);
  const [creatingDirectPpo,setCreatingDirectPpo] = useState(false);
  const [createdPpo,setCreatedPpo] = useState(null);
  const [creatingPr,setCreatingPr] = useState(false);
  const [createdPr,setCreatedPr] = useState(null);
  const [mountedDies,setMountedDies] = useState(null); // B1WIRE
  const [mountedDiesLoading,setMountedDiesLoading] = useState(false); // B1WIRE
  const [mountedDiesError,setMountedDiesError] = useState(null); // B1WIRE

  useEffect(()=>{
    setDraft(normalizeDraft(localStorage.getItem('production_plan_draft')));
  },[]);

  useEffect(()=>{
    const items = draft.items || [];
    if (!items.length) return;

    setLoading(true);
    api.post('/api/v1/press-planner/resolve-items', { items })
      .then(({ data }) => setResolved(data?.items || []))
      .catch((err) => {
        console.error(err);
        setResolved(items);
      })
      .finally(() => setLoading(false));
  },[draft]);

  useEffect(()=>{
    if (!selectedPress) return;
    setMountedDiesLoading(true);
    setMountedDiesError(null);
    api.get('/api/v1/press-planner/mounted-dies', { press: selectedPress })
      .then(({ data, error }) => {
        if (error) { setMountedDies(null); setMountedDiesError(error.message || 'Failed to load mounted dies'); return; }
        setMountedDies(data || null);
      })
      .catch((err) => { console.error(err); setMountedDies(null); setMountedDiesError('Failed to load mounted dies'); })
      .finally(() => setMountedDiesLoading(false));
  },[selectedPress]); // B1WIRE

  const items = resolved.length ? resolved : (draft.items || []);
  const currentSlots = slots[selectedPress] || { A:null, B:null };
  const currentQueues = queues[selectedPress] || { A:[], B:[] };

  const totalPcs = useMemo(()=>items.reduce((sum,x)=>sum + pcsQty(x), 0),[items]);
  const mountedDieA = mountedDies?.mounted_dies?.A?.die_code || null; // B1WIRE
  const mountedDieB = mountedDies?.mounted_dies?.B?.die_code || null; // B1WIRE
  const mountedDieWarning = mountedDiesError
    ? mountedDiesError
    : (mountedDies
        ? (mountedDies.reason === 'machine_not_found' ? 'No machine mapped for this press — mounted die unknown.'
          : mountedDies.reason === 'ambiguous_active_setup' ? 'Mounted die unclear (no dated active setup) — assuming change needed.'
          : mountedDies.multiple_active_setups ? 'Multiple active setups; using latest updated.'
          : null)
        : null); // B1WIRE
  const dayPlan = useMemo(
    () => buildDayPlan(currentSlots.A, currentSlots.B, currentQueues.A, currentQueues.B, mountedDieA, mountedDieB),
    [currentSlots.A, currentSlots.B, currentQueues.A, currentQueues.B, mountedDieA, mountedDieB]
  );
  const dayPlanTotals = useMemo(() => { // B2DISP
    const rows = dayPlan.rows || [];
    const runH = rows.reduce((s,r)=>s + (Number(r.runHours)||0), 0);
    const setupM = rows.reduce((s,r)=>s + (Number(r.setupMin)||0), 0);
    const heatM = rows.reduce((s,r)=>s + (Number(r.heatMin)||0), 0);
    const totalH = runH + (setupM + heatM)/60;
    return { runH:Number(runH.toFixed(2)), setupM, heatM, totalH:Number(totalH.toFixed(2)) };
  }, [dayPlan]);

  const materialStatus = materialCheck?.material_status || draft.material_status || 'NOT_CHECKED';
  const shortageCount = Number(materialCheck?.shortage_count || 0);
  const materialReady = materialStatus === 'READY';
  const matSections = (() => { // GRP2
    const mc = materialCheck;
    if (mc && (mc.purchase_material_shortage || mc.internal_production_gap)) {
      return [
        { key: 'purchase', title: 'Purchase / Root Material Shortage', rows: mc.purchase_material_shortage || [] },
        { key: 'internal', title: 'Internal Production Gap', rows: mc.internal_production_gap || [] },
      ].filter((sec) => sec.rows.length);
    }
    return [{ key: 'all', title: null, rows: (mc && mc.lines) || [] }];
  })();
  const hasPressPlan = Boolean(currentSlots?.A || currentSlots?.B || currentQueues?.A?.length || currentQueues?.B?.length);

  const assignedPlanItems = useMemo(() => {
    const out = [];
    const seen = new Set();

    function add(item) {
      if (!item) return;
      const k = plannerItemKey(item);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(item);
    }

    for (const pressCode of Object.keys(slots || {})) {
      for (const slot of ['A', 'B']) {
        add(slots?.[pressCode]?.[slot]);
        for (const item of queues?.[pressCode]?.[slot] || []) add(item);
      }
    }

    return out;
  }, [slots, queues]);

  const assignedPlanCount = assignedPlanItems.length;

  function isPressPlanningItem(item){
    return Boolean(item?.die_code && Number(item?.cavity || 0) > 0);
  }

  const pressPlanningItems = useMemo(
    () => items.filter((item) => isPressPlanningItem(item)),
    [items]
  );

  const directProductionItems = useMemo(
    () => items.filter((item) => (item?.item_id || item?.id) && !isPressPlanningItem(item)),
    [items]
  );

  function recalcItemQty(item, nextQty){
    const qty = Number(nextQty || 0);
    const uom = String(item.uom_code || '').toUpperCase();
    const pcsPerSet = Number(item.pcs_per_set || 4);
    const productionPcs = uom === 'SET' ? qty * pcsPerSet : qty;
    const cavity = Number(item.cavity || 0);
    // Canonical: backend slot cycle time only. No client-side 510 fallback.
    const cycleTimeSec = Number(item.cycle_time_sec) > 0 ? Number(item.cycle_time_sec) : null;
    const hasCycle = cycleTimeSec != null;
    const cyclesRequired = cavity > 0 ? Math.ceil(productionPcs / cavity) : null;
    const runtimeHours = (cyclesRequired && hasCycle) ? Number(((cyclesRequired * cycleTimeSec) / 3600).toFixed(2)) : null;
    const pressDays = runtimeHours ? Number((runtimeHours / 24).toFixed(2)) : null;

    return {
      ...item,
      approved_qty: qty,
      production_pcs: productionPcs,
      cycles_required: cyclesRequired,
      runtime_hours: runtimeHours,
      press_days: pressDays,
      missing_standard: !(cavity > 0 && hasCycle),
    };
  }

  function updateApprovedQty(item, value){
    const updater = (x) => sameItem(x, item) ? recalcItemQty(x, value) : x;

    setResolved(prev => prev.map(updater));

    setDraft(prev => {
      const next = {
        ...prev,
        items: (prev.items || []).map(updater),
      };
      localStorage.setItem('production_plan_draft', JSON.stringify(next));
      return next;
    });

    setSlots(prev => {
      const cur = prev[selectedPress] || { A:null, B:null };
      return {
        ...prev,
        [selectedPress]: {
          A: cur.A && sameItem(cur.A, item) ? recalcItemQty(cur.A, value) : cur.A,
          B: cur.B && sameItem(cur.B, item) ? recalcItemQty(cur.B, value) : cur.B,
        }
      };
    });

    setQueues(prev => {
      const cur = prev[selectedPress] || { A:[], B:[] };
      return {
        ...prev,
        [selectedPress]: {
          A: (cur.A || []).map(updater),
          B: (cur.B || []).map(updater),
        }
      };
    });
  }

  function assignmentFor(item){
    if (sameItem(currentSlots.A,item)) return 'Slot A';
    if (sameItem(currentSlots.B,item)) return 'Slot B';

    const qa = (currentQueues.A || []).findIndex(x => sameItem(x,item));
    if (qa >= 0) return `Queue A #${qa+1}`;

    const qb = (currentQueues.B || []).findIndex(x => sameItem(x,item));
    if (qb >= 0) return `Queue B #${qb+1}`;

    return '';
  }

  function assign(slot,item){
    setSlots(prev => {
      const cur = prev[selectedPress] || { A:null, B:null };
      const next = { ...cur };

      if (sameItem(next.A,item)) next.A = null;
      if (sameItem(next.B,item)) next.B = null;

      next[slot] = item;

      return { ...prev, [selectedPress]: next };
    });

    setQueues(prev => {
      const cur = prev[selectedPress] || { A:[], B:[] };
      return { ...prev, [selectedPress]: removeItemFromQueue(cur,item) };
    });
  }

  function queue(slot,item){
    setSlots(prev => {
      const cur = prev[selectedPress] || { A:null, B:null };
      return {
        ...prev,
        [selectedPress]: {
          A:sameItem(cur.A,item) ? null : cur.A,
          B:sameItem(cur.B,item) ? null : cur.B,
        }
      };
    });

    setQueues(prev => {
      const cur = removeItemFromQueue(prev[selectedPress] || { A:[], B:[] }, item);
      return {
        ...prev,
        [selectedPress]: {
          ...cur,
          [slot]: [...cur[slot], item]
        }
      };
    });
  }

  function unassignFromSelectedPress(item){
    setSlots(prev => {
      const cur = prev[selectedPress] || { A:null, B:null };
      return {
        ...prev,
        [selectedPress]: {
          A: sameItem(cur.A, item) ? null : cur.A,
          B: sameItem(cur.B, item) ? null : cur.B,
        }
      };
    });

    setQueues(prev => {
      const cur = prev[selectedPress] || { A:[], B:[] };
      return { ...prev, [selectedPress]: removeItemFromQueue(cur, item) };
    });
  }

  function plannerActionValue(item){
    const ass = assignmentFor(item);
    if (ass === 'Slot A') return 'RUN_A';
    if (ass === 'Slot B') return 'RUN_B';
    if (ass.startsWith('Queue A')) return 'QUEUE_A';
    if (ass.startsWith('Queue B')) return 'QUEUE_B';
    return '';
  }

  function setPlannerAction(item, value){
    if (value === 'RUN_A') return assign('A', item);
    if (value === 'RUN_B') return assign('B', item);
    if (value === 'QUEUE_A') return queue('A', item);
    if (value === 'QUEUE_B') return queue('B', item);
    return unassignFromSelectedPress(item);
  }

  function plannerStatusLabel(ass){
    if (ass === 'Slot A') return 'Running on Slot A';
    if (ass === 'Slot B') return 'Running on Slot B';
    if (ass.startsWith('Queue A')) return ass.replace('Queue A', 'Queued after Slot A');
    if (ass.startsWith('Queue B')) return ass.replace('Queue B', 'Queued after Slot B');
    return 'Not planned';
  }

  function clear(slot){
    setSlots(prev => ({
      ...prev,
      [selectedPress]: { ...prev[selectedPress], [slot]: null }
    }));
  }

  function removeQueued(slot,index){
    setQueues(prev => {
      const cur = prev[selectedPress] || { A:[], B:[] };
      return {
        ...prev,
        [selectedPress]: {
          ...cur,
          [slot]: cur[slot].filter((_,i)=>i !== index)
        }
      };
    });
  }

  function returnToMrp(item){
    if (!confirm(`Return ${item.item_code} to MRP? It will be removed from this press plan draft.`)) return;

    const key = plannerItemKey(item);

    setResolved(prev => (prev || []).filter(x => plannerItemKey(x) !== key));

    setDraft(prev => {
      const next = {
        ...prev,
        items: (prev.items || []).filter(x => plannerItemKey(x) !== key),
      };

      if (next.items.length) {
        localStorage.setItem('production_plan_draft', JSON.stringify(next));
      } else {
        localStorage.removeItem('production_plan_draft');
      }

      return next;
    });

    setSlots(prev => {
      const out = { ...prev };
      for (const pressCode of Object.keys(out || {})) {
        out[pressCode] = {
          A: plannerItemKey(out[pressCode]?.A) === key ? null : out[pressCode]?.A,
          B: plannerItemKey(out[pressCode]?.B) === key ? null : out[pressCode]?.B,
        };
      }
      return out;
    });

    setQueues(prev => {
      const out = { ...prev };
      for (const pressCode of Object.keys(out || {})) {
        out[pressCode] = {
          A: (out[pressCode]?.A || []).filter(x => plannerItemKey(x) !== key),
          B: (out[pressCode]?.B || []).filter(x => plannerItemKey(x) !== key),
        };
      }
      return out;
    });
  }

  async function checkMaterial(){
    try {
      setCheckingMaterial(true);
      const payload = items.map((x) => ({
        item_code: x.item_code,
        item_name: x.item_name,
        approved_qty: setQty(x),
        suggested_qty: x.suggested_qty,
        uom_code: x.uom_code,
        pcs_per_set: x.pcs_per_set,
      }));

      const { data } = await api.post('/api/v1/material-availability/tentative-plan-check', { items: payload });
      setMaterialCheck(data || null);
    } catch (err) {
      console.error(err);
      alert('Material check failed. Check backend console.');
    } finally {
      setCheckingMaterial(false);
    }
  }

  async function createPurchaseRequirement(){
    if (!materialCheck?.lines?.length) {
      alert('Optional preview first.');
      return;
    }

    // SROUTE: route by item class - only purchasable shortages go to a Purchase Requirement
    const purchasableShort = (materialCheck.lines || []).filter((l) => l.status === 'SHORT' && l.is_purchasable);
    const wipShort = (materialCheck.lines || []).filter((l) => l.status === 'SHORT' && !l.is_purchasable && l.is_manufactured);
    if (!purchasableShort.length) {
      alert(wipShort.length
        ? `No purchasable shortages. ${wipShort.length} WIP/intermediate item(s) need upstream production (Work Order) - handled in the next phase.`
        : 'No purchasable shortage lines to requisition.');
      return;
    }

    try {
      setCreatingPr(true);
      const { data } = await api.post('/api/v1/material-availability/purchase-requirement', {
        source_type: 'TENTATIVE_PLAN_MATERIAL_SHORTAGE',
        material_status: materialCheck.material_status,
        lines: purchasableShort,
      });

      setCreatedPr(data || null);
      alert(`Purchase Requirement created: ${data?.purchase_requirement?.pr_no || ''}`);
    } catch (err) {
      console.error(err);
      alert('Failed to create Purchase Requirement.');
    } finally {
      setCreatingPr(false);
    }
  }

  function ppoClientKey(x){
    return String(x?.client_key || x?.item_id || x?.id || x?.item_code || '');
  }

  function ppoCleanItem(x){
    const qty = Number(x?.approved_qty ?? x?.approvedQty ?? x?.suggested_qty ?? x?.quantity ?? x?.qty ?? 0);
    const uom = String(x?.uom_code || '').toUpperCase();
    const pcsPerSet = Number(x?.pcs_per_set || 4);
    const productionPcs = Number(x?.production_pcs ?? x?.productionPcs ?? (uom === 'SET' ? qty * pcsPerSet : qty));

    return {
      client_key: ppoClientKey(x),
      item_id: x.item_id || x.id,
      item_code: x.item_code,
      item_name: x.item_name,
      uom_id: x.uom_id || null,
      uom_code: x.uom_code,
      approved_qty: qty,
      production_pcs: productionPcs,
      pcs_per_set: pcsPerSet,
      cavity: x.cavity || null,
      cycle_time_sec: Number(x.cycle_time_sec) > 0 ? Number(x.cycle_time_sec) : null, // PATCH23: no client 510
      source_type: x.source_type || 'MRP',
      source_ref_id: x.source_ref_id || null,
      source_line_id: x.source_line_id || null,
    };
  }

  function ppoCleanPlanMap(map){
    const out = {};
    for (const pressCode of Object.keys(map || {})) {
      out[pressCode] = {};
      for (const slot of ['A','B']) {
        out[pressCode][slot] = map?.[pressCode]?.[slot] ? ppoCleanItem(map[pressCode][slot]) : null;
      }
    }
    return out;
  }

  function ppoCleanQueueMap(map){
    const out = {};
    for (const pressCode of Object.keys(map || {})) {
      out[pressCode] = {};
      for (const slot of ['A','B']) {
        out[pressCode][slot] = (map?.[pressCode]?.[slot] || []).map(ppoCleanItem);
      }
    }
    return out;
  }

  async function createDirectProductionPlan(){
    if (creatingDirectPpo) return; // P-2C: double-submit guard
    if (!directProductionItems.length) {
      alert('No direct production items found.');
      return;
    }

    const confirmMessage = `Create Production Plan directly for ${directProductionItems.length} item(s) with no press planning?`;
    if (!confirm(confirmMessage)) return;

    const directKeys = new Set(directProductionItems.map(plannerItemKey));

    try {
      setCreatingDirectPpo(true);

      // P-2C: close direct PPO bypass. Run the SAME Engine B feasibility
      // (tentative-plan-check) the Demand path uses, instead of stamping
      // material_status:'NOT_CHECKED' blindly.
      let p2cFeasibility = null;
      try {
        const { data: fData, error: fErr } = await api.post('/api/v1/material-availability/tentative-plan-check', {
          items: directProductionItems.map(it => ({
            item_code: it.item_code,
            item_name: it.item_name || '',
            approved_qty: Number(it.approved_qty ?? it.suggested_qty ?? it.qty ?? 0),
            suggested_qty: Number(it.suggested_qty ?? it.approved_qty ?? it.qty ?? 0),
            uom_code: String(it.uom_code || 'PCS').toUpperCase(),
            pcs_per_set: Number(it.pcs_per_set || 4),
          })),
        });
        if (!fErr) p2cFeasibility = fData || null;
      } catch (fErr) {
        console.error('[P-2C] feasibility check failed', fErr);
      }

      const p2cMaterialStatus = p2cFeasibility?.material_status || 'CHECK_FAILED';
      const p2cPressReadyQty = p2cFeasibility?.press_ready_qty ?? null;
      const p2cBlockedQty = p2cFeasibility?.blocked_qty ?? null;

      const res = await api.post('/api/v1/production-plan-orders', {
        source_type: 'MANUAL_PRODUCTION',
        material_status: p2cMaterialStatus, // P-2C: real status (was 'NOT_CHECKED')
        press_ready_qty: p2cPressReadyQty,  // P-2C
        blocked_qty: p2cBlockedQty,         // P-2C
        press_status: 'NOT_REQUIRED',
        notes: `Created directly from Manual Production. Direct items: ${directProductionItems.length}.`,
        items: directProductionItems.map(ppoCleanItem),
      });

      if (res.error) {
        alert(res.error.message || 'Failed to create Production Plan.');
        return;
      }

      setCreatedPpo(res.data || null);

      setResolved(prev => (prev || []).filter(x => !directKeys.has(plannerItemKey(x))));

      setDraft(prev => {
        const next = {
          ...prev,
          items: (prev.items || []).filter(x => !directKeys.has(plannerItemKey(x))),
        };

        if (next.items.length) {
          localStorage.setItem('production_plan_draft', JSON.stringify(next));
        } else {
          localStorage.removeItem('production_plan_draft');
        }

        return next;
      });

      alert(`Production Plan created directly: ${res.data?.ppo_number || ''}`);
    } catch (err) {
      console.error(err);
      alert('Failed to create direct Production Plan.');
    } finally {
      setCreatingDirectPpo(false);
    }
  }

  async function createPPO(){
    if (!assignedPlanItems.length) {
      alert('Please assign at least one item to a press slot before creating PPO.');
      return;
    }

    const unassignedCount = Math.max(0, items.length - assignedPlanItems.length);
    const confirmMessage = unassignedCount
      ? `Create PPO for ${assignedPlanItems.length} assigned item(s) only? ${unassignedCount} unassigned basket item(s) will stay pending.`
      : `Create PPO for ${assignedPlanItems.length} assigned item(s)?`;

    if (!confirm(confirmMessage)) return;

    // P-1: soft material gate. Warn (do not hard-block) when material is not READY.
    // Press Planner Material tab remains the final recheck.
    if (!materialReady) {
      const proceedMaterial = confirm(
        `Material status: ${materialStatus}. Material is not confirmed READY for these items.\n\nCreate PPO anyway? You can run the Material tab recheck first.`
      );
      if (!proceedMaterial) return;
    }

    const plannedKeys = new Set(assignedPlanItems.map(plannerItemKey));

    try {
      setCreatingPpo(true);

      const res = await api.post('/api/v1/production-plan-orders', {
        source_type: 'TENTATIVE_PRESS_PLAN',
        material_status: materialStatus,
        press_status: 'PLANNED',
        notes: `Created from Press Planner assigned slots. Assigned items: ${assignedPlanItems.length}.`,
        items: assignedPlanItems.map(ppoCleanItem),
        press_plan: {
          selected_press: selectedPress,
          slots: ppoCleanPlanMap(slots),
          queues: ppoCleanQueueMap(queues),
        },
      });

      if (res.error) {
        alert(res.error.message || 'Failed to create PPO.');
        return;
      }

      setCreatedPpo(res.data || null);

      setResolved(prev => (prev || []).filter(x => !plannedKeys.has(plannerItemKey(x))));

      setDraft(prev => {
        const next = {
          ...prev,
          items: (prev.items || []).filter(x => !plannedKeys.has(plannerItemKey(x))),
        };

        if (next.items.length) {
          localStorage.setItem('production_plan_draft', JSON.stringify(next));
        } else {
          localStorage.removeItem('production_plan_draft');
        }

        return next;
      });

      setSlots({
        PRESS_1: { A: null, B: null },
        PRESS_2: { A: null, B: null },
      });
      setQueues({
        PRESS_1: { A: [], B: [] },
        PRESS_2: { A: [], B: [] },
      });

      alert(`PPO created from assigned slots only: ${res.data?.ppo_number || ''}`);
    } catch (err) {
      console.error(err);
      alert('Failed to create PPO.');
    } finally {
      setCreatingPpo(false);
    }
  }

  if (!items.length) {
    return (
      <div style={S.page}>
        <div style={{maxWidth:1180, margin:'0 auto', padding:'18px 20px'}}>
          <div style={{marginBottom:14}}>
            <h1 style={{margin:0, fontSize:24, lineHeight:'30px', fontWeight:900, color:'#041B3C', letterSpacing:'-0.02em'}}>
              Press Planner
            </h1>
            <div style={{fontSize:13, color:'#64748B', marginTop:4}}>
              Assign MTS production items to press slots before creating a tentative PPO.
            </div>
          </div>

          <section style={{
            width:'min(720px, 100%)',
            background:'#FFFFFF',
            border:'1px solid #DCDFE4',
            borderRadius:16,
            boxShadow:'0 1px 3px rgba(15,23,42,0.05)',
            padding:'28px 30px',
            marginTop:18
          }}>
            <div style={{
              width:44,
              height:44,
              borderRadius:12,
              background:'#EEF2FF',
              color:'#003D9B',
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              fontSize:22,
              fontWeight:900,
              marginBottom:14
            }}>
              PP
            </div>

            <div style={{fontSize:20, fontWeight:900, color:'#041B3C', marginBottom:8}}>
              No items in press planning queue
            </div>

            <div style={{fontSize:13, color:'#64748B', lineHeight:'20px', marginBottom:18}}>
              Items transferred from Demand / MRP Engine will appear here for die, cavity, runtime and slot planning.
              If a tentative PPO was already created, open Production Plan Orders.
            </div>

            <div style={{display:'flex', gap:10, flexWrap:'wrap'}}>
              <button
                style={{
                  border:0,
                  borderRadius:10,
                  background:'#003D9B',
                  color:'#FFFFFF',
                  padding:'12px 18px',
                  fontWeight:900,
                  fontSize:13,
                  cursor:'pointer',
                  boxShadow:'0 8px 18px rgba(0,61,155,0.18)'
                }}
                onClick={()=>router.push('/demand-production-engine')}
              >
                Open Demand / MRP Engine →
              </button>

              <button
                style={{
                  border:'1px solid #C3C6D6',
                  borderRadius:10,
                  background:'#FFFFFF',
                  color:'#041B3C',
                  padding:'12px 18px',
                  fontWeight:900,
                  fontSize:13,
                  cursor:'pointer'
                }}
                onClick={()=>router.push('/production-plan-orders')}
              >
                View Tentative PPOs →
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <header style={S.topbar}>
        <div style={{display:'flex', alignItems:'center', gap:28}}>
          <div style={S.brand}>Press Planner</div>
          <nav style={S.nav}>
            {PHASES.map((p)=>(
              <button
                key={p}
                type="button"
                onClick={()=>setActivePhase(p)}
                style={{
                  ...(p === activePhase ? S.navActive : {}),
                  background:'transparent',
                  border:0,
                  cursor:'pointer',
                  font: 'inherit',
                  color: p === activePhase ? '#004AC6' : '#505F76',
                  fontWeight: p === activePhase ? 900 : 500,
                  padding: 0,
                }}
              >
                {p}
              </button>
            ))}
          </nav>
        </div>

        <div>
          <button style={S.checkBtn} onClick={checkMaterial} disabled={checkingMaterial}>
            {checkingMaterial ? 'Checking...' : 'Check Material Preview'}
          </button>

          <button
            style={{...S.checkBtn, marginLeft:8, background:'#16A34A'}}
            onClick={createPPO}
            disabled={creatingPpo || !assignedPlanItems.length}
          >
            {creatingPpo ? 'Creating PPO...' : `Create PPO from ${assignedPlanCount} Assigned`}
          </button>
          
          <div style={S.lockSub}>
            {materialReady ? 'Material ready' : 'Material preview optional before PPO'}
          </div>
        </div>
      </header>

      <main style={S.main}>
        <div style={S.statusGrid}>
          <div style={S.statusCard}>
            <div style={S.statusLabel}>Plan Status</div>
            <div>
              <span style={S.pillBlue}>TENTATIVE PLAN</span>
              <span style={{...S.muted, marginLeft:8}}>{items.length} item(s) • {assignedPlanCount} assigned</span>
            </div>
          </div>

          <div style={S.statusCard}>
            <div style={S.statusLabel}>Material Status</div>
            <div>
              <span style={materialReady ? S.pillBlue : materialCheck ? S.pillRed : S.pillOrange}>
                {materialReady ? 'READY' : materialCheck ? 'SHORTAGE' : 'NOT CHECKED'}
              </span>
              <span style={{...S.muted, marginLeft:8, color: materialReady ? '#166534' : materialCheck ? '#BA1A1A' : '#92400E'}}>
                {materialCheck ? `${shortageCount} shortage item(s)` : 'Optional preview'}
              </span>
            </div>
          </div>

          <div style={S.statusCard}>
            <div style={S.statusLabel}>Press Status</div>
            <div>
              <span style={hasPressPlan ? S.pillBlue : S.pillOrange}>
                {hasPressPlan ? 'PRESS PLANNED' : 'NOT PLANNED'}
              </span>
              <span style={{...S.muted, marginLeft:8}}>
                {assignedPlanCount ? `${assignedPlanCount} assigned` : 'Assign press slots'}
              </span>
            </div>
          </div>

          <div style={S.statusCard}>
            <div style={S.statusLabel}>Total Volume</div>
            <div><span style={S.volume}>{totalPcs.toLocaleString()}</span> <span style={S.muted}>PCS</span></div>
          </div>
        </div>

        {activePhase === 'Material' ? (
          <div style={S.grid}>
            <div style={S.leftCol}>
              <section style={S.panel}>
                <div style={S.panelHead}>
                  <div style={S.panelTitle}>🧾 Material Requirement Check</div>
                  <button style={S.checkBtn} onClick={checkMaterial} disabled={checkingMaterial}>
                    {checkingMaterial ? 'Checking...' : 'Recheck Material Preview'}
                  </button>
                </div>

                {!materialCheck ? (
                  <div style={S.empty}>
                    Material preview has not been checked yet. This is optional before PPO and required before WO release.<br/><br/>
                    <button style={S.checkBtn} onClick={checkMaterial} disabled={checkingMaterial}>
                      {checkingMaterial ? 'Checking...' : 'Check Material Preview'}
                    </button>
                  </div>
                ) : !(materialCheck.lines && materialCheck.lines.length) ? ( /* MATFIX: checked but no requirement rows */
                  <div style={S.empty}>
                    Material checked — no material requirement rows were produced for the assigned items (no recipe inputs to fulfill).<br/><br/>
                    Status: {materialCheck.material_status || 'READY'}. If you expected requirements here, verify the recipe / BOM inputs for these items.
                  </div>
                ) : (
                  <div style={{overflowX:'auto'}}>
                    {matSections.map((sec)=>( /* GRP2 */
                    <div key={sec.key} style={{marginBottom:14}}>
                      {sec.title && <div style={{fontSize:12, fontWeight:900, color:'#111827', margin:'8px 0 4px'}}>{sec.title}</div>}
                    <table style={S.table}>
                      <thead>
                        <tr>
                          <th style={S.th}>Item</th>
                          <th style={S.th}>Stage</th>
                          <th style={S.th}>Required</th>
                          <th style={S.th}>Available</th>
                          <th style={S.th}>Shortage</th>
                          <th style={S.th}>Fulfillment</th>
                          <th style={S.th}>Status</th>
                          <th style={S.th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(sec.rows || []).map((line)=>{
                          const required = Number(line.required_qty || 0);
                          const available = Number(line.available_qty || 0);
                          const pct = required > 0 ? Math.min(100, Math.round((available / required) * 100)) : 100;
                          const isShort = line.status === 'SHORT';

                          return (
                            <tr
                              key={`${line.item_code}-${line.required_uom}`}
                              style={isShort ? S.alertRow : S.runRow}
                            >
                              <td style={S.td}>
                                <div style={S.code}>{line.item_code}</div>
                                <div style={S.muted}>{line.item_name}</div>
                              </td>
                              <td style={S.td}>{line.stage_type || '-'}</td>
                              <td style={S.tdRight}>{line.required_qty} {line.required_uom}</td>
                              <td style={S.tdRight}>{line.available_qty} {line.required_uom}</td>
                              <td style={S.tdRight}>
                                <b style={{color:isShort ? '#BA1A1A' : '#004AC6'}}>
                                  {line.shortage_qty} {line.required_uom}
                                </b>
                              </td>
                              <td style={S.td}>
                                <div style={S.fulfillTrack}>
                                  <div
                                    style={{
                                      height:'100%',
                                      width:`${pct}%`,
                                      background:isShort ? '#BA1A1A' : '#004AC6',
                                      borderRadius:999,
                                    }}
                                  />
                                </div>
                                <div style={S.muted}>{pct}% Available</div>
                              </td>
                              <td style={S.td}>
                                <span style={isShort ? S.pillRed : S.pillBlue}>
                                  {line.status}
                                </span>
                              </td>
                              <td style={S.td}>{ /* SROUTE */
                                !isShort ? '—'
                                  : line.is_purchasable ? <span style={S.pillBlue}>PURCHASE</span>
                                  : line.is_manufactured ? <span style={S.pillOrange}>PRODUCE (WO)</span>
                                  : <span style={S.pillRed}>BLOCKED</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div style={S.rightCol}>
              <section style={S.panel}>
                <div style={S.queueHead}>Material Summary</div>
                <div style={S.queueBody}>
                  <div style={S.summaryBox}>
                    <div style={S.statusLabel}>Current Status</div>
                    <div style={{marginTop:8}}>
                      <span style={materialReady ? S.pillBlue : S.pillOrange}>
                        {materialCheck?.material_status || 'NOT_CHECKED'}
                      </span>
                    </div>
                    <div style={{marginTop:8, fontWeight:900}}>
                      {shortageCount} item(s) under required quantity
                    </div>
                  </div>

                  <div style={S.summaryBox}>
                    <div style={S.statusLabel}>Execution Flow</div>
                    <div style={{marginTop:8}}>
                      <span style={materialReady ? S.pillBlue : S.pillRed}>
                        {materialReady ? 'MATERIAL READY' : 'BLOCKED'}
                      </span>
                    </div>
                    <div style={{...S.muted, marginTop:8}}>
                      Production execution cannot start until required material is available and approval is completed.
                    </div>
                  </div>

                  <button style={S.actionSecondary} onClick={()=>setActivePhase('Press Plan')}>
                    ← Back to Press Plan
                  </button>

                  <button
                    style={shortageCount > 0 && !createdPr ? S.checkBtn : S.actionDisabled}
                    onClick={createPurchaseRequirement}
                    disabled={!shortageCount || creatingPr || Boolean(createdPr)}
                  >
                    {createdPr
                      ? `Created ${createdPr.purchase_requirement?.pr_no || ''}`
                      : creatingPr
                        ? 'Creating...'
                        : 'Create Purchase Req'}
                  </button>

                  <div style={{...S.muted, marginTop:8, textAlign:'center'}}>
                    {createdPr
                      ? 'Draft Purchase Requirement created from shortage lines.'
                      : 'Creates draft Purchase Requirement for shortage items only.'}
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
        <div style={S.grid}>
          <div style={S.leftCol}>
            {/* S1LOCK: finalized/locked press plan banner */}
            {createdPpo && createdPpo.press_status === 'PLANNED' && (
              <div style={{ marginBottom:14, padding:'10px 14px', background:'#DCFCE7', border:'1px solid #16A34A', borderRadius:8, color:'#166534', fontSize:13, fontWeight:800 }}>
                ✓ Press plan finalized & locked — PPO {createdPpo.ppo_number || ''} (press_status: PLANNED). Assigned slots saved.
              </div>
            )}
            <section style={S.panel}>
              <div style={S.panelHead}>
                <div style={S.panelTitle}>🧺 Demand Basket</div>
                <input style={S.search} placeholder="Search Die/Item..." />
              </div>

              <div style={{overflowX:'auto'}}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Item Code / Name</th>
                      <th style={S.th}>Die Code</th>
                      <th style={S.th}>Cav</th>
                      <th style={S.th}>Appr. Qty</th>
                      <th style={S.th}>Runtime</th>
                      <th style={S.th}>Cycles</th>
                      <th style={S.th}>Planner Action</th>
                      <th style={S.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r,idx)=>{
                      const ass = assignmentFor(r);
                      const rowStyle = ass.startsWith('Slot') ? S.currentRow : ass ? S.queueRow : undefined;
                      const slotAOccupiedByOther = Boolean(currentSlots.A && !sameItem(currentSlots.A, r));
                      const slotBOccupiedByOther = Boolean(currentSlots.B && !sameItem(currentSlots.B, r));
                      const canQueueAfterA = Boolean(currentSlots.A) && !sameItem(currentSlots.A, r);
                      const canQueueAfterB = Boolean(currentSlots.B) && !sameItem(currentSlots.B, r);
                      const dullBtn = { ...S.btn, opacity:.35, cursor:'not-allowed', background:'#F8FAFC', color:'#94A3B8' };

                      return (
                        <tr key={`${r.item_code}-${idx}`} style={rowStyle}>
                          <td style={S.td}>
                            <div style={S.code}>{r.item_code}</div>
                            <div style={S.muted}>{r.item_name}</div>
                          </td>
                          <td style={S.td}><span style={S.mono}>{fmt(r.die_code)}</span></td>
                          <td style={S.tdCenter}>{fmt(r.cavity)}</td>
                          <td style={S.tdRight}>
                            <input
                              style={S.qtyInput}
                              type="number"
                              min="0"
                              value={setQty(r)}
                              onChange={(e)=>updateApprovedQty(r, e.target.value)}
                            />{' '}
                            <span style={S.muted}>{r.uom_code}</span>
                          </td>
                          <td style={S.tdRight}>
                            {r.runtime_hours ? `${r.runtime_hours} hr` : (r.missing_standard ? <span style={S.muted}>Setup needed</span> : '-')}
                            {/* PHASEC: informational setup/heat ingredients (no runtime impact) */}
                            {(r.setup_time_min != null || r.heating_time_min != null) && (
                              <div style={{ fontSize:10, color:'#6B7280', marginTop:2 }}>
                                {r.setup_time_min != null ? `Setup ${r.setup_time_min}m` : ''}
                                {r.setup_time_min != null && r.heating_time_min != null ? ' · ' : ''}
                                {r.heating_time_min != null ? `Heat ${r.heating_time_min}m` : ''}
                                {r.setup_time_source && r.setup_time_source !== 'NONE' ? ` (${String(r.setup_time_source).toLowerCase()})` : ''}
                              </div>
                            )}
                          </td>
                          <td style={S.tdRight}><span style={S.mono}>{fmt(r.cycles_required)}</span></td>
                          <td style={S.td}>
                            <select
                              value={plannerActionValue(r)}
                              onChange={e=>setPlannerAction(r, e.target.value)}
                              style={{
                                height:32,
                                minWidth:180,
                                border:'1px solid #C8CEDA',
                                borderRadius:6,
                                padding:'0 8px',
                                fontSize:12,
                                fontWeight:800,
                                color:'#0F172A',
                                background:'#fff'
                              }}
                            >
                              <option value="">Not planned</option>
                              {(!currentSlots.A || sameItem(currentSlots.A, r)) && <option value="RUN_A">Run now — Slot A</option>}
                              {(!currentSlots.B || sameItem(currentSlots.B, r)) && <option value="RUN_B">Run now — Slot B</option>}
                              {currentSlots.A && !sameItem(currentSlots.A, r) && <option value="QUEUE_A">Queue after Slot A</option>}
                              {currentSlots.B && !sameItem(currentSlots.B, r) && <option value="QUEUE_B">Queue after Slot B</option>}
                            </select>
                          </td>
                          <td style={S.td}>
                            {ass.startsWith('Slot') ? (
                              <span style={{...S.statusSmall, color:'#166534'}}><span style={S.greenDot}></span>{plannerStatusLabel(ass)}</span>
                            ) : ass ? (
                              <span style={{...S.statusSmall, color:'#943700'}}><span style={S.orangeDot}></span>{plannerStatusLabel(ass)}</span>
                            ) : (
                              <span style={{...S.muted, fontStyle:'italic'}}>{plannerStatusLabel(ass)}</span>
                            )}
                            <div style={{marginTop:6}}>
                              <button
                                type="button"
                                style={{...S.btn, fontSize:10, padding:'4px 7px', borderColor:'#FCA5A5', color:'#991B1B', background:'#FEF2F2'}}
                                onClick={()=>returnToMrp(r)}
                              >
                                Return to MRP
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {directProductionItems.length > 0 && (
              <section style={S.panel}>
                <div style={S.panelHead}>
                  <div style={S.panelTitle}>🧾 Direct Production — no press planning needed</div>
                  <button
                    style={{...S.checkBtn, background:'#16A34A'}}
                    onClick={createDirectProductionPlan}
                    disabled={creatingDirectPpo}
                  >
                    {creatingDirectPpo ? 'Creating...' : `Create Production Plan (${directProductionItems.length})`}
                  </button>
                </div>

                <div style={{overflowX:'auto'}}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Item Code / Name</th>
                        <th style={S.th}>Qty</th>
                        <th style={S.th}>Reason</th>
                        <th style={S.th}>Route</th>
                      </tr>
                    </thead>
                    <tbody>
                      {directProductionItems.map((item)=>(
                        <tr key={plannerItemKey(item)} style={S.runRow}>
                          <td style={S.td}>
                            <div style={S.code}>{item.item_code}</div>
                            <div style={S.muted}>{item.item_name || '-'}</div>
                          </td>
                          <td style={S.tdRight}>
                            <span style={S.mono}>{setQty(item)}</span>{' '}
                            <span style={S.muted}>{item.uom_code || '-'}</span>
                          </td>
                          <td style={S.td}>{item.reason || item.source_type || 'Manual Production'}</td>
                          <td style={S.td}>
                            <span style={S.pillBlue}>DIRECT PPO</span>
                            <div style={S.muted}>No die / cavity / press slot required</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section style={S.panel}>
              <div style={S.panelHead}>
                <div style={S.panelTitle}>📅 Day-wise Output Timeline</div>
                <div style={{display:'flex', gap:14, fontSize:10, fontWeight:900}}>
                  <span>🟩 RUN</span>
                  <span>🟨 DIE CHANGE</span>
                  <span>🟧 HEAT</span>
                  <span>🟥 WAIT/ERROR</span>
                </div>
              </div>

              {/* B1WIRE: mounted-die warning */}
              {mountedDieWarning && (
                <div style={{margin:'8px 0', padding:'6px 10px', background:'#FEF3C7', color:'#92400E', borderRadius:5, fontSize:11, fontWeight:700}}>
                  ⚠ {mountedDieWarning}
                </div>
              )}
              <div style={{overflowX:'auto'}}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Day</th>
                      <th style={S.th}>Slot</th>
                      <th style={S.th}>Action</th>
                      <th style={S.th}>Item / Part No</th>
                      <th style={S.th}>Die</th>
                      <th style={S.th}>Setup (m)</th>
                      <th style={S.th}>Heat (m)</th>
                      <th style={S.th}>Run (h)</th>
                      <th style={S.th}>Output</th>
                      <th style={S.th}>Balance</th>
                      <th style={S.th}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayPlan.rows.length ? dayPlan.rows.map((r,idx)=>(
                      <tr key={`${r.day}-${r.slot}-${idx}`} style={dayRowStyle(r.action)}>
                        <td style={S.td}><b>Day {r.day}</b></td>
                        <td style={S.tdCenter}>{r.slot}</td>
                        <td style={S.td}><div style={actionBadge(r.action)}>{r.action}</div></td>
                        <td style={S.td}>{r.item}</td>
                        <td style={S.td}>{r.die || '-'}</td>
                        <td style={S.tdRight}>{r.setupMin != null ? r.setupMin : '-'}</td>
                        <td style={S.tdRight}>{r.heatMin != null ? r.heatMin : '-'}</td>
                        <td style={S.tdRight}>{r.runHours ? r.runHours : '-'}</td>
                        <td style={S.tdRight}><span style={S.mono}>{r.output}</span></td>
                        <td style={S.tdRight}><span style={S.mono}>{r.balance}</span></td>
                        <td style={S.td}>{r.note}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td style={S.td} colSpan={11}>Assign or queue SKU to calculate day-wise output.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>{/* B2DISP totals */}
                    <tr style={{ background:'#F8FAFC', fontWeight:900 }}>
                      <td style={S.td} colSpan={5}>Totals</td>
                      <td style={S.tdRight}>{dayPlanTotals.setupM} m</td>
                      <td style={S.tdRight}>{dayPlanTotals.heatM} m</td>
                      <td style={S.tdRight}>{dayPlanTotals.runH} h</td>
                      <td style={S.td} colSpan={3}>Total day-hours: {dayPlanTotals.totalH} h</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </div>

          <div style={S.rightCol}>
            <section style={S.panel}>
              <div style={S.pressHead}>
                <div style={{fontSize:15, fontWeight:900}}>⚙ Press 01</div>
                <div style={S.pressTabs}>
                  {PRESSES.map(p=>(
                    <button
                      key={p.id}
                      style={selectedPress === p.id ? S.pressTabActive : S.pressTab}
                      onClick={()=>setSelectedPress(p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <div style={S.pressBody}>
                <SlotCard title="Slot A" item={currentSlots.A} onClear={()=>clear('A')} />
                <SlotCard title="Slot B" item={currentSlots.B} onClear={()=>clear('B')} />
              </div>
            </section>

            <section style={S.panel}>
              <div style={S.queueHead}>☰ Continuation Queue</div>
              <div style={S.queueBody}>
                {['A','B'].map(slot=>(
                  <div key={slot} style={{marginBottom:18}}>
                    <div style={slot === 'A' ? S.queueTitleA : S.queueTitleB}>Slot {slot} Queue</div>

                    {(currentQueues[slot] || []).length ? (
                      <div style={S.queueList}>
                        {currentQueues[slot].map((q,i)=>(
                          <div key={`${q.item_code}-${i}`} style={S.queueItem}>
                            <div>
                              <div style={{fontWeight:900}}>{i+1}. {q.item_code}</div>
                              <div style={S.muted}>Qty: {setQty(q)} {q.uom_code}</div>
                            </div>
                            <button style={S.removeBtn} onClick={()=>removeQueued(slot,i)}>✕</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={S.emptyQueue}>Queue is empty for Slot {slot}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section style={S.panel}>
              <div style={S.queueHead}>🧾 Material Summary</div>
              <div style={S.queueBody}>
                {!materialCheck ? (
                  <div style={S.emptyQueue}>Material not checked yet.</div>
                ) : (
                  <div>
                    <div style={{marginBottom:10}}>
                      <span style={materialReady ? S.pillBlue : S.pillOrange}>
                        {materialCheck.material_status}
                      </span>
                      <span style={{...S.muted, marginLeft:8}}>
                        {shortageCount} shortage item(s)
                      </span>
                    </div>
                    <button style={S.checkBtn} onClick={()=>setActivePhase('Material')}>
                      Open Material Tab
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
