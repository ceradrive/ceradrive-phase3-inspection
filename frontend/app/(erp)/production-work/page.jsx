'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../hooks/useAuth';
import { useRouter } from 'next/navigation';

const readinessFilters = ['ALL', 'READY', 'PARTIAL', 'BLOCKED', 'NOT_CHECKED'];

const processFilters = [
  ['ALL', 'All Processes'],
  ['MIXING', 'Mixing'],
  ['SHOT_BLASTING', 'Shot Blasting'],
  ['PREFORMING', 'Preforming'],
  ['ADHESIVE_COATING', 'Adhesive'],
  ['MOULDING', 'Moulding'],
  ['GRINDING', 'Grinding'],
  ['POWDER_COATING', 'Powder'],
  ['OVEN_CURING', 'Oven'],
  ['STACKING', 'Stacking'],
  ['SET_ASSEMBLY', 'Set Assembly'],
];

const workTabs = [
  ['READY', 'My Ready Work'],
  ['IN_PROGRESS', 'My In Progress'],
  ['LOGGED', 'My Done'],
];

const controlStatusFilters = [
  ['ALL', 'All Statuses'],
  ['UNASSIGNED', 'Unassigned'],
  ['READY', 'Ready To Start'],
  ['IN_PROGRESS', 'In Progress'],
  ['PARTIAL', 'Partial'],
  ['BLOCKED', 'Blocked'],
  ['HALT', 'Halt'],
  ['COMPLETED', 'Completed'],
];

const processOrder = processFilters.map(([key]) => key);

const PRODUCTION_CONTROL_ROLES = new Set([
  'admin',
  'planner',
  'store_manager',
  'supervisor',
]);

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function sortByProcessAndWo(a, b) {
  const ai = processOrder.indexOf(a.process?.type_code || '');
  const bi = processOrder.indexOf(b.process?.type_code || '');
  if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  return String(a.wo_number || '').localeCompare(String(b.wo_number || ''));
}


// P3-PROD-WORK-STK-GROUPING-1
// Display/read-model only: group MTS stage chain under the STK SKU and sort by real process flow.
const mtsStageOrder = ['PF', 'SBBP', 'ACBP', 'MLD', 'GRD', 'PWC', 'CUR', 'STK'];
const mtsStageRank = new Map(mtsStageOrder.map((stage, index) => [stage, index]));

function parseMtsStageItemCode(itemCode) {
  const code = String(itemCode || '').trim();
  const match = code.match(/^(.+?)_(PF|SBBP|ACBP|MLD|GRD|PWC|CUR|STK)(\d+)$/i);
  if (!match) return null;

  return {
    prefix: match[1].toUpperCase(),
    stage: match[2].toUpperCase(),
    suffix: match[3],
  };
}

function stkGroupCodeForRow(row) {
  const parsed = parseMtsStageItemCode(row?.item?.item_code);
  if (parsed) return `${parsed.prefix}_STK${parsed.suffix}`;
  return row?.fg_item?.item_code || row?.item?.item_code || 'UNKNOWN';
}

function stageRankForRow(row) {
  const parsed = parseMtsStageItemCode(row?.item?.item_code);
  if (parsed && mtsStageRank.has(parsed.stage)) return mtsStageRank.get(parsed.stage);

  const pi = processOrder.indexOf(row?.process?.type_code || '');
  return pi === -1 ? 999 : pi + 100;
}

// P3-PROD-WORK-PARENT-CHILD-VISUAL-1
// Display only: strengthen STK parent vs child WO visual hierarchy.
function stageShortCodeForRow(row) {
  const parsed = parseMtsStageItemCode(row?.item?.item_code);
  if (parsed?.stage) return parsed.stage;
  return String(row?.process?.type_code || '').replace(/_/g, ' ').slice(0, 10) || 'WO';
}

function stageNumberForRow(row) {
  const rank = stageRankForRow(row);
  return rank >= 0 && rank < 100 ? rank + 1 : '•';
}

function sortByStkGroupStageAndWo(a, b) {
  const ga = stkGroupCodeForRow(a);
  const gb = stkGroupCodeForRow(b);
  if (ga !== gb) return String(ga).localeCompare(String(gb));

  const sa = stageRankForRow(a);
  const sb = stageRankForRow(b);
  if (sa !== sb) return sa - sb;

  return String(a.wo_number || '').localeCompare(String(b.wo_number || ''));
}

function compactReason(r) {
  const planned = plannedQty(r);
  const produced = producedQty(r);
  const remainingReady = remainingReadyQty(r);
  const blocked = Number(r.blocked_qty || 0);

  if (planned > 0 && produced >= planned) return 'Completed';
  if (remainingReady > 0) return 'Inputs available';
  if (produced > 0 && blocked > 0) return 'Ready qty logged; waiting inputs';
  if (r.readiness_status === 'READY') return 'Inputs available';

  const shortages = r.input_shortages || [];
  if (!shortages.length) return r.block_reason || '—';

  return `Missing: ${shortages.slice(0, 3).map(x =>
      `${x.input_item_code} ${fmt(x.display_shortage_qty ?? x.shortage_qty)} ${x.display_uom_code || x.uom_code || ''}`.trim()
    ).join(', ')}${shortages.length > 3 ? ` +${shortages.length - 3}` : ''}`;
}

function badgeClass(status) {
  if (status === 'COMPLETED') return 'badge ready';
  if (status === 'READY') return 'badge ready';
  if (status === 'PARTIAL') return 'badge partial';
  if (status === 'BLOCKED') return 'badge blocked';
  return 'badge neutral';
}

function plannedQty(row) {
  return Number(row.planned_qty || 0);
}

function producedQty(row) {
  return Math.max(0, Number(row.produced_qty || 0));
}

function cumulativeReadyQty(row) {
  return Math.max(0, Number(row.ready_to_start_qty || 0));
}

function remainingReadyQty(row) {
  const planned = plannedQty(row);
  const produced = producedQty(row);
  const cumulativeReady = cumulativeReadyQty(row);
  return Math.max(0, Math.min(planned - produced, cumulativeReady - produced));
}

function progressPctValue(row) {
  const planned = plannedQty(row);
  const produced = producedQty(row);
  if (planned <= 0) return 0;
  return Math.max(0, Math.min(100, (produced / planned) * 100));
}

function workState(row, startedMap = {}) {
  const planned = plannedQty(row);
  const produced = producedQty(row);
  const remainingReady = remainingReadyQty(row);
  const blocked = Number(row.blocked_qty || 0);

  if (planned > 0 && produced >= planned) return 'LOGGED';
  if (startedMap[row.id]) return 'IN_PROGRESS';
  if (remainingReady > 0 && !row.assigned_worker) return 'TO_ASSIGN';
  if (remainingReady > 0) return 'READY';
  if (produced > 0) return 'LOGGED';
  if (blocked > 0) return 'WAITING';
  return 'WAITING';
}

function controlStatus(row, startedMap = {}) {
  const state = workState(row, startedMap);
  const readiness = row.readiness_status || 'NOT_CHECKED';

  if (state === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (state === 'LOGGED') return 'LOGGED';
  if (readiness === 'BLOCKED') return 'BLOCKED';
  if (readiness === 'PARTIAL') return 'PARTIAL';
  if (state === 'WAITING') return 'WAITING';
  if (state === 'TO_ASSIGN' || state === 'READY' || readiness === 'READY') return 'READY';

  return 'WAITING';
}

const MANAGER_STATUS_LABELS = {
  UNASSIGNED: 'Unassigned',
  READY: 'Ready To Start',
  IN_PROGRESS: 'In Progress',
  PARTIAL: 'Partial',
  BLOCKED: 'Blocked',
  HALT: 'Halt',
  COMPLETED: 'Completed',
};

// IA Phase 2a: single manager-facing status model for Production Control.
// Display/filter only — maps existing internal states to manager labels; no backend value renamed.
// P3-PROD-WORK-READY-FILTER-1:
// Ready To Start filter must follow effective readiness/ready balance, not worker assignment.
// Earlier logic returned UNASSIGNED before READY, so READY rows with no worker disappeared from the filter.
function managerStatus(row, startedMap = {}) {
  const planned = plannedQty(row);
  const produced = producedQty(row);
  const readiness = row.readiness_status || 'NOT_CHECKED';
  const readyBalance = remainingReadyQty(row);

  if (planned > 0 && produced >= planned) return 'COMPLETED';
  if (startedMap[row.id] || produced > 0) return 'IN_PROGRESS';
  if (readiness === 'READY' || readyBalance > 0) return 'READY';
  if (readiness === 'PARTIAL') return 'PARTIAL';
  if (readiness === 'BLOCKED') return 'HALT';
  if (!row.assigned_worker) return 'UNASSIGNED';
  return 'READY';
}

function workActionLabel(row) {
  const planned = plannedQty(row);
  const produced = producedQty(row);
  const blocked = Number(row.blocked_qty || 0);

  if (planned > 0 && produced >= planned) return 'Completed';
  if (produced > 0 && blocked > 0) return 'Waiting inputs';
  return 'Ready qty logged';
}


function controlUiStatus(row, startedMap = {}) {
  const planned = plannedQty(row);
  const produced = producedQty(row);
  const readiness = row.readiness_status || 'NOT_CHECKED';
  const readyBalance = remainingReadyQty(row);
  const blocked = Number(row.blocked_qty || 0);

  if (planned > 0 && produced >= planned) return 'COMPLETED';
  if (startedMap[row.id] || produced > 0) return 'RUNNING';
  if (readiness === 'PARTIAL') return 'PARTIAL';
  if (readiness === 'READY' || readyBalance > 0) return 'READY';
  if (readiness === 'BLOCKED' && blocked > 0 && readyBalance <= 0) return 'HALT';
  if (readiness === 'BLOCKED') return 'BLOCKED';
  return 'BLOCKED';
}

function controlStatusMeta(status) {
  const map = {
    READY: { label: 'READY', className: 'pc2StatusReady', icon: 'check_circle' },
    RUNNING: { label: 'RUNNING', className: 'pc2StatusRunning', icon: 'play_circle' },
    PARTIAL: { label: 'PARTIAL', className: 'pc2StatusPartial', icon: 'radio_button_partial' },
    BLOCKED: { label: 'BLOCKED', className: 'pc2StatusBlocked', icon: 'warning' },
    COMPLETED: { label: 'COMPLETED', className: 'pc2StatusCompleted', icon: 'task_alt' },
    HALT: { label: 'HALT', className: 'pc2StatusHalt', icon: 'front_hand' },
  };

  return map[status] || map.BLOCKED;
}

// MTO vs MTS classification (read-model lot fields). UI/display only.
function isMtoRow(r) {
  return String(r?.lot_tracking_scope || '').toUpperCase() === 'STACKING_ONWARD'
    || !!r?.customer_lot_code
    || !!r?.source_sales_order_id;
}
function rowLotCode(r) {
  return r?.customer_lot_code || r?.source_sales_order?.so_number || null;
}

function rowUnit(row) {
  return row.uom?.uom_code || row.item?.uom_code || row.item?.base_uom_code || '';
}

function safePct(n) {
  return Math.max(0, Math.min(100, Number(n || 0)));
}

export default function ProductionWorkPage() {
  const router = useRouter();
  const { role } = useAuth();
  const canSeeProductionControl = PRODUCTION_CONTROL_ROLES.has(role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [readiness, setReadiness] = useState('ALL');
  const [process, setProcess] = useState('ALL');
  const [workerFilter, setWorkerFilter] = useState('ALL');
  const [shiftFilter, setShiftFilter] = useState('ALL');
  const [workDate, setWorkDate] = useState('');
  const [workTab, setWorkTab] = useState('ALL');
  const [controlStatusFilter, setControlStatusFilter] = useState('ALL');
  const [lotView, setLotView] = useState('ALL');
  const [viewMode, setViewMode] = useState('shop');
  const [searchText, setSearchText] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [controlDetailId, setControlDetailId] = useState(null);
  const [controlDetailTab, setControlDetailTab] = useState('overview');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [pickers, setPickers] = useState({ workers: [], shifts: [], machines: [] });
  const [assigningId, setAssigningId] = useState(null);
  const [assignForm, setAssignForm] = useState({
    worker_id: '',
    shift_id: '',
    machine_id: '',
    planned_start_at: '',
  });

  const [started, setStarted] = useState({});
  const [startingId, setStartingId] = useState(null);
  const [completeId, setCompleteId] = useState(null);
  const [savingLogId, setSavingLogId] = useState(null);
  const [completeForm, setCompleteForm] = useState({
    good_qty: '',
    scrap_qty: '0',
    lot_no: '',
    delay_reason: '',
    notes: '',
  });

  async function loadPickers() {
    const res = await api.get('/api/v1/production-work/pickers');
    if (!res.error) setPickers(res.data || { workers: [], shifts: [], machines: [] });
  }

  function validMachinesForRow(row) {
    return Array.isArray(row.valid_machines) ? row.valid_machines : [];
  }

  async function openAssign(row) {
    const day = pickers.shifts.find(sh => sh.shift_code === 'DAY');

    let validMachines = validMachinesForRow(row);
    let validMachineError = row.valid_machine_error || null;

    try {
      const res = await api.get(`/api/v1/production-work/${row.id}/valid-machines`);

      if (res.error) {
        validMachines = [];
        validMachineError = res.error.message || 'Failed to load valid machines.';
      } else {
        validMachines = res?.data?.machines || [];
        validMachineError = null;
      }
    } catch (error) {
      validMachines = [];
      validMachineError = error.message || 'Failed to load valid machines.';
    }

    setRows(prev => prev.map(item => item.id === row.id
      ? {
          ...item,
          valid_machines: validMachines,
          valid_machine_count: validMachines.length,
          valid_machine_error: validMachineError,
        }
      : item
    ));

    const assignedMachineStillValid = validMachines.some(m => m.id === row.assigned_machine_id);

    setAssigningId(row.id);
    setAssignForm({
      worker_id: row.assigned_worker_id || pickers.workers[0]?.id || '',
      shift_id: row.assigned_shift_id || day?.id || pickers.shifts[0]?.id || '',
      machine_id: assignedMachineStillValid
        ? row.assigned_machine_id
        : validMachines.length === 1
          ? validMachines[0].id
          : '',
      planned_start_at: row.planned_start_at ? row.planned_start_at.slice(0, 16) : new Date().toISOString().slice(0, 16),
    });
  }

  async function assignWO(row) {
    /* P3H-ASSIGN-NULL */
    const assignPayload = { ...assignForm, machine_id: assignForm.machine_id ? assignForm.machine_id : null };
    const res = await api.post(`/api/v1/production-work/${row.id}/assign`, assignPayload);

    if (res.error) {
      alert(res.error.message || 'Failed to assign Work Order.');
      return;
    }

    alert('Work Order assigned.');
    setAssigningId(null);
    await load();
  }

  function startWork(row) {
    if (startingId || started[row.id]) return;
    setStartingId(row.id);
    setStarted(prev => ({ ...prev, [row.id]: new Date().toISOString() }));
    setStartingId(null);
  }

  function openComplete(row) {
    setCompleteId(row.id);
    setCompleteForm({
      good_qty: '',
      scrap_qty: '0',
      lot_no: '',
      delay_reason: '',
      notes: '',
    });
  }

  async function submitProductionLog(row) {
    if (savingLogId) return;

    if (!row.assigned_shift_id) {
      alert('Assign shift before logging production.');
      return;
    }

    const goodQty = Number(completeForm.good_qty || 0);
    const scrapQty = Number(completeForm.scrap_qty || 0);
    const remainingReady = remainingReadyQty(row);

    if (goodQty <= 0) {
      alert('Good output qty daalo.');
      return;
    }

    if (goodQty + scrapQty > remainingReady) {
      alert(`Ready balance se zyada log nahi kar sakte. Remaining ready qty: ${fmt(remainingReady)}`);
      return;
    }

    const actualStartAt = started[row.id] || null;
    const actualEndAt = new Date().toISOString();
    const expectedMinutes = Number(row.estimated_minutes || 0);
    const expectedMinutesForSave = Number.isFinite(expectedMinutes) && expectedMinutes > 0 ? expectedMinutes : null;

    let actualMinutes = null;
    let delayMinutes = null;
    let delayToleranceMinutes = expectedMinutesForSave != null
      ? Math.max(5, Math.round((expectedMinutesForSave * 0.10) * 100) / 100)
      : 5;

    if (actualStartAt && expectedMinutesForSave != null) {
      const startMs = new Date(actualStartAt).getTime();
      const endMs = new Date(actualEndAt).getTime();

      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
        actualMinutes = Math.round(((endMs - startMs) / 60000) * 100) / 100;
        delayMinutes = Math.max(0, Math.round((actualMinutes - expectedMinutesForSave) * 100) / 100);
      }
    }

    if (delayMinutes != null && delayMinutes > delayToleranceMinutes && !String(completeForm.delay_reason || '').trim()) {
      alert(`Delay reason required. Expected ${fmt(expectedMinutesForSave)} min, actual ${fmt(actualMinutes)} min, delay ${fmt(delayMinutes)} min.`);
      return;
    }

    setSavingLogId(row.id);

    try {
      const stepsRes = await api.get('/api/v1/production-logs/steps', { wo_id: row.id });
      const firstStep = (stepsRes.data || [])[0];

      if (!firstStep?.id) {
        alert('No WO step found for production log.');
        return;
      }

      const res = await api.post('/api/v1/production-logs/master', {
      wo_id: row.id,
      step_line_id: firstStep.id,
      shift_id: row.assigned_shift_id,
      worker_id: row.assigned_worker_id || null,
      machine_id: row.assigned_machine_id || null,
      good_qty: goodQty,
      rework_qty: 0,
      scrap_qty: scrapQty,
      lot_no: completeForm.lot_no ? String(completeForm.lot_no).trim() || null : null,
      actual_start_at: actualStartAt,
      actual_end_at: actualEndAt,
      expected_minutes: expectedMinutesForSave,
      delay_reason: completeForm.delay_reason || null,
      notes: completeForm.notes || null,
    });

      if (res.error) {
        alert(res.error.message || 'Failed to submit production log.');
        return;
      }

      setCompleteId(null);
      setCompleteForm({
      good_qty: '',
      scrap_qty: '0',
      lot_no: '',
      delay_reason: '',
      notes: '',
    });
      await load();
      alert('Output log saved.');
    } finally {
      setSavingLogId(null);
    }
  }

  function fmtDateTime(v) {
    if (!v) return '—';
    return new Date(v).toLocaleString();
  }

  function progressPct(row) {
    return progressPctValue(row);
  }

  function progressColor(pct) {
    if (pct >= 100) return '#16a34a';
    if (pct >= 50) return '#f59e0b';
    return '#dc2626';
  }

  function remainingReadyQtyLocal(row) {
    return remainingReadyQty(row);
  }

  async function load() {
    setLoading(true);
    const res = await api.get('/api/v1/production-work', { readiness, process });

    if (res.error) {
      alert(res.error.message || 'Failed to load production work');
      setRows([]);
    } else {
      setRows((res.data || []).sort(sortByStkGroupStageAndWo));
    }

    setLoading(false);
  }

  useEffect(() => {
    loadPickers();
  }, []);

  useEffect(() => {
    if (!canSeeProductionControl && viewMode === 'control') {
      setViewMode('shop');
    }
  }, [canSeeProductionControl, viewMode]);

  const didDefaultViewRef = useRef(false);
  useEffect(() => {
    if (!didDefaultViewRef.current && canSeeProductionControl) {
      didDefaultViewRef.current = true;
      setViewMode('control');
    }
  }, [canSeeProductionControl]);

  useEffect(() => {
    setExpanded(null);
    load();
  }, [readiness, process]);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (workerFilter !== 'ALL' && r.assigned_worker_id !== workerFilter) return false;
      if (shiftFilter !== 'ALL' && r.assigned_shift_id !== shiftFilter) return false;

      if (workDate) {
        const rowDate = r.planned_start_at ? String(r.planned_start_at).slice(0, 10) : '';
        if (rowDate !== workDate) return false;
      }

      if (workTab !== 'ALL' && workState(r, started) !== workTab) return false;
      if (controlStatusFilter !== 'ALL' && managerStatus(r, started) !== controlStatusFilter) return false;

      const term = searchText.trim().toLowerCase();
      if (term) {
        const haystack = [
          r.wo_number,
          r.item?.item_code,
          r.item?.item_name,
          r.fg_item?.item_code,
          r.fg_item?.item_name,
          r.process?.type_code,
          r.process?.type_name,
          r.assigned_worker?.worker_code,
          r.assigned_worker?.worker_name,
          r.assigned_machine?.machine_code,
        ].filter(Boolean).join(' ').toLowerCase();

        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  }, [rows, workerFilter, shiftFilter, workDate, workTab, controlStatusFilter, searchText, started]);

  const shopRows = workerFilter === 'ALL' ? [] : visibleRows;

  const workersWithJobs = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const wid = r.assigned_worker_id;
      if (!wid) continue;
      const name = r.assigned_worker?.worker_name || pickers.workers.find(w => w.id === wid)?.worker_name || 'Worker';
      const cur = m.get(wid) || { id: wid, name, count: 0 };
      cur.count += 1;
      m.set(wid, cur);
    }
    return [...m.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [rows, pickers]);

  const summary = useMemo(() => ({
    unassigned: visibleRows.filter(r => managerStatus(r, started) === 'UNASSIGNED').length,
    ready: visibleRows.filter(r => managerStatus(r, started) === 'READY').length,
    inProgress: visibleRows.filter(r => managerStatus(r, started) === 'IN_PROGRESS').length,
    blocked: visibleRows.filter(r => managerStatus(r, started) === 'BLOCKED').length,
    completed: visibleRows.filter(r => managerStatus(r, started) === 'COMPLETED').length,
  }), [visibleRows, started]);

  const processSummary = useMemo(() => {
    const map = new Map();

    for (const r of visibleRows) {
      const code = r.process?.type_code || 'UNKNOWN';
      const name = r.process?.type_name || code;

      if (!map.has(code)) {
        map.set(code, {
          code,
          name,
          wo_count: 0,
          planned_qty: 0,
          ready_qty: 0,
          blocked_qty: 0,
          ready_count: 0,
          partial_count: 0,
          blocked_count: 0,
        });
      }

      const x = map.get(code);
      x.wo_count += 1;
      x.planned_qty += Number(r.planned_qty || 0);
      x.ready_qty += Number(remainingReadyQty(r) || 0);
      x.blocked_qty += Number(r.blocked_qty || 0);

      if (r.readiness_status === 'READY') x.ready_count += 1;
      if (r.readiness_status === 'PARTIAL') x.partial_count += 1;
      if (r.readiness_status === 'BLOCKED') x.blocked_count += 1;
    }

    return [...map.values()].sort((a, b) => {
      const ai = processOrder.indexOf(a.code);
      const bi = processOrder.indexOf(b.code);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [visibleRows]);

  const groupedControlRows = useMemo(() => {
    const map = new Map();

    for (const r of visibleRows) {
      if (lotView === 'MTO' && !isMtoRow(r)) continue;
      if (lotView === 'MTS' && isMtoRow(r)) continue;

      const parentCode = stkGroupCodeForRow(r);
      const parsedStage = parseMtsStageItemCode(r.item?.item_code);
      const fallbackName = r.fg_item?.item_name || r.item?.item_name || '';

      if (!map.has(parentCode)) {
        map.set(parentCode, {
          parent_code: parentCode,
          parent_name: fallbackName,
          rows: [],
          planned_qty: 0,
          produced_qty: 0,
          balance_qty: 0,
          blocked_qty: 0,
          is_mto: false,
          customer_lot_code: null,
          so_number: null,
        });
      }

      const group = map.get(parentCode);
      group.rows.push(r);

      if (parsedStage?.stage === 'STK' || r.item?.item_code === parentCode) {
        group.parent_name = r.item?.item_name || group.parent_name;
      }

      if (isMtoRow(r)) {
        group.is_mto = true;
        if (!group.customer_lot_code) group.customer_lot_code = r.customer_lot_code || null;
        if (!group.so_number) group.so_number = r.source_sales_order?.so_number || null;
      }

      // Parent summary should show final STK plan qty once, not sum every stage qty.
      group.planned_qty = Math.max(group.planned_qty, Number(plannedQty(r) || 0));
      group.produced_qty = Math.max(group.produced_qty, Number(producedQty(r) || 0));
      group.balance_qty = Math.max(group.balance_qty, Number(remainingReadyQty(r) || 0));
      group.blocked_qty += Number(r.blocked_qty || 0);
    }

    for (const g of map.values()) {
      g.rows.sort(sortByStkGroupStageAndWo);
    }

    return [...map.values()].sort((a, b) => String(a.parent_code).localeCompare(String(b.parent_code)));
  }, [visibleRows, started, lotView]);

  const controlDetailRow = useMemo(() => rows.find(r => r.id === controlDetailId) || null, [rows, controlDetailId]);
  const completeRow = useMemo(() => rows.find(r => r.id === completeId) || null, [rows, completeId]);

  function openControlDetail(row, tab = 'overview') {
    setControlDetailId(row.id);
    setControlDetailTab(tab);
  }

  function closeControlDetail() {
    setControlDetailId(null);
  }

  function toggleControlGroup(parentCode) {
    setCollapsedGroups(prev => ({ ...prev, [parentCode]: !prev[parentCode] }));
  }

  const controlTotals = useMemo(() => {
    const total = visibleRows.length;
    const produced = visibleRows.reduce((sum, r) => sum + producedQty(r), 0);
    const planned = visibleRows.reduce((sum, r) => sum + plannedQty(r), 0);
    const throughput = planned > 0 ? (produced / planned) * 100 : 0;
    const blocked = visibleRows.filter(r => ['BLOCKED', 'HALT'].includes(controlUiStatus(r, started))).length;
    return { total, produced, planned, throughput: safePct(throughput), blocked };
  }, [visibleRows, started]);

  const showDetails = true;

  return (
    <main className={`page stitchPage cd-root ${viewMode === 'control' ? 'pc2ControlPage' : ''}`}>
      <div className="stitchTopBar">
        <div>
          <b>{viewMode === 'shop' ? 'SHOP FLOOR — Worker' : 'PRODUCTION CONTROL — Manager'}</b>
          <small>{workerFilter === 'ALL' ? 'Select operator' : pickers.workers.find(w => w.id === workerFilter)?.worker_name || 'Selected Operator'}</small>
        </div>

        {canSeeProductionControl && (
          <div className="stitchModeSwitch">
            <button className={viewMode === 'shop' ? 'active' : ''} onClick={() => setViewMode('shop')}>
              Shop Floor
            </button>
            <button className={viewMode === 'control' ? 'active' : ''} onClick={() => setViewMode('control')}>
              Control
            </button>
          </div>
        )}
      </div>

      {viewMode === 'shop' && (
        <>
          <section className="stitchOperators">
            <h2>Who is working?</h2>
            <div className="operatorChips">
              {workersWithJobs.length === 0 ? (
                <div className="empty">No work assigned right now. Ask supervisor.</div>
              ) : (
                workersWithJobs.map(w => (
                  <button key={w.id} className={workerFilter === w.id ? 'active' : ''} onClick={() => setWorkerFilter(w.id)}>
                    {workerFilter === w.id && <span>✓</span>}
                    {w.name} — {w.count} {w.count === 1 ? 'job' : 'jobs'}
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="stitchHeader">
            <div>
              <h2>{workerFilter === 'ALL' ? 'Assigned Work Orders' : `${pickers.workers.find(w => w.id === workerFilter)?.worker_name || 'Selected Operator'} Assigned Work Orders`}</h2>
              <p>Manage production schedule and log output.</p>
            </div>
            <div className="stitchOrderCount">
              <b>{shopRows.length}</b>
              <span>orders</span>
            </div>
          </section>

          {workerFilter !== 'ALL' && (
            <section className="stitchSummary">
              <div><small>Assigned WOs</small><b>{shopRows.length}</b></div>
              <div><small>In Progress</small><b>{shopRows.filter(r => started[r.id]).length}</b></div>
              <div><small>Waiting Inputs</small><b>{shopRows.filter(r => workState(r, started) === 'WAITING').length}</b></div>
            </section>
          )}


          {workersWithJobs.length > 0 && (
            <>
          <section className="stitchTabs">
            {workTabs.map(([key, label]) => (
              <button key={key} className={workTab === key ? 'active' : ''} onClick={() => setWorkTab(key)}>
                {label}
              </button>
            ))}
          </section>

              <section className="stitchTaskArea">
            {loading ? (
              <div className="empty">Loading...</div>
            ) : workersWithJobs.length === 0 ? (
              <div className="empty">No work assigned right now. Ask supervisor.</div>
            ) : workerFilter === 'ALL' ? (
              <div className="empty">Select your name to see your work.</div>
            ) : !shopRows.length ? (
              <div className="empty">No work assigned right now. Ask supervisor.</div>
            ) : (
              <div className="stitchTaskList">
                {shopRows.map(r => (
                  <div className={`stitchTask ${workState(r, started).toLowerCase()}`} key={r.id}>
                    <div className="taskRail" />

                    <div className="taskInfo">
                      <div className="taskCodeRow">
                        <button onClick={() => router.push(`/work-orders/${r.id}`)} className="linkBtn">{r.wo_number}</button>
                        <span>{r.item?.item_code || '—'}</span>
                      </div>
                      <h3>{r.item?.item_name || r.item?.item_code || 'Work Order'}</h3>
                      <div className="taskMeta">
                        <span><b>Process</b>{r.process?.type_name || r.process?.type_code || '—'}</span>
                        <span><b>Machine</b>{r.assigned_machine?.machine_code || '—'}</span>
                        <span><b>Shift</b>{r.assigned_shift?.shift_code || '—'}</span>
                      </div>
                    </div>

                    <div className="taskMetrics">
                      <div className="taskQty">
                        <div><small>Planned</small><b>{fmt(plannedQty(r))}</b></div>
                        <div><small>Produced</small><b>{fmt(producedQty(r))}</b></div>
                        <div className="balance"><small>Balance</small><b>{fmt(remainingReadyQty(r))}</b></div>
                      </div>
                      <div className="progressMini">
                        <div style={{ width: `${progressPct(r)}%`, background: progressColor(progressPct(r)) }} />
                      </div>
                      <div className="taskStatus">
                        <span className={badgeClass(r.readiness_status)}>{workState(r, started).replace('_', ' ')}</span>
                        <small>{Math.round(progressPct(r))}% complete</small>
                      </div>
                    </div>

                    <div className="taskActionBox">
                      {remainingReadyQty(r) <= 0 ? (
                        <span className="mutedText">{workActionLabel(r)}</span>
                      ) : !r.assigned_worker ? (
                        <span className="mutedText">Awaiting assignment</span>
                      ) : completeId === r.id ? (
                        <span className="mutedText">Logging...</span>
                      ) : started[r.id] ? (
                        <button className="stitchAction" onClick={() => openComplete(r)}>Log Output</button>
                      ) : (
                        <button className="stitchAction" disabled={startingId === r.id || !!started[r.id]} onClick={() => startWork(r)}>{startingId === r.id ? 'Starting…' : 'Start Work'}</button>
                      )}
                      {started[r.id] && remainingReadyQty(r) > 0 && <small>Started: {fmtDateTime(started[r.id])}</small>}
                    </div>

                    {completeId === r.id && (
                      <>
                        <div className="drawerBackdrop" onClick={() => setCompleteId(null)} />
                        <aside className="logDrawer">
                          <div className="drawerHead">
                            <div>
                              <h2>Log Output</h2>
                              <b>{r.wo_number}</b>
                              <small>{r.item?.item_code || '—'} · {r.process?.type_name || r.process?.type_code || '—'} / {r.assigned_machine?.machine_code || '—'}</small>
                            </div>
                            <div className="drawerHeadRight">
                              <span className="balanceBadge">Balance Qty: {fmt(remainingReadyQty(r))}</span>
                              <button className="smallBtn" onClick={() => setCompleteId(null)}>Close</button>
                            </div>
                          </div>

                          <div className="drawerBody">
                            <label>
                              Good Qty
                              <input type="number" min="0" step="0.01" value={completeForm.good_qty} onChange={e => setCompleteForm({ ...completeForm, good_qty: e.target.value })} />
                              <small>Cannot exceed balance qty.</small>
                            </label>
                            <label>
                              Scrap / Waste Qty
                              <input type="number" min="0" step="0.01" value={completeForm.scrap_qty} onChange={e => setCompleteForm({ ...completeForm, scrap_qty: e.target.value })} />
                            </label>
                            <label>
                              Lot / Batch No
                              <input value={completeForm.lot_no} onChange={e => setCompleteForm({ ...completeForm, lot_no: e.target.value })} placeholder="Optional" />
                            </label>
                            <label>
                              Delay Reason / Reason Code
                              <input value={completeForm.delay_reason} onChange={e => setCompleteForm({ ...completeForm, delay_reason: e.target.value })} placeholder="Required if delayed beyond tolerance" />
                            </label>
                            <label>
                              Note
                              <input value={completeForm.notes} onChange={e => setCompleteForm({ ...completeForm, notes: e.target.value })} placeholder="Optional" />
                            </label>
                          </div>

                          <div className="drawerFoot">
                            <button className="stitchAction full" disabled={savingLogId === r.id} onClick={() => submitProductionLog(r)}>
                              {savingLogId === r.id ? <><span className="spinner" /> Saving Output...</> : 'Save Output Log'}
                            </button>
                            <button className="smallBtn" onClick={() => setCompleteId(null)}>Cancel</button>
                          </div>
                        </aside>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
            </>
          )}
        </>
      )}


      {canSeeProductionControl && viewMode === 'control' && (
        <>
          <section className="pc2KpiShell">
            <div className="pc2PageHead">
              <div>
                <h2>Production Control</h2>
                <div className="pc2HealthLine">
                  <span className="pc2HealthPill"><span /> On Schedule</span>
                  <small>Real-time WO tracking · grouped by Parent SKU</small>
                </div>
              </div>
              <div className="pc2HeadActions">
                <div className="pc2ModeSwitch" aria-label="Production work mode">
                  <button className={viewMode === 'shop' ? 'active' : ''} onClick={() => setViewMode('shop')}>Shop Floor</button>
                  <button className={viewMode === 'control' ? 'active' : ''} onClick={() => setViewMode('control')}>Control</button>
                </div>
                <button className="pc2Btn" onClick={load}>Refresh</button>
                <button className="pc2Btn" onClick={() => { setSearchText(''); setWorkDate(''); setWorkerFilter('ALL'); setShiftFilter('ALL'); setWorkTab('ALL'); setControlStatusFilter('ALL'); setProcess('ALL'); setReadiness('ALL'); }}>Clear Filters</button>
              </div>
            </div>

            <div className="pc2KpiGrid">
              <button className="pc2Kpi" onClick={() => setControlStatusFilter('ALL')}>
                <small>Throughput</small>
                <b>{Math.round(controlTotals.throughput)}%</b>
                <div className="pc2TinyProgress"><span style={{ width: `${controlTotals.throughput}%` }} /></div>
              </button>
              <button className="pc2Kpi" onClick={() => setControlStatusFilter('ALL')}>
                <small>Work Orders</small>
                <b>{controlTotals.total}</b>
                <em>{groupedControlRows.length} parent groups</em>
              </button>
              <button className="pc2Kpi" onClick={() => setControlStatusFilter('IN_PROGRESS')}>
                <small>Running</small>
                <b>{visibleRows.filter(r => controlUiStatus(r, started) === 'RUNNING').length}</b>
                <em>Active shop floor</em>
              </button>
              <button className="pc2Kpi pc2KpiDanger" onClick={() => setControlStatusFilter('BLOCKED')}>
                <small>Bottlenecks</small>
                <b>{controlTotals.blocked}</b>
                <em>Needs action</em>
              </button>
              <button className="pc2Kpi" onClick={() => setControlStatusFilter('COMPLETED')}>
                <small>Completed</small>
                <b>{visibleRows.filter(r => controlUiStatus(r, started) === 'COMPLETED').length}</b>
                <em>Finished WOs</em>
              </button>
            </div>
          </section>

          <section className="pc2Filters">
            <div className="pc2SearchBox">
              <span>⌕</span>
              <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search WO, Parent SKU, Stage SKU, worker, machine" />
            </div>

            <select value={process} onChange={e => setProcess(e.target.value)}>
              {processFilters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>

            <select value={controlStatusFilter} onChange={e => setControlStatusFilter(e.target.value)}>
              {controlStatusFilters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>

            <select value={workerFilter} onChange={e => setWorkerFilter(e.target.value)}>
              <option value="ALL">All Workers</option>
              {pickers.workers.map(w => <option key={w.id} value={w.id}>{w.worker_code} — {w.worker_name}</option>)}
            </select>

            <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)}>
              <option value="ALL">All Shifts</option>
              {pickers.shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.shift_code} — {sh.shift_name}</option>)}
            </select>
          </section>

          <div className="pc2LotTabs">
            {[['ALL', 'All'], ['MTO', 'MTO / Customer Lot'], ['MTS', 'MTS / Common Stock']].map(([key, label]) => (
              <button
                key={key}
                className={lotView === key ? 'active' : ''}
                onClick={() => setLotView(key)}
              >{label}</button>
            ))}
          </div>

          <section className="pc2TableCard">
            <div className="pc2TableTop">
              <div>
                <h3>Production Work Orders</h3>
                <small>Parent rows show overall PPO health. Child rows show each stage WO.</small>
              </div>
              <span className="pc2Count">Showing {visibleRows.length} WOs</span>
            </div>

            {loading ? (
              <div className="pc2State">Loading production work orders...</div>
            ) : !groupedControlRows.length ? (
              <div className="pc2State">No released work orders found for current filters.</div>
            ) : (
              <div className="pc2TableWrap">
                <table className="pc2Table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Work Order / SKU</th>
                      <th>Process Stage</th>
                      <th>Worker / Machine</th>
                      <th>Planned / Output</th>
                      <th>Progress</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedControlRows.map(group => {
                      const groupPct = group.planned_qty > 0 ? safePct((group.produced_qty / group.planned_qty) * 100) : 0;
                      const groupStatus = group.blocked_qty > 0 ? 'BLOCKED' : groupPct >= 100 ? 'COMPLETED' : 'RUNNING';
                      const groupMeta = controlStatusMeta(groupStatus);
                      const completeStages = group.rows.filter(r => controlUiStatus(r, started) === 'COMPLETED').length;
                      const readyStages = group.rows.filter(r => controlUiStatus(r, started) === 'READY').length;
                      const waitingStages = group.rows.filter(r => ['BLOCKED', 'HALT', 'PARTIAL'].includes(controlUiStatus(r, started))).length;
                      const collapsed = collapsedGroups[group.parent_code];

                      return (
                        <Fragment key={group.parent_code}>
                          <tr className={`pc2GroupRow pc2StkParentRow ${group.blocked_qty > 0 ? 'pc2GroupAttention' : ''}`} onClick={() => toggleControlGroup(group.parent_code)}>
                            <td><span className={`pc2Chevron ${collapsed ? 'closed' : ''}`}>⌄</span></td>
                            <td>
                              <div className="pc2SkuCell">
                                <div className="pc2SkuIcon">⌘</div>
                                <div>
                                  <b>{group.parent_code}{group.is_mto && group.customer_lot_code ? ` — ${group.customer_lot_code}` : ''}</b>
                                  <small>
                                    {group.is_mto ? (
                                      <span style={{ display: 'inline-block', background: '#eef4ff', color: '#004ac6', border: '1px solid #bfd0ff', borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 900, marginRight: 6 }}>MTO</span>
                                    ) : (
                                      <span style={{ display: 'inline-block', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 900, marginRight: 6 }}>MTS</span>
                                    )}
                                    {group.is_mto ? `Customer lot: ${group.customer_lot_code || group.so_number || '—'}` : 'Common Stock'} · {group.rows.length} stages
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="pc2ParentStageCell">
                                <span className="pc2ParentPill">STK Chain</span>
                                <div>
                                  <b>Stage Chain Summary</b>
                                  <small>{completeStages}/{group.rows.length} done · {readyStages} ready · {waitingStages} waiting</small>
                                </div>
                              </div>
                            </td>
                            <td><b>—</b><small>Grouped view</small></td>
                            <td className="pc2Mono"><b>{fmt(group.planned_qty)}</b><small>{fmt(group.produced_qty)} produced</small></td>
                            <td>
                              <div className="pc2ProgressLine"><span style={{ width: `${groupPct}%` }} /></div>
                              <small className="pc2Pct">{Math.round(groupPct)}%</small>
                            </td>
                            <td><span className={`pc2Status ${groupMeta.className}`}>{groupMeta.label}</span></td>
                            <td><button className="pc2MiniBtn" onClick={(e) => { e.stopPropagation(); toggleControlGroup(group.parent_code); }}>Details</button></td>
                          </tr>

                          {!collapsed && group.rows.map(r => {
                            const status = controlUiStatus(r, started);
                            const meta = controlStatusMeta(status);
                            const unit = rowUnit(r);
                            const pct = progressPct(r);
                            const stageNo = stageNumberForRow(r);
                            const stageCode = stageShortCodeForRow(r);
                            const shortageText = (r.input_shortages || []).slice(0, 2).map(x => `${x.input_item_code} ${fmt(x.display_shortage_qty ?? x.shortage_qty)} ${x.display_uom_code || x.uom_code || ''}`.trim()).join(' · ');

                            return (
                              <Fragment key={r.id}>
                                <tr className={`pc2ChildRow pc2StageChildRow ${['BLOCKED', 'HALT'].includes(status) ? 'pc2ChildBlocked' : ''}`}>
                                  <td className="pc2StageRailCell"><span className={`pc2StageDot ${status === 'READY' ? 'ready' : ['BLOCKED', 'HALT'].includes(status) ? 'halt' : ''}`}>{stageNo}</span></td>
                                  <td>
                                    <div className="pc2ChildSku">
                                      <div className="pc2ChildWoLine">
                                        <span className="pc2StageChip">{stageCode}</span>
                                        <button className="pc2WoLink" onClick={() => router.push(`/work-orders/${r.id}`)}>{r.wo_number}</button>
                                      </div>
                                      <b>{r.item?.item_code || '—'}</b>
                                      {isMtoRow(r) && <small style={{ color: '#004ac6', fontWeight: 800 }}>Lot: {rowLotCode(r) || '—'}</small>}
                                    </div>
                                  </td>
                                  <td>
                                    <div className="pc2StageNameCell">
                                      <b>{r.process?.type_name || r.process?.type_code || '—'}</b>
                                      <small>{r.item?.item_name || '—'}</small>
                                    </div>
                                  </td>
                                  <td>
                                    <b>{r.assigned_worker?.worker_name || 'Unassigned'}</b>
                                    <small>{r.assigned_machine?.machine_code || 'No machine'} · {r.assigned_shift?.shift_code || 'No shift'}</small>
                                  </td>
                                  <td className="pc2Mono"><b>{fmt(plannedQty(r))} {unit}</b><small>{fmt(producedQty(r))} {unit} output</small></td>
                                  <td>
                                    <div className="pc2ProgressLine"><span style={{ width: `${pct}%` }} /></div>
                                    <small className="pc2Pct">{Math.round(pct)}% · Bal {fmt(remainingReadyQty(r))} {unit}</small>
                                  </td>
                                  <td>
                                    <span className={`pc2Status ${meta.className}`}>{meta.label}</span>
                                    <small className="pc2Reason">{shortageText || compactReason(r)}</small>
                                  </td>
                                  <td>
                                    <div className="pc2Actions">
                                      <button onClick={() => openControlDetail(r)}>View</button>
                                      <button onClick={() => openAssign(r)}>{r.assigned_worker ? 'Reassign' : 'Assign'}</button>
                                      {status === 'READY' || status === 'PARTIAL' ? <button onClick={() => startWork(r)}>Start</button> : null}
                                      {status === 'RUNNING' ? <button onClick={() => openComplete(r)}>Log Output</button> : null}
                                      {['BLOCKED', 'HALT'].includes(status) ? <button className="danger" onClick={() => openControlDetail(r, 'materials')}>Shortage</button> : null}
                                    </div>
                                  </td>
                                </tr>

                                {assigningId === r.id && (
                                  <tr className="pc2AssignRow">
                                    <td colSpan="8">
                                      <div className="stitchInlinePanel">
                                        <b>Assign Work Order</b>
                                        <div className="assignGrid">
                                          <label>Worker<select value={assignForm.worker_id} onChange={e => setAssignForm({ ...assignForm, worker_id: e.target.value })}><option value="">Select worker</option>{pickers.workers.map(w => <option key={w.id} value={w.id}>{w.worker_code} — {w.worker_name}</option>)}</select></label>
                                          <label>Shift<select value={assignForm.shift_id} onChange={e => setAssignForm({ ...assignForm, shift_id: e.target.value })}><option value="">Select shift</option>{pickers.shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.shift_code} — {sh.shift_name}</option>)}</select></label>
                                          <label>Machine<select value={assignForm.machine_id} onChange={e => setAssignForm({ ...assignForm, machine_id: e.target.value })}><option value="">{validMachinesForRow(r).length ? 'Select machine' : 'No valid machine configured'}</option>{validMachinesForRow(r).map(m => <option key={m.id} value={m.id}>{m.machine_code} — {m.machine_name}</option>)}</select>{!validMachinesForRow(r).length && <small>{r.valid_machine_error || 'Recipe machine mapping missing.'}</small>}</label>
                                          <label>Start time<input type="datetime-local" value={assignForm.planned_start_at} onChange={e => setAssignForm({ ...assignForm, planned_start_at: e.target.value })} /></label>
                                        </div>
                                        <div className="assignActions"><button className="smallBtn primary" onClick={() => assignWO(r)}>Save Assignment</button><button className="smallBtn" onClick={() => setAssigningId(null)}>Cancel</button></div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {controlDetailRow && (
            <>
              <div className="pc2DrawerOverlay" onClick={closeControlDetail} />
              <aside className="pc2Drawer">
                <div className="pc2DrawerHead">
                  <div>
                    <small>{controlDetailRow.wo_number}</small>
                    <h3>{controlDetailRow.process?.type_name || controlDetailRow.process?.type_code || 'WO Details'}</h3>
                  </div>
                  <button onClick={closeControlDetail}>×</button>
                </div>

                <div className="pc2DrawerTabs">
                  {[
                    ['overview', 'Overview'],
                    ['assignment', 'Assignment'],
                    ['progress', 'Progress'],
                    ['materials', 'Materials'],
                    ['logs', 'Production Logs'],
                    ['history', 'History'],
                  ].map(([key, label]) => (
                    <button key={key} className={controlDetailTab === key ? 'active' : ''} onClick={() => setControlDetailTab(key)}>{label}</button>
                  ))}
                </div>

                <div className="pc2DrawerBody">
                  <div className="pc2InfoGrid">
                    <div><small>WO Number</small><b>{controlDetailRow.wo_number}</b></div>
                    <div><small>Parent SKU</small><b>{controlDetailRow.fg_item?.item_code || '—'}</b></div>
                    <div><small>Stage SKU</small><b>{controlDetailRow.item?.item_code || '—'}</b></div>
                    <div><small>Process</small><b>{controlDetailRow.process?.type_name || controlDetailRow.process?.type_code || '—'}</b></div>
                    <div><small>Planned</small><b>{fmt(plannedQty(controlDetailRow))} {rowUnit(controlDetailRow)}</b></div>
                    <div><small>Produced</small><b>{fmt(producedQty(controlDetailRow))} {rowUnit(controlDetailRow)}</b></div>
                    <div><small>Balance</small><b>{fmt(remainingReadyQty(controlDetailRow))} {rowUnit(controlDetailRow)}</b></div>
                    <div><small>Status</small><b>{controlStatusMeta(controlUiStatus(controlDetailRow, started)).label}</b></div>
                    <div><small>Worker</small><b>{controlDetailRow.assigned_worker?.worker_name || 'Unassigned'}</b></div>
                    <div><small>Machine</small><b>{controlDetailRow.assigned_machine?.machine_code || 'No machine'}</b></div>
                    <div><small>Shift</small><b>{controlDetailRow.assigned_shift?.shift_code || 'No shift'}</b></div>
                    <div><small>Due / Start</small><b>{fmtDateTime(controlDetailRow.planned_start_at)}</b></div>
                  </div>

                  <div className="pc2DrawerPanel">
                    <h4>{controlDetailTab === 'materials' ? 'Shortage Reason' : 'Last Activity'}</h4>
                    {controlDetailTab === 'materials' ? (
                      (controlDetailRow.input_shortages || []).length ? (
                        <div className="shortageGrid">
                          {(controlDetailRow.input_shortages || []).map((x, idx) => (
                            <div className="shortage" key={`${controlDetailRow.id}-${idx}`}>
                              <strong>{x.input_item_code}</strong>
                              <span>Required: {fmt(x.display_required_qty ?? x.required_qty)} {x.display_uom_code || x.uom_code}</span>
                              <span>Available: {fmt(x.display_available_qty ?? x.available_qty)} {x.display_uom_code || x.uom_code}</span>
                              <span>Shortage: {fmt(x.display_shortage_qty ?? x.shortage_qty)} {x.display_uom_code || x.uom_code}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p>No input shortage. Inputs available or not required.</p>
                    ) : (
                      <p>{compactReason(controlDetailRow)} · Last activity: {fmtDateTime(controlDetailRow.updated_at || controlDetailRow.planned_start_at)}</p>
                    )}
                  </div>
                </div>

                <div className="pc2DrawerFoot">
                  <button className="primary" onClick={() => openComplete(controlDetailRow)}>Log Output</button>
                  <button onClick={() => openAssign(controlDetailRow)}>{controlDetailRow.assigned_worker ? 'Reassign Worker' : 'Assign Worker'}</button>
                  <button onClick={() => router.push(`/work-orders/${controlDetailRow.id}`)}>Open WO</button>
                </div>
              </aside>
            </>
          )}

          {completeRow && (
            <>
              <div className="pc2DrawerOverlay" onClick={() => setCompleteId(null)} />
              <aside className="pc2Drawer">
                <div className="pc2DrawerHead">
                  <div>
                    <small>{completeRow.wo_number}</small>
                    <h3>Log Output</h3>
                  </div>
                  <button onClick={() => setCompleteId(null)}>×</button>
                </div>

                <div className="pc2DrawerBody">
                  <div className="pc2InfoGrid">
                    <div><small>Stage</small><b>{completeRow.process?.type_name || completeRow.process?.type_code || '—'}</b></div>
                    <div><small>Machine</small><b>{completeRow.assigned_machine?.machine_code || '—'}</b></div>
                    <div><small>Planned</small><b>{fmt(plannedQty(completeRow))} {rowUnit(completeRow)}</b></div>
                    <div><small>Balance</small><b>{fmt(remainingReadyQty(completeRow))} {rowUnit(completeRow)}</b></div>
                  </div>

                  <div className="pc2DrawerPanel">
                    <h4>Output Entry</h4>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800, color: '#334155' }}>Good Qty
                        <input type="number" min="0" step="0.01" value={completeForm.good_qty} onChange={e => setCompleteForm({ ...completeForm, good_qty: e.target.value })} style={{ minHeight: 38, border: '1px solid #e2e8f0', borderRadius: 10, padding: '0 10px', fontWeight: 600 }} />
                      </label>
                      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800, color: '#334155' }}>Scrap / Waste Qty
                        <input type="number" min="0" step="0.01" value={completeForm.scrap_qty} onChange={e => setCompleteForm({ ...completeForm, scrap_qty: e.target.value })} style={{ minHeight: 38, border: '1px solid #e2e8f0', borderRadius: 10, padding: '0 10px', fontWeight: 600 }} />
                      </label>
                      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800, color: '#334155' }}>Lot / Batch No
                        <input value={completeForm.lot_no} onChange={e => setCompleteForm({ ...completeForm, lot_no: e.target.value })} placeholder="Optional" style={{ minHeight: 38, border: '1px solid #e2e8f0', borderRadius: 10, padding: '0 10px' }} />
                      </label>
                      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800, color: '#334155' }}>Delay Reason
                        <input value={completeForm.delay_reason} onChange={e => setCompleteForm({ ...completeForm, delay_reason: e.target.value })} placeholder="Required if delayed" style={{ minHeight: 38, border: '1px solid #e2e8f0', borderRadius: 10, padding: '0 10px' }} />
                      </label>
                      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800, color: '#334155' }}>Note
                        <input value={completeForm.notes} onChange={e => setCompleteForm({ ...completeForm, notes: e.target.value })} placeholder="Optional" style={{ minHeight: 38, border: '1px solid #e2e8f0', borderRadius: 10, padding: '0 10px' }} />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="pc2DrawerFoot" style={{ gridTemplateColumns: '2fr 1fr' }}>
                  <button className="primary" disabled={savingLogId === completeRow.id} onClick={() => submitProductionLog(completeRow)}>
                    {savingLogId === completeRow.id ? 'Saving…' : 'Save Output Log'}
                  </button>
                  <button onClick={() => setCompleteId(null)}>Cancel</button>
                </div>
              </aside>
            </>
          )}
        </>
      )}

      <style jsx>{`
        .page{padding:24px;background:#f7f9fc;min-height:100vh;color:#0f172a}
        h1{margin:0;font-size:30px;font-weight:950}
        .sub{margin:6px 0 18px;color:#64748b}
        .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
        .kpi{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:6px}
        .kpi b{font-size:24px}.green{background:#ecfdf5;color:#166534}.yellow{background:#fffbeb;color:#92400e}.red{background:#fef2f2;color:#991b1b}
        .filters,.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;margin-bottom:16px}
        .modeTabs{display:flex;gap:10px;margin:0 0 16px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:8px}
        .modeTabs button{flex:1;border-radius:12px;padding:11px;font-size:14px}
        .chips{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px}
        .filterGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;align-items:end;margin-top:10px}
        .workCardGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
        .workCard{background:#fff;border:1px solid #dbeafe;border-radius:16px;padding:14px;box-shadow:0 6px 18px rgba(15,23,42,.04)}
        .workCardHead{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px}
        .linkBtn{border:none;background:transparent;color:#2563eb;font-weight:950;padding:0;border-radius:0}
        .workCardItem{margin-bottom:10px}
        .workCardMeta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}
        .workCardMeta span,.qtyGrid div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px;font-size:12px}
        .workCardMeta b,.qtyGrid small{display:block;color:#64748b;margin:0 0 4px}
        .qtyGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}
        .progressMini{height:7px;background:#fee2e2;border-radius:999px;overflow:hidden;margin-top:6px}
        .progressMini div{height:100%}
        .workActions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
        .inlinePanel{margin-top:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:12px}
        button{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:7px 11px;font-weight:800;cursor:pointer}
        button.active{background:#eff6ff;color:#004ac6;border-color:#004ac6}
        .smallBtn{font-size:12px;padding:6px 10px;white-space:nowrap}
        .cardTop{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px}
        h2{font-size:16px;margin:0 0 12px}
        .tableWrap{overflow:auto}
        table{width:100%;border-collapse:collapse;min-width:900px}
        th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #eef2f7;font-size:13px;vertical-align:top}
        th{color:#64748b;background:#f8fafc;font-size:12px}
        small{display:block;color:#64748b;margin-top:3px}
        .reason{max-width:300px;line-height:1.45}
        .badge{border-radius:999px;padding:5px 9px;font-size:11px;font-weight:900}
        .ready{background:#dcfce7;color:#166534}.partial{background:#fef3c7;color:#92400e}.blocked{background:#fee2e2;color:#991b1b}.neutral{background:#e2e8f0;color:#475569}
        .empty{text-align:center;color:#64748b;padding:22px}
        .hint{margin-top:12px;color:#64748b;font-size:13px}
        .detailCell{background:#f8fafc}
        .shortageGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:10px}
        .shortage{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:4px}
        .shortage span{font-size:12px;color:#475569}
        .assignedBox{display:flex;flex-direction:column;gap:3px;min-width:180px}
        .assignGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:10px}
        label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:900;color:#475569}
        select,input{border:1px solid #cbd5e1;border-radius:10px;padding:9px;background:#fff;color:#0f172a}
        .assignActions{display:flex;gap:8px;margin-top:12px}
        .primary{background:#004ac6;color:#fff;border-color:#004ac6}
        .mutedText{font-size:12px;color:#64748b;font-weight:800}
        .controlCard{padding:12px}
        .controlTable{min-width:980px}
        .controlTable th,.controlTable td{font-size:11px;padding:8px 10px}
        .groupRow{background:#eef4ff;color:#0f172a}
        .groupRow td{border-bottom:1px solid #c7d2fe}
        .controlChildRow:hover{background:#f8fafc}
        .skuStack{display:flex;flex-direction:column;gap:2px}
        .skuStack b{font-size:12px}
        .miniLink{display:block;border:none;background:transparent;color:#64748b;padding:2px 0;font-size:10px;border-radius:0}
        .controlBlockedRow td{background:#fef2f2}
        .controlBlockedRow td:first-child{box-shadow:inset 4px 0 0 #dc2626}
        .faceShortage{display:block;color:#991b1b;font-weight:700;margin-top:4px}
        .fixPpoBtn{display:inline-block;margin-top:6px;border:1px solid #dc2626;background:#fee2e2;color:#991b1b;font-weight:800;font-size:11px;padding:5px 9px;border-radius:8px;cursor:pointer}
        .controlProgress{min-width:120px}
        .progressLine{display:flex;justify-content:space-between;gap:8px;align-items:center}
        .progressLine small{margin:0}
        .dangerText{color:#991b1b;font-weight:900}
        .controlDetailGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:12px}
        .controlDetailGrid>div{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px}
        .stitchPage{background:#f8fafc}
        .stitchTopBar{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);border:1px solid #e2e8f0;border-radius:14px;padding:7px 10px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:10px}
        .stitchTopBar b{font-size:19px;color:#004ac6}
        .stitchTopBar small{display:block;margin-top:2px;color:#64748b}
        .stitchTopBar nav{display:flex;gap:22px;align-items:center}
        .stitchTopBar nav button{border:none;background:transparent;border-radius:0;color:#64748b;padding:8px 0;font-size:13px}
        .stitchTopBar nav button.active{background:transparent;border-bottom:4px solid #004ac6;color:#004ac6}
        .stitchModeSwitch{display:flex;gap:6px;background:#f1f5ff;border:1px solid #dbeafe;border-radius:999px;padding:4px}
        .stitchModeSwitch button{border:none;background:transparent;padding:7px 12px}
        .stitchModeSwitch button.active{background:#004ac6;color:#fff}
        .stitchOperators{margin:4px 0 6px}
        .stitchOperators h2{font-size:11px;color:#64748b;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em}
        .operatorChips{display:flex;gap:8px;flex-wrap:wrap}
        .operatorChips button{padding:7px 12px;border-radius:999px;background:#fff;border:1px solid #cbd5e1;font-size:12px}
        .operatorChips button.active{background:#004ac6;color:#fff;border-color:#004ac6;box-shadow:0 14px 26px rgba(0,74,198,.2)}
        .stitchHeader{display:none}
        .stitchHeader h2{font-size:24px;margin:0;color:#0f172a;font-weight:750}
        .stitchHeader p{margin:4px 0 0;color:#64748b;font-size:14px}
        .stitchOrderCount{background:#f1f5ff;border:1px solid #c7d2fe;border-radius:16px;padding:10px 16px;text-align:center;color:#004ac6;min-width:92px}
        .stitchOrderCount b{display:block;font-size:22px}
        .stitchOrderCount span{font-size:11px;text-transform:uppercase;font-weight:900}
        .stitchSummary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:8px}
        .stitchSummary>div{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:8px 10px}
        .stitchSummary small{margin:0;color:#64748b;text-transform:uppercase;font-size:10px;font-weight:900;letter-spacing:.08em}
        .stitchSummary b{font-size:18px;color:#0f172a;display:block;margin-top:3px}
        .stitchFilters{display:grid;grid-template-columns:2fr 1fr 1.5fr auto;gap:8px;margin-bottom:6px}
        .stitchFilters input,.stitchFilters select{height:34px;border-radius:10px}
        .stitchFilters button{height:34px;padding:5px 10px;font-size:12px}
        .stitchTabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
        .stitchTabs.lowerTabs{display:none}
        .stitchTaskArea{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:8px}
        .stitchTaskList{display:grid;gap:8px}
        .stitchTask{position:relative;overflow:hidden;background:#fff;border:1px solid #dbeafe;border-radius:16px;padding:10px 14px 10px 20px;box-shadow:0 5px 14px rgba(15,23,42,.04);display:grid;grid-template-columns:minmax(280px,1.35fr) minmax(280px,1fr) minmax(140px,.55fr);gap:12px;align-items:center}
        .stitchTask.ready{background:#ecfdf5}
        .taskRail{position:absolute;left:0;top:0;bottom:0;width:7px;background:#cbd5e1}
        .stitchTask.ready .taskRail{background:#004ac6}.stitchTask.in_progress .taskRail{background:#16a34a}.stitchTask.waiting .taskRail,.stitchTask.to_assign .taskRail{background:#ba1a1a}.stitchTask.logged .taskRail{background:#64748b}
        .taskCodeRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
        .taskCodeRow span{font-size:11px;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:4px 8px;font-weight:950}
        .taskInfo h3{font-size:15px;margin:0 0 6px;color:#0f172a}
        .taskMeta{display:flex;gap:8px;flex-wrap:wrap}
        .taskMeta span,.taskQty div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:6px 8px;font-size:10px}
        .taskMeta b,.taskQty small{display:block;color:#64748b;margin:0 0 4px;font-weight:900}
        .taskQty{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
        .taskQty b{font-size:14px;color:#0f172a}.taskQty .balance{background:#eff6ff;border-color:#bfdbfe}.taskQty .balance b,.taskQty .balance small{color:#004ac6}
        .taskStatus{display:flex;justify-content:space-between;align-items:center;margin-top:8px}
        .taskActionBox{display:flex;flex-direction:column;align-items:flex-end;gap:10px}
        .stitchAction{background:#004ac6;color:#fff;border-color:#004ac6;border-radius:11px;min-height:36px;padding:7px 16px;font-size:12px;font-weight:950;box-shadow:0 8px 16px rgba(0,74,198,.14)}
        .stitchAction.secondary{background:#fff;color:#004ac6}.stitchAction.full{width:100%}
        .stitchInlinePanel{grid-column:1/-1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:14px}
        .drawerBackdrop{position:fixed;inset:0;background:rgba(15,23,42,.38);backdrop-filter:blur(3px);z-index:80}
        .logDrawer{position:fixed;top:0;right:0;bottom:0;width:min(420px,100vw);background:#f9f9ff;z-index:90;box-shadow:-18px 0 40px rgba(15,23,42,.18);display:flex;flex-direction:column;border-left:1px solid #e2e8f0;border-radius:28px 0 0 28px;overflow:hidden}
        .drawerHead{padding:22px;border-bottom:1px solid #d7e2ff;display:flex;justify-content:space-between;gap:12px;background:#f1f3ff}
        .drawerHeadRight{display:flex;align-items:flex-start;gap:10px}
        .balanceBadge{background:#dbeafe;color:#004ac6;border-radius:10px;padding:8px 10px;font-size:13px;font-weight:950;white-space:nowrap}
        .drawerHead h2{margin:0 0 18px;font-size:20px}
        .drawerBody{padding:22px;display:grid;gap:18px;overflow:auto;flex:1}
        .drawerBody input{min-height:52px;border-radius:14px}
        .drawerFoot{padding:22px;border-top:1px solid #d7e2ff;display:grid;gap:12px;background:#fff}
        .stitchAction:disabled{opacity:.75;cursor:not-allowed}

        .cd-root{
          --cd-primary:#2563eb;
          --cd-primary-hover:#1d4fd7;
          --cd-on-primary:#ffffff;
          --cd-primary-soft:#dce6fb;
          --cd-bg:#f6f8fd;
          --cd-surface:#ffffff;
          --cd-surface-2:#f1f4fb;
          --cd-surface-3:#eaf0fe;
          --cd-text:#0f1b2d;
          --cd-text-muted:#5a6172;
          --cd-text-faint:#8a90a0;
          --cd-border:#dde2ee;
          --cd-border-strong:#c6ccdb;
          --cd-success:#15803d;
          --cd-success-soft:#dcfce7;
          --cd-success-text:#166534;
          --cd-warning-soft:#ffeccc;
          --cd-warning-text:#6b4a00;
          --cd-danger-soft:#fee2e2;
          --cd-danger-text:#b91c1c;
          --cd-radius:10px;
          --cd-radius-lg:16px;
          --cd-radius-pill:999px;
          --cd-shadow-sm:0 1px 2px rgba(15,27,45,.06);
          --cd-shadow:0 4px 12px rgba(15,27,45,.08);
          --cd-shadow-lg:0 10px 28px rgba(15,27,45,.12);
          --cd-focus:0 0 0 3px rgba(37,99,235,.30);
          background:var(--cd-bg);
          color:var(--cd-text);
          font-family:var(--font-inter),Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        .cd-root *{box-sizing:border-box}
        .cd-root .stitchTopBar{
          background:rgba(255,255,255,.94);
          border:1px solid var(--cd-border);
          border-radius:var(--cd-radius-lg);
          box-shadow:var(--cd-shadow-sm);
          padding:10px 14px;
        }
        .cd-root .stitchTopBar b{color:var(--cd-text);font-size:20px;font-weight:800}
        .cd-root .stitchTopBar small{color:var(--cd-text-muted)}
        .cd-root .stitchModeSwitch{
          background:var(--cd-surface-2);
          border:1px solid var(--cd-border);
          border-radius:var(--cd-radius-pill);
          padding:3px;
        }
        .cd-root .stitchModeSwitch button{
          border:none;
          border-radius:var(--cd-radius-pill);
          background:transparent;
          color:var(--cd-text-muted);
          font-size:12px;
          font-weight:800;
          height:32px;
          padding:0 14px;
        }
        .cd-root .stitchModeSwitch button.active{
          background:var(--cd-primary);
          color:var(--cd-on-primary);
          box-shadow:var(--cd-shadow-sm);
        }
        .cd-root .stitchOperators h2{
          color:var(--cd-text-faint);
          font-size:10px;
          font-weight:800;
          letter-spacing:.06em;
        }
        .cd-root .operatorChips button{
          background:var(--cd-primary-soft);
          color:#2f55c0;
          border:1px solid transparent;
          border-radius:var(--cd-radius-pill);
          padding:8px 16px;
          font-size:13px;
          font-weight:700;
        }
        .cd-root .operatorChips button.active{
          background:var(--cd-primary);
          color:var(--cd-on-primary);
          box-shadow:var(--cd-shadow-sm);
        }
        .cd-root .stitchSummary>div{
          background:var(--cd-surface);
          border:1px solid var(--cd-border);
          border-radius:var(--cd-radius-lg);
          box-shadow:var(--cd-shadow-sm);
          padding:12px 14px;
        }
        .cd-root .stitchSummary small{color:var(--cd-text-muted)}
        .cd-root .stitchSummary b{color:var(--cd-text);font-size:22px}
        .cd-root .stitchFilters{
          background:var(--cd-surface);
          border:1px solid var(--cd-border);
          border-radius:var(--cd-radius-lg);
          padding:12px;
          margin-bottom:10px;
          box-shadow:var(--cd-shadow-sm);
        }
        .cd-root .stitchFilters input,
        .cd-root .stitchFilters select,
        .cd-root .drawerBody input,
        .cd-root .drawerBody select,
        .cd-root .assignGrid input,
        .cd-root .assignGrid select{
          background:var(--cd-surface);
          border:1px solid var(--cd-border-strong);
          border-radius:var(--cd-radius);
          color:var(--cd-text);
          outline:none;
        }
        .cd-root .stitchFilters input:focus,
        .cd-root .stitchFilters select:focus,
        .cd-root .drawerBody input:focus,
        .cd-root .assignGrid input:focus,
        .cd-root .assignGrid select:focus{
          border-color:var(--cd-primary);
          box-shadow:var(--cd-focus);
        }
        .cd-root .stitchFilters button,
        .cd-root .smallBtn{
          background:var(--cd-surface);
          color:var(--cd-text-muted);
          border:1px solid var(--cd-border-strong);
          border-radius:var(--cd-radius);
          font-weight:800;
          box-shadow:var(--cd-shadow-sm);
        }
        .cd-root .smallBtn.primary{
          background:var(--cd-primary);
          border-color:var(--cd-primary);
          color:var(--cd-on-primary);
        }
        .cd-root .stitchTabs button{
          background:var(--cd-surface);
          color:var(--cd-text-muted);
          border:1px solid var(--cd-border);
          border-radius:var(--cd-radius-pill);
          height:34px;
          padding:0 14px;
          font-size:12px;
          font-weight:800;
        }
        .cd-root .stitchTabs button.active{
          background:var(--cd-primary);
          border-color:var(--cd-primary);
          color:var(--cd-on-primary);
        }
        .cd-root .stitchTaskArea{
          background:var(--cd-surface);
          border:1px solid var(--cd-border);
          border-radius:var(--cd-radius-lg);
          box-shadow:var(--cd-shadow-sm);
          padding:12px;
        }
        .cd-root .stitchTask{
          background:var(--cd-surface);
          border:1px solid var(--cd-border);
          border-radius:var(--cd-radius-lg);
          box-shadow:var(--cd-shadow-sm);
        }
        .cd-root .stitchTask:hover{box-shadow:var(--cd-shadow)}
        .cd-root .stitchTask.ready{background:var(--cd-surface)}
        .cd-root .stitchTask.ready .taskRail{background:var(--cd-success)}
        .cd-root .stitchTask.in_progress .taskRail{background:var(--cd-primary)}
        .cd-root .stitchTask.waiting .taskRail,
        .cd-root .stitchTask.to_assign .taskRail{background:#dc2626}
        .cd-root .taskCodeRow span{
          background:var(--cd-primary-soft);
          color:#2f55c0;
          border-radius:var(--cd-radius-pill);
        }
        .cd-root .taskInfo h3{color:var(--cd-text);font-weight:800}
        .cd-root .taskMeta span,
        .cd-root .taskQty div{
          background:var(--cd-surface-2);
          border:1px solid var(--cd-border);
          border-radius:var(--cd-radius);
        }
        .cd-root .taskMeta b,
        .cd-root .taskQty small{color:var(--cd-text-muted)}
        .cd-root .taskQty .balance{
          background:var(--cd-primary-soft);
          border-color:#c7d7fb;
        }
        .cd-root .taskQty .balance b,
        .cd-root .taskQty .balance small{color:var(--cd-primary)}
        .cd-root .progressMini{
          background:var(--cd-surface-3);
          height:8px;
          border-radius:var(--cd-radius-pill);
        }
        .cd-root .badge,
        .cd-root .ready,
        .cd-root .partial,
        .cd-root .blocked,
        .cd-root .neutral{
          border-radius:var(--cd-radius-pill);
          font-size:12px;
          font-weight:800;
          padding:4px 10px;
        }
        .cd-root .ready{background:var(--cd-success-soft);color:var(--cd-success-text)}
        .cd-root .partial{background:var(--cd-warning-soft);color:var(--cd-warning-text)}
        .cd-root .blocked{background:var(--cd-danger-soft);color:var(--cd-danger-text)}
        .cd-root .neutral{background:#eceff5;color:#3a4151}
        .cd-root .stitchAction{
          background:var(--cd-primary);
          border:1px solid var(--cd-primary);
          border-radius:var(--cd-radius);
          color:var(--cd-on-primary);
          min-height:40px;
          padding:0 18px;
          font-size:14px;
          font-weight:800;
          box-shadow:var(--cd-shadow-sm);
        }
        .cd-root .stitchAction:hover{background:var(--cd-primary-hover)}
        .cd-root .stitchAction.secondary{
          background:var(--cd-surface);
          color:var(--cd-primary);
          border-color:var(--cd-border-strong);
        }
        .cd-root .stitchInlinePanel{
          background:var(--cd-surface-2);
          border:1px solid var(--cd-border);
          border-radius:var(--cd-radius-lg);
        }
        .cd-root .drawerBackdrop{
          background:rgba(15,27,45,.38);
          backdrop-filter:blur(2px);
        }
        .cd-root .logDrawer{
          background:var(--cd-surface);
          border-left:1px solid var(--cd-border);
          box-shadow:var(--cd-shadow-lg);
          border-radius:0;
        }
        .cd-root .drawerHead{
          background:var(--cd-surface-2);
          border-bottom:1px solid var(--cd-border);
        }
        .cd-root .drawerHead h2,
        .cd-root .drawerHead b{color:var(--cd-text)}
        .cd-root .balanceBadge{
          background:var(--cd-primary-soft);
          color:var(--cd-primary);
          border-radius:var(--cd-radius);
        }
        .cd-root .drawerFoot{
          border-top:1px solid var(--cd-border);
          background:var(--cd-surface);
        }

        .cd-root.page{padding:12px 28px 18px}
        .cd-root .stitchTopBar{
          margin-top:0;
          margin-bottom:8px;
          min-height:58px;
          padding:10px 14px;
        }
        .cd-root .stitchOperators{margin:0 0 6px}
        .cd-root .operatorChips{gap:6px}
        .cd-root .operatorChips button{padding:7px 14px}
        .cd-root .stitchSummary{
          gap:8px;
          margin-bottom:8px;
        }
        .cd-root .stitchSummary>div{
          padding:10px 14px;
          min-height:70px;
        }
        .cd-root .stitchFilters{
          padding:9px 10px;
          margin-bottom:8px;
        }
        .cd-root .stitchTabs{
          margin-bottom:8px;
        }
        .cd-root .stitchTaskArea{
          padding:10px;
        }

        .cd-root .empty{
          color:var(--cd-text-muted);
          background:var(--cd-surface);
          border:1px dashed var(--cd-border-strong);
          border-radius:var(--cd-radius-lg);
        }

        .spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.55);border-top-color:#fff;border-radius:50%;display:inline-block;margin-right:8px;vertical-align:-2px;animation:spin .8s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}

        .cd-root .stitchTask{
          min-height:86px;
          padding:10px 14px 10px 18px;
          border-radius:12px;
          grid-template-columns:minmax(250px,.95fr) minmax(360px,1.2fr) minmax(130px,.45fr);
          gap:10px;
          overflow:hidden;
        }
        .cd-root .taskRail{
          width:5px;
          border-radius:0;
        }
        .cd-root .taskCodeRow{
          margin-bottom:5px;
          gap:6px;
        }
        .cd-root .taskCodeRow .linkBtn{
          font-size:15px;
          line-height:1.1;
        }
        .cd-root .taskCodeRow span{
          font-size:10px;
          padding:3px 8px;
        }
        .cd-root .taskInfo h3{
          font-size:14px;
          margin:0 0 7px;
          line-height:1.15;
        }
        .cd-root .taskMeta{
          gap:6px;
        }
        .cd-root .taskMeta span{
          padding:5px 8px;
          font-size:11px;
          line-height:1.2;
        }
        .cd-root .taskMeta b{
          font-size:10px;
          margin-bottom:3px;
        }
        .cd-root .taskQty{
          gap:6px;
          margin-bottom:6px;
        }
        .cd-root .taskQty div{
          padding:5px 8px;
          min-height:42px;
        }
        .cd-root .taskQty small{
          font-size:9px;
          margin-bottom:2px;
        }
        .cd-root .taskQty b{
          font-size:13px;
          line-height:1.15;
        }
        .cd-root .taskStatus{
          margin-top:5px;
        }
        .cd-root .taskStatus small{
          font-size:10px;
        }
        .cd-root .stitchAction{
          min-height:34px;
          padding:0 14px;
          font-size:12px;
          border-radius:9px;
        }
        .cd-root .taskActionBox{
          gap:6px;
        }
        @media(max-width:1100px){
          .cd-root .stitchTask{
            grid-template-columns:1fr;
            align-items:start;
          }
          .cd-root .taskActionBox{
            align-items:flex-start;
          }
        }

        @media(max-width:700px){
          .page{padding:14px}
          .kpis{grid-template-columns:repeat(2,1fr)}
          .filterGrid{grid-template-columns:1fr}
          .modeTabs{flex-direction:column}
          .workCardMeta,.qtyGrid{grid-template-columns:1fr}
          h1{font-size:24px}
          .filters,.card{border-radius:14px}
        }


        /* P3-PROD-WORK-COMPACT-GRN-UI-1
           Display-only: compact GRN-style Production Control layout.
           Keeps API, inventory, WO release, production logging and DB writes untouched. */
        .pc2ControlPage{
          padding-top:14px;
        }
        .pc2ControlPage .stitchTopBar{
          display:none;
        }
        .pc2KpiShell{
          background:#fff;
          border:1px solid rgba(195,198,214,.55);
          border-radius:16px;
          padding:12px 14px;
          margin-bottom:8px;
          box-shadow:0 1px 2px rgba(0,0,0,.04);
        }
        .pc2PageHead{
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:12px;
          margin-bottom:10px;
        }
        .pc2PageHead h2{
          margin:0;
          font-size:22px;
          line-height:1.05;
          letter-spacing:-.02em;
          color:#191b23;
        }
        .pc2HealthLine{
          display:flex;
          align-items:center;
          gap:8px;
          margin-top:5px;
          flex-wrap:wrap;
        }
        .pc2HealthLine small{
          color:#64748b;
          font-size:11px;
        }
        .pc2HealthPill{
          display:inline-flex;
          align-items:center;
          gap:6px;
          background:#ecfdf5;
          color:#15803d;
          border-radius:999px;
          padding:2px 8px;
          font-size:11px;
          font-weight:900;
        }
        .pc2HealthPill span{
          width:6px;
          height:6px;
          background:#22c55e;
          border-radius:99px;
        }
        .pc2HeadActions{
          display:flex;
          align-items:center;
          justify-content:flex-end;
          gap:7px;
          flex-wrap:wrap;
        }
        .pc2ModeSwitch{
          display:inline-flex;
          align-items:center;
          background:#f1f5f9;
          border:1px solid #dbe2ee;
          border-radius:999px;
          padding:3px;
          gap:3px;
        }
        .pc2ModeSwitch button{
          border:none;
          background:transparent;
          border-radius:999px;
          padding:6px 11px;
          font-size:11px;
          font-weight:900;
          color:#475569;
          cursor:pointer;
        }
        .pc2ModeSwitch button.active{
          background:#004ac6;
          color:#fff;
          box-shadow:0 2px 7px rgba(0,74,198,.22);
        }
        .pc2Btn{
          border:1px solid #dbe2ee;
          background:#fff;
          border-radius:9px;
          padding:7px 10px;
          font-size:12px;
          font-weight:900;
          color:#0f172a;
          cursor:pointer;
        }
        .pc2KpiGrid{
          display:grid;
          grid-template-columns:repeat(5,minmax(0,1fr));
          gap:8px;
        }
        .pc2Kpi{
          text-align:left;
          background:#fff;
          border:1px solid rgba(195,198,214,.7);
          border-radius:12px;
          padding:8px 10px;
          min-height:58px;
          box-shadow:0 1px 2px rgba(0,0,0,.03);
          cursor:pointer;
        }
        .pc2Kpi small{
          display:block;
          text-transform:uppercase;
          letter-spacing:.06em;
          font-size:9px;
          line-height:1.1;
          font-weight:950;
          color:#64748b;
          margin-bottom:3px;
        }
        .pc2Kpi b{
          display:block;
          font-size:20px;
          line-height:1.05;
          color:#0f172a;
        }
        .pc2Kpi em{
          display:block;
          font-style:normal;
          font-size:10px;
          color:#64748b;
          margin-top:3px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .pc2KpiDanger{
          border-color:#fecaca;
          box-shadow:inset 0 0 0 1px rgba(186,26,26,.04);
        }
        .pc2KpiDanger small,.pc2KpiDanger b,.pc2KpiDanger em{
          color:#ba1a1a;
        }
        .pc2TinyProgress{
          height:3px;
          background:#edf2f7;
          border-radius:999px;
          overflow:hidden;
          margin-top:5px;
        }
        .pc2TinyProgress span{
          display:block;
          height:100%;
          background:#004ac6;
          border-radius:999px;
        }
        .pc2Filters{
          position:sticky;
          top:0;
          z-index:18;
          display:grid;
          grid-template-columns:minmax(300px,1.9fr) repeat(4,minmax(120px,.7fr));
          gap:7px;
          background:rgba(255,255,255,.92);
          backdrop-filter:blur(12px);
          border:1px solid rgba(195,198,214,.45);
          border-radius:12px;
          padding:7px;
          margin-bottom:8px;
        }
        .pc2SearchBox{
          display:flex;
          align-items:center;
          gap:8px;
          background:#f8fafc;
          border:1px solid #e2e8f0;
          border-radius:9px;
          padding:0 9px;
        }
        .pc2SearchBox span{
          color:#64748b;
          font-weight:900;
        }
        .pc2SearchBox input{
          border:none;
          background:transparent;
          outline:none;
          min-height:32px;
          width:100%;
          font-size:13px;
        }
        .pc2Filters select{
          border:1px solid #e2e8f0;
          background:#f8fafc;
          border-radius:9px;
          min-height:34px;
          padding:0 9px;
          color:#334155;
          font-size:13px;
        }
        .pc2LotTabs{
          display:flex;
          gap:6px;
          margin:0 0 8px;
          flex-wrap:wrap;
        }
        .pc2LotTabs button{
          border:1px solid #dbe2ee;
          background:#fff;
          color:#334155;
          border-radius:999px;
          padding:5px 12px;
          font-size:11px;
          font-weight:950;
          cursor:pointer;
        }
        .pc2LotTabs button.active{
          border-color:#004ac6;
          background:#eef4ff;
          color:#004ac6;
        }
        .pc2TableCard{
          background:#fff;
          border:1px solid rgba(195,198,214,.55);
          border-radius:16px;
          box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.02);
          overflow:hidden;
        }
        .pc2TableTop{
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:12px;
          padding:10px 14px;
          border-bottom:1px solid #edf2f7;
        }
        .pc2TableTop h3{
          margin:0;
          font-size:16px;
          line-height:1.1;
        }
        .pc2TableTop small,.pc2Count{
          font-size:11px;
          color:#64748b;
        }
        .pc2TableWrap{
          overflow:auto;
          max-height:calc(100vh - 245px);
        }
        .pc2Table{
          width:100%;
          border-collapse:collapse;
          min-width:1120px;
        }
        .pc2Table thead th{
          position:sticky;
          top:0;
          z-index:5;
          background:#f8fafc;
          border-bottom:1px solid #e2e8f0;
          text-align:left;
          font-size:9px;
          letter-spacing:.08em;
          text-transform:uppercase;
          color:#64748b;
          padding:9px 10px;
          font-weight:950;
        }
        .pc2Table thead th:first-child{
          width:44px;
        }
        .pc2Table thead th:nth-child(2){
          width:220px;
        }
        .pc2Table thead th:last-child{
          width:190px;
        }
        .pc2Table tbody td{
          border-bottom:1px solid rgba(226,232,240,.72);
          padding:8px 10px;
          vertical-align:middle;
        }
        .pc2GroupRow{
          cursor:pointer;
          background:#eef4ff;
        }
        .pc2GroupRow td{
          padding-top:11px;
          padding-bottom:11px;
          border-top:2px solid #c7d2fe;
          border-bottom:1px solid #bfdbfe;
        }
        .pc2GroupRow:hover{
          background:#eaf1ff;
        }
        .pc2StkParentRow{
          box-shadow:inset 0 1px 0 rgba(255,255,255,.65);
        }
        .pc2GroupAttention{
          background:linear-gradient(90deg,#fff7ed 0%,#fffaf5 38%,#eef4ff 100%);
        }
        .pc2GroupAttention td:first-child{
          box-shadow:inset 5px 0 0 #ba1a1a;
        }
        .pc2SkuCell{
          display:flex;
          align-items:center;
          gap:10px;
        }
        .pc2SkuCell b,.pc2ChildSku b,.pc2Table td>b{
          display:block;
          color:#0f172a;
          line-height:1.15;
        }
        .pc2SkuCell small,.pc2ChildSku small,.pc2Table td small{
          display:block;
          color:#64748b;
          font-size:10px;
          line-height:1.25;
          margin-top:2px;
        }
        .pc2SkuIcon{
          width:32px;
          height:32px;
          border-radius:10px;
          background:#fff;
          color:#004ac6;
          border:1px solid #bfdbfe;
          display:grid;
          place-items:center;
          font-size:13px;
          font-weight:950;
          box-shadow:0 1px 2px rgba(15,23,42,.08);
        }
        .pc2Chevron{
          display:inline-block;
          font-weight:950;
          color:#64748b;
          transition:.18s;
        }
        .pc2Chevron.closed{
          transform:rotate(-90deg);
        }
        .pc2ChildRow{
          background:#fff;
        }
        .pc2ChildRow td{
          padding-top:9px;
          padding-bottom:9px;
        }
        .pc2StageChildRow td:first-child{
          position:relative;
          background:linear-gradient(90deg,#f8fbff,#fff);
        }
        .pc2StageChildRow td:first-child:before{
          content:"";
          position:absolute;
          top:0;
          bottom:0;
          left:50%;
          width:2px;
          transform:translateX(-50%);
          background:#dbeafe;
        }
        .pc2ChildRow:hover{
          background:#f8fbff;
        }
        .pc2ChildBlocked{
          background:#fff;
        }
        .pc2ChildBlocked:hover{
          background:#fffafa;
        }
        .pc2ChildBlocked td:first-child:before{
          background:#fecaca;
        }
        .pc2StageRailCell{
          width:44px;
          text-align:center;
        }
        .pc2StageDot{
          position:relative;
          z-index:1;
          display:inline-grid;
          place-items:center;
          width:22px;
          height:22px;
          border-radius:999px;
          background:#fff;
          color:#004ac6;
          border:2px solid #bfdbfe;
          font-size:10px;
          font-weight:950;
          box-shadow:0 1px 2px rgba(15,23,42,.08);
        }
        .pc2StageDot.ready{
          color:#15803d;
          border-color:#bbf7d0;
          background:#ecfdf5;
        }
        .pc2StageDot.halt{
          color:#ba1a1a;
          border-color:#fecaca;
          background:#fff5f5;
        }
        .pc2ParentStageCell{
          display:flex;
          align-items:center;
          gap:8px;
        }
        .pc2ParentPill{
          display:inline-flex;
          align-items:center;
          border-radius:999px;
          padding:3px 8px;
          background:#004ac6;
          color:#fff;
          font-size:9px;
          font-weight:950;
          letter-spacing:.05em;
          text-transform:uppercase;
          white-space:nowrap;
        }
        .pc2StageNameCell{
          display:grid;
          gap:1px;
        }
        .pc2ChildSku{
          display:grid;
          gap:2px;
          padding-left:2px;
        }
        .pc2ChildWoLine{
          display:flex;
          align-items:center;
          gap:6px;
          min-width:0;
        }
        .pc2StageChip{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-width:38px;
          height:18px;
          border-radius:999px;
          background:#f8fafc;
          color:#475569;
          border:1px solid #dbe2ee;
          font-size:9px;
          font-weight:950;
          letter-spacing:.04em;
        }
        .pc2WoLink{
          border:none;
          background:transparent;
          color:#004ac6;
          font-size:12px;
          font-weight:950;
          padding:0;
          text-align:left;
          cursor:pointer;
        }
        .pc2Mono{
          font-family:"JetBrains Mono",monospace;
        }
        .pc2ProgressLine{
          height:5px;
          background:#edf2f7;
          border-radius:999px;
          overflow:hidden;
          margin-bottom:3px;
        }
        .pc2ProgressLine span{
          display:block;
          height:100%;
          background:#004ac6;
          border-radius:999px;
        }
        .pc2Pct{
          font-size:10px;
          color:#64748b;
        }
        .pc2Status{
          display:inline-flex;
          align-items:center;
          gap:5px;
          border-radius:999px;
          padding:3px 8px;
          font-size:9px;
          font-weight:950;
          text-transform:uppercase;
          letter-spacing:.04em;
          white-space:nowrap;
        }
        .pc2StatusReady{background:#ecfdf5;color:#15803d;border:1px solid #bbf7d0}
        .pc2StatusRunning{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
        .pc2StatusPartial{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
        .pc2StatusBlocked{background:#fef2f2;color:#ba1a1a;border:1px solid #fecaca}
        .pc2StatusHalt{background:#111827;color:#fff;border:1px solid #111827}
        .pc2StatusCompleted{background:#f1f5f9;color:#334155;border:1px solid #cbd5e1}
        .pc2Reason{
          max-width:190px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .pc2Actions{
          display:flex;
          justify-content:flex-end;
          gap:5px;
          flex-wrap:wrap;
          align-items:center;
        }
        .pc2Actions button,.pc2MiniBtn{
          border:1px solid #dbe2ee;
          background:#fff;
          color:#004ac6;
          border-radius:7px;
          padding:5px 7px;
          font-size:10px;
          line-height:1;
          font-weight:950;
          cursor:pointer;
        }
        .pc2Actions button:hover,.pc2MiniBtn:hover{
          border-color:#004ac6;
        }
        .pc2Actions .danger{
          color:#ba1a1a;
          border-color:#fecaca;
          background:#fff5f5;
        }
        .pc2AssignRow td{
          background:#f8fafc!important;
        }
        .pc2State{
          padding:34px;
          text-align:center;
          color:#64748b;
        }
        .pc2DrawerOverlay{position:fixed;inset:0;background:rgba(15,23,42,.36);z-index:80;backdrop-filter:blur(2px)}
        .pc2Drawer{position:fixed;right:0;top:0;bottom:0;width:min(500px,100vw);background:#fff;z-index:90;box-shadow:-18px 0 40px rgba(15,23,42,.18);display:flex;flex-direction:column;border-left:1px solid #e2e8f0}
        .pc2DrawerHead{padding:20px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between}
        .pc2DrawerHead small{font-size:10px;color:#004ac6;font-weight:900;text-transform:uppercase}
        .pc2DrawerHead h3{margin:4px 0 0;font-size:20px}
        .pc2DrawerHead button{width:34px;height:34px;border-radius:999px;border:1px solid #e2e8f0;background:#fff;font-size:24px}
        .pc2DrawerTabs{display:flex;gap:2px;overflow:auto;background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:0 10px}
        .pc2DrawerTabs button{border:none;background:transparent;padding:13px 10px;font-size:11px;font-weight:900;color:#64748b;border-bottom:2px solid transparent;white-space:nowrap}
        .pc2DrawerTabs button.active{color:#004ac6;border-bottom-color:#004ac6}
        .pc2DrawerBody{padding:18px;overflow:auto;flex:1}
        .pc2InfoGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .pc2InfoGrid>div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px}
        .pc2InfoGrid small{display:block;font-size:10px;text-transform:uppercase;color:#64748b;font-weight:900;margin-bottom:5px}
        .pc2InfoGrid b{font-size:13px}
        .pc2DrawerPanel{margin-top:14px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px}
        .pc2DrawerPanel h4{margin:0 0 10px}
        .pc2DrawerPanel p{color:#475569;font-size:13px}
        .pc2DrawerFoot{padding:16px;border-top:1px solid #e2e8f0;background:#fff;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
        .pc2DrawerFoot button{border:1px solid #dbe2ee;background:#fff;border-radius:10px;font-size:12px;font-weight:900;padding:10px}
        .pc2DrawerFoot .primary{background:#004ac6;color:#fff;border-color:#004ac6}
        .material-symbols-outlined{font-family:'Material Symbols Outlined'}
        @media(max-width:1100px){
          .pc2KpiGrid{grid-template-columns:repeat(2,1fr)}
          .pc2Filters{grid-template-columns:1fr 1fr}
          .pc2TableWrap{max-height:none}
          .pc2PageHead{align-items:flex-start}
        }
        @media(max-width:700px){
          .pc2KpiGrid,.pc2Filters{grid-template-columns:1fr}
          .pc2PageHead{flex-direction:column}
          .pc2HeadActions{justify-content:flex-start}
          .pc2Drawer{width:100vw}
          .pc2DrawerFoot{grid-template-columns:1fr}
        }
      `}</style>
    </main>
  );
}
