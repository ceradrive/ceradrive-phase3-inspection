'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '../../../../lib/api';

function Badge({ value }) {
  const v = value || 'NOT_CHECKED';
  const style =
    v === 'READY' ? S.badgeReady :
    v === 'PARTIAL' ? S.badgePartial :
    v === 'BLOCKED' ? S.badgeBlocked :
    S.badgeNeutral;

  const label =
    v === 'READY' ? 'READY TO START' :
    v === 'PARTIAL' ? 'PARTIALLY READY' :
    v === 'BLOCKED' ? 'BLOCKED' :
    v === 'NOT_CHECKED' ? 'NOT CHECKED' :
    v;

  return <span style={style}>{label}</span>;
}

function StepPill({ step, highlight = false }) {
  return (
    <div style={highlight ? S.stepPillHot : S.stepPill}>
      <strong>{step.step_no}. {step.process_name}</strong>
      <span>{step.output_item_code || 'No output item'}</span>
      <em>{step.calculation_basis || 'Manual'}</em>
    </div>
  );
}

// === PATCH6B_START: PPO decision-first derivations (pure, no UI) ===
// Three independent axes: lifecycleStatus (badge), nextAction (button), blocker (overlay).
// Cancellation source is plan_status/execution_status.
function deriveLifecycleStatus(productionSummary, header) {
  const s = productionSummary || {};

  const isCancelled =
    String((header && header.plan_status) || '').toUpperCase() === 'CANCELLED' ||
    String((header && header.execution_status) || '').toUpperCase() === 'CANCELLED';

  if (isCancelled) return 'CANCELLED';

  const total = Number(s.total_wo_count || 0);
  const completed = Number(s.completed_wo_count || 0);
  const active = Number(s.active_wo_count || 0);
  const released = Number(s.released_wo_count || 0);
  const ready = Number(s.ready_wo_count || 0);
  const hasActivity = !!s.has_production_activity;

  if (total === 0) return 'NOT_PREPARED';
  if (completed === total) return 'COMPLETED';
  if (active > 0 || (hasActivity && completed < total)) return 'IN_PRODUCTION';
  if (released > 0 && active === 0 && !hasActivity) return 'RELEASED';
  if (ready > 0) return 'READY';

  return 'PREPARING';
}

function deriveNextAction(productionSummary, hasBlocker, header) {
  const s = productionSummary || {};

  const isCancelled =
    String((header && header.plan_status) || '').toUpperCase() === 'CANCELLED' ||
    String((header && header.execution_status) || '').toUpperCase() === 'CANCELLED';

  if (isCancelled) return 'NOTHING_REQUIRED';

  const total = Number(s.total_wo_count || 0);
  const active = Number(s.active_wo_count || 0);
  const released = Number(s.released_wo_count || 0);
  const ready = Number(s.ready_wo_count || 0);
  const notChecked = Number(s.not_checked_wo_count || 0);
  const completed = Number(s.completed_wo_count || 0);

  if (total > 0 && completed === total) return 'NOTHING_REQUIRED';

  // Locked: run-first when active — production execution outranks shortage review.
  if (active > 0) return 'OPEN_WORKER_DAILY_WORK';

  if (hasBlocker) return 'REVIEW_MATERIAL_SHORTAGES';
  if (ready > 0) return 'RELEASE_READY_WORK_ORDERS';
  if (released > 0) return 'OPEN_WORKER_DAILY_WORK';
  if (notChecked > 0) return 'CHECK_MATERIAL_READINESS';
  if (total === 0) return 'PREPARE_PRODUCTION';

  return 'NOTHING_REQUIRED';
}

function deriveBlocker(workOrders) {
  const wos = Array.isArray(workOrders) ? workOrders : [];

  let blockedWoCount = 0;
  let chosen = null;
  let chosenFromWo = null;

  for (const wo of wos) {
    const inputs = Array.isArray(wo && wo.input_details) ? wo.input_details : [];
    let woWorst = null;

    for (const inp of inputs) {
      const shortageRaw = Number(
        (
          inp &&
          (
            inp.display_shortage_qty != null
              ? inp.display_shortage_qty
              : inp.shortage_qty
          )
        ) || 0
      );

      if (shortageRaw > 0) {
        const requiredRaw = Number(
          (
            inp &&
            (
              inp.display_required_qty != null
                ? inp.display_required_qty
                : inp.required_qty
            )
          ) || 0
        );

        const ratio = requiredRaw > 0 ? shortageRaw / requiredRaw : 0;

        if (!woWorst || ratio > woWorst.ratio) {
          woWorst = {
            ratio,
            item_code: (inp && inp.input_item_code) || null,
            required: requiredRaw,
            available: Number(
              (
                inp &&
                (
                  inp.display_available_qty != null
                    ? inp.display_available_qty
                    : inp.available_qty
                )
              ) || 0
            ),
            shortage: shortageRaw,
            uom: (inp && (inp.display_uom_code || inp.uom_code)) || null,
          };
        }
      }
    }

    if (woWorst) {
      blockedWoCount += 1;

      // v1 rule: first WO in backend order that has shortage wins.
      if (chosenFromWo === null) {
        chosen = woWorst;
        chosenFromWo = wo;
      }
    }
  }

  if (!chosen) return { present: false };

  return {
    present: true,
    blocked_wo_count: blockedWoCount,
    item_code: chosen.item_code,
    required: chosen.required,
    available: chosen.available,
    shortage: chosen.shortage,
    uom: chosen.uom,
  };
}
// === PATCH6B_END ===


export default function ProductionPlanOrderDetailPage() {
  const router = useRouter();
  const params = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [syncing, setSyncing] = useState(false);
  const [generatingWos, setGeneratingWos] = useState(false);
  const [woProgress, setWoProgress] = useState(0);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [releasingReadyWos, setReleasingReadyWos] = useState(false);
  const [creatingMixPlanCode, setCreatingMixPlanCode] = useState(null);
  const [readinessProgress, setReadinessProgress] = useState(0);
  const [preparingWork, setPreparingWork] = useState(false);
  const [prepareProgress, setPrepareProgress] = useState(0);
  const [prepareMessage, setPrepareMessage] = useState('');
  const [showAdvancedActions, setShowAdvancedActions] = useState(false);
  const [cancellingPpo, setCancellingPpo] = useState(false);

  const [activeTab, setActiveTab] = useState('OVERVIEW');
  const [woFilter, setWoFilter] = useState('SUMMARY');
  const [selectedWoIds, setSelectedWoIds] = useState([]);
  const [expandedDep, setExpandedDep] = useState(null);
  const [timelineData, setTimelineData] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');

  async function load() {
    setLoading(true);
    const res = await api.get(`/api/v1/production-plan-orders/${params.id}`);

    if (res.error) {
      alert(res.error.message || 'Failed to load PPO.');
      setData(null);
    } else {
      setData(res.data);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (params.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function loadTimeline() {
    if (!params.id) return;

    setTimelineLoading(true);
    setTimelineError('');

    const res = await api.get(`/api/v1/production-plan-orders/${params.id}/timeline-load?ts=${Date.now()}`);

    if (res.error) {
      setTimelineData(null);
      setTimelineError(res.error.message || 'Failed to load Timeline & Load.');
    } else {
      setTimelineData(res.data);
    }

    setTimelineLoading(false);
  }

  useEffect(() => {
    if (activeTab === 'TIMELINE' && params.id) loadTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, params.id]);

  function fmtNum(value, maximumFractionDigits = 2) {
    if (value === null || value === undefined || value === '') return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString(undefined, { maximumFractionDigits });
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function runPPOAction(path, failureMessage) {
    const res = await api.post(`/api/v1/production-plan-orders/${params.id}/${path}`, {});

    if (res.error) {
      throw new Error(res.error.message || failureMessage);
    }

    return res.data || {};
  }

  function formatPrepareStep(label, res = {}) {
    const parts = [label];

    if (res.created !== undefined) parts.push(`created ${res.created || 0}`);
    if (res.ready !== undefined) parts.push(`ready ${res.ready || 0}`);
    if (res.partial !== undefined) parts.push(`partial ${res.partial || 0}`);
    if (res.blocked !== undefined) parts.push(`blocked ${res.blocked || 0}`);
    if (res.released !== undefined) parts.push(`released ${res.released || 0}`);
    if (res.skipped !== undefined) parts.push(`skipped ${res.skipped || 0}`);

    return parts.join(' • ');
  }

  async function prepareForReview() {
    if (preparingWork || syncing || generatingWos || checkingReadiness || releasingReadyWos) return;

    if (!confirm('Prepare this PPO for manager review? This will sync routings, generate missing stage WOs, and check start status. It will NOT release work to Shop Floor.')) return;

    const summary = [];

    try {
      setPreparingWork(true);
      setPrepareProgress(5);
      setPrepareMessage('Syncing routings from recipe...');
      const sync = await runPPOAction('sync-routings', 'Failed to sync routings.');
      summary.push(formatPrepareStep('Routings synced', sync));

      setPrepareProgress(30);
      setPrepareMessage('Generating missing stage Work Orders...');
      const generated = await runPPOAction('generate-work-orders', 'Failed to generate Work Orders.');
      summary.push(formatPrepareStep('Stage WOs generated', generated));

      setPrepareProgress(60);
      setPrepareMessage('Checking Work Order start status...');
      const readiness = await runPPOAction('check-wo-readiness', 'Failed to check Work Order start status.');
      summary.push(formatPrepareStep('Start status checked', readiness));

      setPrepareProgress(100);
      setPrepareMessage('PPO is ready for manager review. Refreshing...');
      await load();

      alert(`Prepare for Review completed.\n\n${summary.join('\n')}\n\nReview Generated Work Orders / Start Status, then manually release READY/PARTIAL WOs.`);
    } catch (err) {
      alert(err.message || 'Prepare for Review failed.');
    } finally {
      setTimeout(() => {
        setPreparingWork(false);
        setPrepareProgress(0);
        setPrepareMessage('');
      }, 700);
    }
  }

  async function syncRoutings() {
    if (!confirm('Sync routings from Stage Recipes for this PPO?')) return;

    try {
      setSyncing(true);
      const res = await api.post(`/api/v1/production-plan-orders/${params.id}/sync-routings`, {});

      if (res.error) {
        alert(res.error.message || 'Failed to sync routings.');
        return;
      }

      alert(`Routing sync done. Created: ${res.data?.created || 0}, Skipped: ${res.data?.skipped || 0}`);
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function checkWOReadiness() {
    if (!confirm('Check start status for all PPO Work Orders?')) return;

    let timer = null;

    try {
      setCheckingReadiness(true);
      setReadinessProgress(5);

      timer = setInterval(() => {
        setReadinessProgress(prev => {
          if (prev >= 90) return prev;
          return prev + 5;
        });
      }, 350);

      const res = await api.post(`/api/v1/production-plan-orders/${params.id}/check-wo-readiness`, {});

      if (res.error) {
        alert(res.error.message || 'Failed to check WO start status.');
        return;
      }

      setReadinessProgress(100);
      alert(`Start status checked. Ready: ${res.data?.ready || 0}, Partial: ${res.data?.partial || 0}, Blocked: ${res.data?.blocked || 0}`);
      await load();
    } finally {
      if (timer) clearInterval(timer);

      setTimeout(() => {
        setCheckingReadiness(false);
        setReadinessProgress(0);
      }, 700);
    }
  }


  async function releaseReadyWorkOrders(idsOverride = null) {
    const idsToRelease = Array.isArray(idsOverride) ? idsOverride : selectedWoIds;

    if (!idsToRelease.length) {
      alert('Select READY/PARTIAL draft WOs to release.');
      return;
    }

    if (!confirm(`Release ${idsToRelease.length} selected Work Orders to Shop Floor?`)) return;

    try {
      setReleasingReadyWos(true);

      const res = await api.post(`/api/v1/production-plan-orders/${params.id}/release-ready-work-orders`, {
        selected_wo_ids: idsToRelease,
      });

      if (res.error) {
        alert(res.error.message || 'Failed to release selected Work Orders.');
        return;
      }

      alert(`Release done. Released: ${res.data?.released || 0}, Skipped: ${res.data?.skipped || 0}`);
      setSelectedWoIds([]);
      await load();
    } finally {
      setReleasingReadyWos(false);
    }
  }

  async function createMixPlan(row) {
    const qty = Number(row?.shortage || 0);

    if (!row?.item_id) {
      alert('Item id missing for Mix Plan. Refresh Start Status and try again.');
      return;
    }

    if (!qty || qty <= 0) {
      alert('No shortage qty available for Mix Plan.');
      return;
    }

    if (!confirm(`Create Mix Plan for ${row.code} shortage ${displayQty(qty, row.uom)}?`)) return;

    try {
      setCreatingMixPlanCode(row.code);

      const res = await api.post('/api/v1/production-plan-orders', {
        source_type: 'UPSTREAM_MIX_PLAN',
        source_ref_id: params.id,
        material_status: 'NOT_CHECKED',
        notes: `Upstream Mix Plan from PPO ${data?.ppo_number || params.id} for ${row.code} shortage ${displayQty(qty, row.uom)}`,
        items: [
          {
            item_id: row.item_id,
            item_code: row.code,
            item_name: row.name,
            approved_qty: qty,
            planned_qty: qty,
            qty,
            production_pcs: qty,
            source_type: 'UPSTREAM_MIX_PLAN',
            source_ref_id: params.id,
            notes: `Created from PPO Material / Start Plan for ${row.code}`,
          },
        ],
      });

      const created = res?.data?.data || res?.data || res;
      const newPpoId = created?.id;

      if (newPpoId) {
        router.push(`/production-plan-orders/${newPpoId}`);
      } else {
        alert('Mix Plan PPO created, but new PPO id was not returned. Open Production Plan Orders list.');
        load();
      }
    } catch (e) {
      alert(e?.response?.data?.message || e?.message || 'Failed to create Mix Plan.');
    } finally {
      setCreatingMixPlanCode(null);
    }
  }

  async function cancelPPO() {
    if (!data?.id) return;

    if (!confirm('Cancel this PPO? This is allowed only when production has not started.')) return;

    try {
      setCancellingPpo(true);
      const res = await api.post(`/api/v1/production-plan-orders/${params.id}/cancel`, {});

      if (res.error) {
        alert(res.error.message || 'Failed to cancel PPO.');
        return;
      }

      alert(`PPO cancelled. Deleted draft WOs: ${res.data?.deleted_work_orders || 0}`);
      await load();
    } finally {
      setCancellingPpo(false);
    }
  }

  async function generateWorkOrders() {
    if (!confirm('Generate stage-wise Work Orders from this PPO?')) return;

    let timer = null;

    try {
      setGeneratingWos(true);
      setWoProgress(5);

      timer = setInterval(() => {
        setWoProgress(prev => {
          if (prev >= 90) return prev;
          return prev + 5;
        });
      }, 350);

      const res = await api.post(`/api/v1/production-plan-orders/${params.id}/generate-work-orders`, {});

      if (res.error) {
        alert(res.error.message || 'Failed to generate Work Orders.');
        return;
      }

      setWoProgress(100);
      alert(`WO generation done. Created: ${res.data?.created || 0}, Skipped: ${res.data?.skipped || 0}`);
      await load();
    } finally {
      if (timer) clearInterval(timer);

      setTimeout(() => {
        setGeneratingWos(false);
        setWoProgress(0);
      }, 700);
    }
  }

  const woList = data?.work_orders || [];

  function isReleasableWo(wo) {
    return String(wo?.status || '').toLowerCase() === 'draft' &&
      ['READY', 'PARTIAL'].includes(String(wo?.readiness_status || '').toUpperCase());
  }


  const readyCount = useMemo(
    () => woList.filter(w => w.readiness_status === 'READY').length,
    [woList]
  );

  const partialCount = useMemo(
    () => woList.filter(w => w.readiness_status === 'PARTIAL').length,
    [woList]
  );

  const blockedCount = useMemo(
    () => woList.filter(w => w.readiness_status === 'BLOCKED').length,
    [woList]
  );

  const notCheckedCount = useMemo(
    () => woList.filter(w => !w.readiness_status || w.readiness_status === 'NOT_CHECKED').length,
    [woList]
  );

  const processSummary = useMemo(() => {
    const grouped = {};

    for (const wo of woList) {
      const key = wo.process?.type_code || 'UNKNOWN';

      if (!grouped[key]) {
        grouped[key] = {
          key,
          process: wo.process?.type_name || wo.process?.type_code || 'Unknown',
          count: 0,
          planned: 0,
          ready: 0,
          partial: 0,
          blocked: 0,
          not_checked: 0,
        };
      }

      grouped[key].count += 1;
      grouped[key].planned += Number(wo.planned_qty || 0);

      const status = wo.readiness_status || 'NOT_CHECKED';
      if (status === 'READY') grouped[key].ready += 1;
      else if (status === 'PARTIAL') grouped[key].partial += 1;
      else if (status === 'BLOCKED') grouped[key].blocked += 1;
      else grouped[key].not_checked += 1;
    }

    return Object.values(grouped);
  }, [woList]);

  const filteredWorkOrders = useMemo(() => {
    return woList.filter(wo => {
      if (woFilter === 'SUMMARY') return false;
      if (woFilter === 'ALL') return true;

      if (['READY', 'PARTIAL', 'BLOCKED', 'NOT_CHECKED'].includes(woFilter)) {
        return (wo.readiness_status || 'NOT_CHECKED') === woFilter;
      }

      return wo.process?.type_code === woFilter;
    });
  }, [woList, woFilter]);

  const groupedFilteredWorkOrders = useMemo(() => {
    const grouped = {};

    for (const wo of filteredWorkOrders) {
      const key = wo.process?.type_code || 'UNKNOWN';
      if (!grouped[key]) {
        grouped[key] = {
          key,
          process: wo.process?.type_name || wo.process?.type_code || 'Unknown Process',
          rows: [],
        };
      }
      grouped[key].rows.push(wo);
    }

    return Object.values(grouped);
  }, [filteredWorkOrders]);



  function isStageDependency(code = '') {
    return [
      'DEV_MIX',
      'DEV_PF',
      'DEV_SBBP',
      'DEV_ACBP',
      'DEV_MLD',
      'DEV_GRM',
      'DEV_PWC',
      'DEV_CUR',
      'DEV_STK',
    ].some(prefix => String(code).startsWith(prefix));
  }

  function displayQty(qty, uom) {
    const n = Number(qty || 0);
    if (String(uom || '').toUpperCase() === 'G') {
      return `${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} KG`;
    }
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${uom || ''}`.trim();
  }


  function isUpstreamActionItem(row = {}) {
    const code = String(row.code || '').toUpperCase();
    const st = String(row.stageType || '').toUpperCase();

    return (
      st === 'MIX' ||
      st === 'MBM' ||
      st === 'SFG' ||
      code.startsWith('MBM') ||
      code.startsWith('DEV_MIX')
    );
  }

  function upstreamPlanLabel(row = {}) {
    const code = String(row.code || '').toUpperCase();
    const st = String(row.stageType || '').toUpperCase();

    if (code.startsWith('MBM') || st === 'MBM') return 'MBM Plan';
    if (code.startsWith('DEV_MIX') || st === 'MIX') return 'Mix Plan';
    return 'Upstream Plan';
  }

  const materialSummary = useMemo(() => {
    const map = new Map();

    for (const wo of data?.work_orders || []) {
      const inputs = wo.input_details || wo.input_shortages || [];

      for (const inp of inputs) {
        const code = inp.input_item_code || 'UNKNOWN';
        const name = inp.input_item_name || '';
        const uom = inp.display_uom_code || inp.uom_code || '';

        if (!map.has(code)) {
          map.set(code, {
            item_id: inp.input_item_id || null,
            code,
            name,
            uom,
            stageType: inp.input_stage_type || '',
            required: 0,
            available: 0,
            shortage: 0,
            woCount: 0,
            woSet: new Set(),
            category: isStageDependency(code) ? 'STAGE_DEPENDENCY' : 'RAW_PURCHASE',
          });
        }

        const row = map.get(code);
        const required = Number(inp.display_required_qty ?? inp.required_qty ?? 0);
        const available = Number(inp.display_available_qty ?? inp.available_qty ?? 0);

        row.required += required;
        row.available = Math.max(row.available, available);

        if (!row.woSet.has(wo.id)) {
          row.woSet.add(wo.id);
          row.woCount += 1;
        }
      }
    }

    return [...map.values()]
      .map(x => ({
        ...x,
        required: Number(x.required.toFixed(4)),
        available: Number(x.available.toFixed(4)),
        shortage: Number(Math.max(0, x.required - x.available).toFixed(4)),
      }))
      .sort((a, b) => b.shortage - a.shortage || a.code.localeCompare(b.code));
  }, [data]);

  const rawMaterialSummary = useMemo(
    () => materialSummary.filter(x =>
      Number(x.shortage || 0) > 0 &&
      x.category === 'RAW_PURCHASE' &&
      !isUpstreamActionItem(x)
    ),
    [materialSummary]
  );

  const stageDependencySummary = useMemo(
    () => materialSummary.filter(x => x.category === 'STAGE_DEPENDENCY' && Number(x.shortage || 0) > 0),
    [materialSummary]
  );

  const readyReleaseWos = useMemo(
    () => (data?.work_orders || []).filter(isReleasableWo),
    [data]
  );

  const actionNeededSummary = useMemo(
    () => materialSummary.filter(x => Number(x.shortage || 0) > 0 && isUpstreamActionItem(x)),
    [materialSummary]
  );

  const actionNeededCodes = useMemo(
    () => new Set(actionNeededSummary.map(x => x.code)),
    [actionNeededSummary]
  );

  const waitingPreviousStageWoCount = useMemo(() => {
    return (data?.work_orders || []).filter(wo => {
      if (String(wo.readiness_status || '').toUpperCase() !== 'BLOCKED') return false;

      const shortages = (wo.input_details || []).filter(inp => Number(inp.shortage_qty || 0) > 0);
      if (!shortages.length) return false;

      return shortages.some(inp => {
        const code = String(inp.input_item_code || '');
        if (actionNeededCodes.has(code)) return false;
        return isStageDependency(code);
      });
    }).length;
  }, [data, actionNeededCodes]);

  const timelineRows = Array.isArray(timelineData?.rows) ? timelineData.rows : [];
  const timelineSummary = timelineData?.summary || {};

  const ppoDecision = useMemo(() => {
    const summary = data?.production_summary || {};
    const rawBlocker = deriveBlocker(data?.work_orders || []);
    const lifecycleStatus = deriveLifecycleStatus(summary, data);
    const showBlocker =
      rawBlocker.present &&
      !['CANCELLED', 'COMPLETED'].includes(lifecycleStatus);

    const derivedAction = deriveNextAction(summary, showBlocker, data);
    const nextAction =
      lifecycleStatus === 'COMPLETED'
        ? 'VIEW_FINAL_PROGRESS'
        : derivedAction;

    const totalWos = Number(summary.total_wo_count || 0);
    const completedWos = Number(summary.completed_wo_count || 0);
    const activeWos = Number(summary.active_wo_count || 0);
    const releasedWos = Number(summary.released_wo_count || 0);
    const readyWos = Number(summary.ready_wo_count || 0);
    const blockedWos = Number(summary.blocked_wo_count || 0);
    const notCheckedWos = Number(summary.not_checked_wo_count || 0);

    const actionLabels = {
      PREPARE_PRODUCTION: 'Prepare Production',
      CHECK_MATERIAL_READINESS: 'Check Readiness',
      REVIEW_MATERIAL_SHORTAGES: 'Review Material Shortages',
      RELEASE_READY_WORK_ORDERS: 'Release Ready Work Orders',
      OPEN_WORKER_DAILY_WORK: 'Open Production Work',
      VIEW_FINAL_PROGRESS: 'View Final Progress',
      NOTHING_REQUIRED: '',
    };

    const statusLabels = {
      CANCELLED: 'Cancelled',
      NOT_PREPARED: 'Not Prepared',
      PREPARING: 'Preparing',
      READY: 'Ready to Release',
      RELEASED: 'Released',
      IN_PRODUCTION: 'In Production',
      COMPLETED: 'Complete',
    };

    const statusColors = {
      CANCELLED: { border: '#CBD5E1', bg: '#F8FAFC', text: '#475569' },
      NOT_PREPARED: { border: '#CBD5E1', bg: '#F8FAFC', text: '#475569' },
      PREPARING: { border: '#BFDBFE', bg: '#EFF6FF', text: '#1D4ED8' },
      READY: { border: '#BBF7D0', bg: '#F0FDF4', text: '#15803D' },
      RELEASED: { border: '#C4B5FD', bg: '#F5F3FF', text: '#6D28D9' },
      IN_PRODUCTION: { border: '#FDBA74', bg: '#FFF7ED', text: '#C2410C' },
      COMPLETED: { border: '#86EFAC', bg: '#F0FDF4', text: '#166534' },
    };

    let actionLine = 'Review this PPO.';
    if (lifecycleStatus === 'CANCELLED') actionLine = 'PPO cancelled. No production action required.';
    else if (lifecycleStatus === 'NOT_PREPARED') actionLine = 'No work orders yet — prepare production to begin.';
    else if (lifecycleStatus === 'PREPARING') actionLine = 'Work orders exist — check material readiness before release.';
    else if (lifecycleStatus === 'READY') actionLine = `${readyWos} work order${readyWos === 1 ? '' : 's'} ready for shop-floor release.`;
    else if (lifecycleStatus === 'RELEASED') actionLine = 'Work orders released — production has not started yet.';
    else if (lifecycleStatus === 'IN_PRODUCTION') actionLine = `${activeWos || 1} work order${(activeWos || 1) === 1 ? '' : 's'} active — production is running.`;
    else if (lifecycleStatus === 'COMPLETED') actionLine = 'All work orders complete. Nothing to do here.';

    const progressParts = [];
    if (totalWos > 0) progressParts.push(`${completedWos} of ${totalWos} WOs complete`);
    if (activeWos > 0) progressParts.push(`${activeWos} active`);
    if (releasedWos > 0 && activeWos === 0) progressParts.push(`${releasedWos} released`);
    if (readyWos > 0 && lifecycleStatus !== 'COMPLETED') progressParts.push(`${readyWos} ready`);
    if (blockedWos > 0 && lifecycleStatus !== 'COMPLETED') progressParts.push(`${blockedWos} blocked`);
    if (notCheckedWos > 0 && lifecycleStatus !== 'COMPLETED') progressParts.push(`${notCheckedWos} not checked`);
    if (summary.has_scrap_activity) progressParts.push(`${summary.scrap_wo_count || 0} scrap WOs`);

    if (lifecycleStatus === 'COMPLETED' && summary.actual_end_at) {
      progressParts.push(`finished ${fmtDateTime(summary.actual_end_at)}`);
    } else if (timelineSummary.tentative_completion_at) {
      progressParts.push(`est. finish ${fmtDateTime(timelineSummary.tentative_completion_at)}`);
    }

    const blockerLine = showBlocker
      ? `${rawBlocker.item_code || 'Material'} short by ${displayQty(rawBlocker.shortage, rawBlocker.uom)}${rawBlocker.blocked_wo_count > 1 ? ` across ${rawBlocker.blocked_wo_count} WOs` : ''}`
      : '';

    return {
      lifecycleStatus,
      nextAction,
      statusLabel: statusLabels[lifecycleStatus] || lifecycleStatus,
      actionLabel: actionLabels[nextAction] || '',
      actionLine,
      progressLine: progressParts.length ? progressParts.join(' · ') : 'No work order progress yet.',
      blocker: showBlocker ? rawBlocker : { present: false },
      blockerLine,
      colors: statusColors[lifecycleStatus] || statusColors.NOT_PREPARED,
    };
  }, [data, timelineSummary.tentative_completion_at]);

  function runDecisionAction() {
    if (!ppoDecision?.nextAction || ppoDecision.nextAction === 'NOTHING_REQUIRED') return;

    if (ppoDecision.nextAction === 'PREPARE_PRODUCTION') {
      prepareForReview();
      return;
    }

    if (ppoDecision.nextAction === 'CHECK_MATERIAL_READINESS') {
      checkWOReadiness();
      return;
    }

    if (ppoDecision.nextAction === 'REVIEW_MATERIAL_SHORTAGES') {
      setActiveTab('MATERIAL');
      return;
    }

    if (ppoDecision.nextAction === 'RELEASE_READY_WORK_ORDERS') {
      setActiveTab('WOS');
      setWoFilter('ALL');
      return;
    }

    if (ppoDecision.nextAction === 'OPEN_WORKER_DAILY_WORK') {
      router.push('/production-work');
      return;
    }

    if (ppoDecision.nextAction === 'VIEW_FINAL_PROGRESS') {
      setActiveTab('TIMELINE');
    }
  }

  const decisionActionDisabled =
    preparingWork ||
    syncing ||
    generatingWos ||
    checkingReadiness ||
    releasingReadyWos ||
    cancellingPpo;

  const isDecisionFinal = ['COMPLETED', 'CANCELLED'].includes(ppoDecision.lifecycleStatus);

  const tabs = [
    ['OVERVIEW', 'Overview'],
    ['MATERIAL', 'Material'],
    ['WOS', 'Work Orders'],
    ['TIMELINE', 'Timeline & Load'],
    ['PRESS', 'Press Plan'],
    ['DEPENDENCIES', 'Production Chain'],
  ];

  const filterButtons = [
    ['SUMMARY', 'Summary'],
    ['ALL', 'All'],
    ['MIXING', 'Mixing'],
    ['SHOT_BLASTING', 'Shot Blasting'],
    ['MOULDING', 'Moulding'],
    ['BLOCKED', 'Blocked'],
    ['PARTIAL', 'Partial'],
    ['READY', 'Ready'],
  ];

  if (loading) return <div style={S.page}>Loading PPO...</div>;
  if (!data) return <div style={S.page}>PPO not found.</div>;

  return (
    <div style={{...S.page, padding:'14px 18px'}}>
      <div style={{
        display:'flex',
        alignItems:'center',
        justifyContent:'space-between',
        gap:12,
        marginBottom:8
      }}>
        <div>
          <button style={{...S.back, marginBottom:4}} onClick={() => router.push('/production-plan-orders')}>
            ← Back
          </button>

          <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
            <h1 style={{...S.title, fontSize:24, lineHeight:'30px', margin:0}}>{data.ppo_number}</h1>
            <Badge value={data.plan_status} />
            <Badge value={data.material_status} />
            <Badge value={data.press_status} />
            <span style={{
              display:'inline-flex',
              alignItems:'center',
              height:24,
              padding:'0 8px',
              borderRadius:999,
              background:'#EEF2FF',
              color:'#003D9B',
              fontSize:11,
              fontWeight:900
            }}>
              {Number(data.total_qty_pcs || 0).toLocaleString()} PCS
            </span>
          </div>
        </div>

        {!isDecisionFinal && (
          <button
            style={{
              ...(preparingWork ? S.prepareBtnBusy : S.prepareBtn),
              padding:'10px 14px',
              borderRadius:10,
              fontSize:13
            }}
            onClick={prepareForReview}
            disabled={preparingWork || syncing || generatingWos || checkingReadiness || releasingReadyWos}
          >
            {preparingWork ? `Preparing... ${prepareProgress}%` : 'Prepare for Review'}
          </button>
        )}
      </div>

      <section style={{
        margin:'8px 0 10px',
        border:`1px solid ${ppoDecision.colors.border}`,
        background:ppoDecision.colors.bg,
        borderRadius:16,
        padding:14,
        boxShadow:'0 10px 24px rgba(15, 23, 42, 0.06)'
      }}>
        <div style={{display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start', flexWrap:'wrap'}}>
          <div style={{minWidth:260}}>
            <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
              <span style={{
                display:'inline-flex',
                alignItems:'center',
                border:`1px solid ${ppoDecision.colors.border}`,
                color:ppoDecision.colors.text,
                background:'#fff',
                borderRadius:999,
                padding:'4px 9px',
                fontSize:11,
                fontWeight:950,
                textTransform:'uppercase',
                letterSpacing:'0.04em'
              }}>
                {ppoDecision.statusLabel}
              </span>
              <span style={{fontSize:12, color:'#64748B', fontWeight:800}}>
                Decision-first view
              </span>
            </div>

            <div style={{fontSize:17, fontWeight:950, color:'#0F172A', marginTop:9}}>
              {ppoDecision.actionLine}
            </div>

            {ppoDecision.blocker.present && (
              <div style={{
                marginTop:8,
                color:'#9A3412',
                fontSize:13,
                fontWeight:900,
                background:'#FFFBEB',
                border:'1px solid #FED7AA',
                borderRadius:10,
                padding:'8px 10px'
              }}>
                ⚠ {ppoDecision.blockerLine}
              </div>
            )}

            <div style={{fontSize:13, color:'#475569', fontWeight:800, marginTop:8}}>
              {ppoDecision.progressLine}
            </div>
          </div>

          {ppoDecision.actionLabel && (
            <button
              style={{
                ...S.primaryBtn,
                background:ppoDecision.lifecycleStatus === 'COMPLETED' ? '#004AC6' : S.primaryBtn.background,
                opacity:decisionActionDisabled ? 0.6 : 1,
                cursor:decisionActionDisabled ? 'not-allowed' : 'pointer',
                minWidth:180
              }}
              disabled={decisionActionDisabled}
              onClick={runDecisionAction}
            >
              {ppoDecision.actionLabel}
            </button>
          )}
        </div>
      </section>

      {!isDecisionFinal && (
        <div style={{
        display:'flex',
        alignItems:'center',
        justifyContent:'space-between',
        gap:12,
        background:'#EEF6FF',
        border:'1px solid #BFDBFE',
        borderRadius:12,
        padding:'9px 12px',
        marginBottom:8
      }}>
        <div style={{fontSize:12, color:'#334155'}}>
          <b style={{color:'#041B3C'}}>Factory Preparation:</b>{' '}
          Sync recipe routings, generate missing stage WOs, and check start status before shop-floor release.
        </div>

        <div style={{display:'flex', gap:8, flexShrink:0}}>
          <button style={{...S.advancedToggle, height:30, padding:'0 10px'}} onClick={() => setShowAdvancedActions(v => !v)}>
            {showAdvancedActions ? 'Hide advanced' : 'Advanced'}
          </button>

          <button
            style={{...S.cancelPpoBtn, height:30, padding:'0 10px'}}
            onClick={cancelPPO}
            disabled={cancellingPpo || preparingWork || generatingWos || checkingReadiness || releasingReadyWos || data?.plan_status === 'CANCELLED'}
          >
            {cancellingPpo ? 'Cancelling...' : data?.plan_status === 'CANCELLED' ? 'PPO Cancelled' : 'Cancel'}
          </button>
        </div>
        </div>
      )}

      {!isDecisionFinal && preparingWork && (
        <div style={{...S.prepareProgressBox, margin:'6px 0 8px'}}>
          <div style={S.prepareProgressText}>{prepareMessage}</div>
          <div style={S.progressWrapWide}>
            <div style={{ ...S.progressBar, width: `${prepareProgress}%` }} />
          </div>
        </div>
      )}

      {!isDecisionFinal && showAdvancedActions && (
        <div style={{...S.actionRow, margin:'6px 0 8px'}}>
          <button style={S.secondaryBtn} onClick={syncRoutings} disabled={syncing || preparingWork}>
            {syncing ? 'Syncing...' : 'Sync Routings'}
          </button>

          <button style={{ ...S.secondaryBtn, borderColor: '#FED7AA', color: '#C2410C' }} onClick={checkWOReadiness} disabled={checkingReadiness || preparingWork}>
            {checkingReadiness ? `Checking... ${readinessProgress}%` : 'Check Start Status'}
          </button>

          <button style={{ ...S.secondaryBtn, borderColor: '#BBF7D0', color: '#15803D' }} onClick={generateWorkOrders} disabled={generatingWos || preparingWork}>
            {generatingWos ? `Generating... ${woProgress}%` : 'Generate WOs'}
          </button>

          <button
            style={{ ...S.secondaryBtn, borderColor: '#DDD6FE', color: '#6D28D9' }}
            onClick={() => { setActiveTab('WOS'); setWoFilter('ALL'); }}
          >
            Review Release WOs →
          </button>
        </div>
      )}

      {!isDecisionFinal && showAdvancedActions && generatingWos && (
        <div style={S.progressWrap}>
          <div style={{ ...S.progressBar, width: `${woProgress}%` }} />
        </div>
      )}

      {!isDecisionFinal && showAdvancedActions && checkingReadiness && (
        <div style={S.progressWrap}>
          <div style={{ ...S.progressBarOrange, width: `${readinessProgress}%` }} />
        </div>
      )}

      {!isDecisionFinal && (
        <div style={{
          display:'grid',
          gridTemplateColumns:'repeat(4, minmax(120px, 1fr))',
          gap:8,
          margin:'8px 0'
        }}>
          <div style={{...S.readyCard, padding:'9px 12px'}}><span>Ready to Start</span><strong>{readyCount}</strong></div>
          <div style={{...S.partialCard, padding:'9px 12px'}}><span>Partially Ready</span><strong>{partialCount}</strong></div>
          <div style={{...S.blockedCard, padding:'9px 12px'}}><span>Blocked</span><strong>{blockedCount}</strong></div>
          <div style={{...S.neutralCard, padding:'9px 12px'}}><span>Not Checked</span><strong>{notCheckedCount}</strong></div>
        </div>
      )}

      <div style={{...S.tabBar, margin:'8px 0 10px', padding:6}}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            style={activeTab === key ? S.tabBtnActive : S.tabBtn}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'OVERVIEW' && (
        <section style={S.card}>
          <h2 style={S.head}>PPO Lines</h2>
          <table style={S.table}>
            <thead>
              <tr>
                {['#', 'Item', 'Approved Qty', 'Production PCS', 'Status'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.lines || []).map(line => (
                <tr key={line.id}>
                  <td style={S.td}>{line.line_number}</td>
                  <td style={S.td}>{line.item_master?.item_code} — {line.item_master?.item_name}</td>
                  <td style={S.td}>{Number(line.approved_qty || 0).toLocaleString()} {line.uom_master?.uom_code || ''}</td>
                  <td style={S.td}>{Number(line.production_pcs || 0).toLocaleString()}</td>
                  <td style={S.td}>{line.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}



      {activeTab === 'MATERIAL' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <section style={S.card}>
            <h2 style={S.head}>Material / Start Plan</h2>

            <div style={{display:'grid', gridTemplateColumns:'repeat(4, minmax(160px, 1fr))', gap:10, padding:14}}>
              <div style={{border:'1px solid #BBF7D0', background:'#F0FDF4', borderRadius:12, padding:12}}>
                <div style={{fontSize:12, fontWeight:900, color:'#166534', textTransform:'uppercase'}}>Ready to Release</div>
                <div style={{fontSize:24, fontWeight:950, color:'#14532D', marginTop:4}}>{readyReleaseWos.length}</div>
                <div style={S.muted}>Ready / partial WOs can be released.</div>
              </div>

              <div style={{border:'1px solid #FED7AA', background:'#FFF7ED', borderRadius:12, padding:12}}>
                <div style={{fontSize:12, fontWeight:900, color:'#9A3412', textTransform:'uppercase'}}>Action Needed</div>
                <div style={{fontSize:24, fontWeight:950, color:'#7C2D12', marginTop:4}}>{actionNeededSummary.length}</div>
                <div style={S.muted}>Upstream production required.</div>
              </div>

              <div style={{border:'1px solid #BFDBFE', background:'#EFF6FF', borderRadius:12, padding:12}}>
                <div style={{fontSize:12, fontWeight:900, color:'#1D4ED8', textTransform:'uppercase'}}>Purchase Shortage</div>
                <div style={{fontSize:24, fontWeight:950, color:'#1E3A8A', marginTop:4}}>{rawMaterialSummary.length}</div>
                <div style={S.muted}>RM/BP purchase shortage only.</div>
              </div>

              <div style={{border:'1px solid #E5E7EB', background:'#F8FAFC', borderRadius:12, padding:12}}>
                <div style={{fontSize:12, fontWeight:900, color:'#475569', textTransform:'uppercase'}}>Waiting Previous Stage</div>
                <div style={{fontSize:24, fontWeight:950, color:'#0F172A', marginTop:4}}>{waitingPreviousStageWoCount}</div>
                <div style={S.muted}>Will unlock after earlier WOs output stock.</div>
              </div>
            </div>

            <div style={{display:'flex', gap:10, padding:'0 14px 14px'}}>
              <button
                style={{...S.secondaryBtn, borderColor:'#BBF7D0', color:'#166534'}}
                onClick={() => { setActiveTab('WOS'); setWoFilter('READY'); }}
              >
                View Ready WOs
              </button>

              <button
                style={{...S.secondaryBtn, borderColor:'#BBF7D0', color:'#166534'}}
                onClick={() => { setActiveTab('WOS'); setWoFilter('ALL'); }}
              >
                Review Work Orders →
              </button>
            </div>
          </section>

          <section style={S.card}>
            <h2 style={S.head}>Action Needed — Upstream Production</h2>
            <table style={S.table}>
              <thead>
                <tr>
                  {['Item', 'Required', 'Available', 'Shortage', 'Used In WOs', 'Action'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {actionNeededSummary.map(row => (
                  <tr key={row.code}>
                    <td style={S.td}>
                      <strong>{row.code}</strong>
                      <div style={S.muted}>{row.name}</div>
                    </td>
                    <td style={S.td}>{displayQty(row.required, row.uom)}</td>
                    <td style={S.td}>{displayQty(row.available, row.uom)}</td>
                    <td style={S.td}>
                      <strong style={{ color:'#B91C1C' }}>{displayQty(row.shortage, row.uom)}</strong>
                    </td>
                    <td style={S.td}>{row.woCount}</td>
                    <td style={S.td}>
                      <button
                        style={{...S.secondaryBtn, borderColor:'#FED7AA', color:'#9A3412'}}
                        disabled={creatingMixPlanCode === row.code}
                        onClick={() => createMixPlan(row)}
                      >
                        {creatingMixPlanCode === row.code ? 'Creating...' : `Create ${upstreamPlanLabel(row)}`}
                      </button>
                    </td>
                  </tr>
                ))}

                {!actionNeededSummary.length && (
                  <tr>
                    <td style={S.td} colSpan={6}>No upstream production action needed.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section style={S.card}>
            <h2 style={S.head}>Purchase Shortage</h2>
            <table style={S.table}>
              <thead>
                <tr>
                  {['Input Item', 'Required', 'Available', 'Shortage', 'Used In WOs', 'Status'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawMaterialSummary.map(row => (
                  <tr key={row.code}>
                    <td style={S.td}>
                      <strong>{row.code}</strong>
                      <div style={S.muted}>{row.name}</div>
                    </td>
                    <td style={S.td}>{displayQty(row.required, row.uom)}</td>
                    <td style={S.td}>{displayQty(row.available, row.uom)}</td>
                    <td style={S.td}>
                      <strong style={{ color:'#B91C1C' }}>{displayQty(row.shortage, row.uom)}</strong>
                    </td>
                    <td style={S.td}>{row.woCount}</td>
                    <td style={S.td}><Badge value="BLOCKED" /></td>
                  </tr>
                ))}

                {!rawMaterialSummary.length && (
                  <tr>
                    <td style={S.td} colSpan={6}>No purchase shortage.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section style={S.card}>
            <h2 style={S.head}>Waiting for Previous Stage</h2>
            <div style={{padding:14, color:'#475569', fontSize:13}}>
              {waitingPreviousStageWoCount
                ? `${waitingPreviousStageWoCount} WOs are waiting for previous process output. They will become ready after earlier WOs are completed and stock is posted.`
                : 'No WOs are waiting for previous stage output.'}
            </div>
            <div style={{padding:'0 14px 14px'}}>
              <button
                style={S.secondaryBtn}
                onClick={() => { setActiveTab('WOS'); setWoFilter('BLOCKED'); }}
              >
                View Details
              </button>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'WOS' && (
        <section style={S.card}>
          <h2 style={S.head}>Release Review — Generated Work Orders</h2>
          <div style={S.sub}>Review start status before releasing. READY/PARTIAL can be released manually; BLOCKED stays held.</div>

          <div style={S.filterBar}>
            {filterButtons.map(([key, label]) => (
              <button
                key={key}
                style={woFilter === key ? S.filterBtnActive : S.filterBtn}
                onClick={() => setWoFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* PPO release workspace: Work Orders tab owns release */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0', flexWrap: 'wrap' }}>
            <button
              style={{ ...S.prepareBtn, padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: selectedWoIds.length ? 1 : 0.5 }}
              disabled={!selectedWoIds.length || releasingReadyWos}
              onClick={() => releaseReadyWorkOrders()}
            >
              {releasingReadyWos ? 'Releasing...' : `Release Selected (${selectedWoIds.length})`}
            </button>

            {(data?.work_orders || []).some(
              wo => String(wo.status || '').toLowerCase() === 'released'
            ) && (
              <button
                style={{ ...S.secondaryBtn, borderColor: '#BBF7D0', color: '#15803D' }}
                onClick={() => router.push('/production-work')}
              >
                Go to Production Control →
              </button>
            )}

            <span style={{ fontSize: 12, color: '#6B7280' }}>
              READY/PARTIAL can be released; BLOCKED stays held.
            </span>
          </div>

          {woFilter === 'SUMMARY' && (
            <table style={S.table}>
              <thead>
                <tr>
                  {['Process', 'WO Count', 'Planned Qty', 'Ready', 'Partial', 'Blocked', 'Not Checked'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {processSummary.map(row => (
                  <tr key={row.key}>
                    <td style={S.td}>{row.process}</td>
                    <td style={S.td}>{row.count}</td>
                    <td style={S.td}>{Number(row.planned || 0).toLocaleString()}</td>
                    <td style={S.td}>{row.ready}</td>
                    <td style={S.td}>{row.partial}</td>
                    <td style={S.td}>{row.blocked}</td>
                    <td style={S.td}>{row.not_checked}</td>
                  </tr>
                ))}
                {!processSummary.length && (
                  <tr><td style={S.td} colSpan={7}>No Work Orders generated yet.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {woFilter !== 'SUMMARY' && (
            <table style={S.table}>
              <thead>
                <tr>
                  {['Select', 'WO', 'Process', 'Item', 'Planned', 'Ready Qty', 'Blocked', 'Start Status', 'Hold / Block Reason', 'Action'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedFilteredWorkOrders.flatMap(group => [
                  <tr key={`${group.key}-group`} style={S.reviewGroupRow}>
                    <td style={S.td} colSpan={10}>
                      <strong>{group.process}</strong>
                      <span style={S.reviewGroupMeta}>{group.rows.length} WOs to review</span>
                    </td>
                  </tr>,
                  ...group.rows.map(wo => (
                    <tr key={wo.id}>
                      <td style={S.td}>
                        <input
                          type="checkbox"
                          checked={selectedWoIds.includes(wo.id)}
                          disabled={!isReleasableWo(wo)}
                          onChange={e => setSelectedWoIds(e.target.checked ? [...selectedWoIds, wo.id] : selectedWoIds.filter(id => id !== wo.id))}
                        />
                      </td>
                      <td style={S.td}>
                        <button onClick={() => router.push(`/work-orders/${wo.id}`)}
                          style={{ border: 'none', background: 'transparent', color: '#2563EB', fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                          {wo.wo_number}
                        </button>
                      </td>
                      <td style={S.td}>{wo.process?.type_name || wo.process?.type_code || '—'}</td>
                      <td style={S.td}>{wo.item?.item_code}</td>
                      <td style={S.td}>{Number(wo.planned_qty || 0).toLocaleString()}</td>
                      <td style={S.td}>{Number(wo.ready_to_start_qty || 0).toLocaleString()}</td>
                      <td style={S.td}>{Number(wo.blocked_qty || 0).toLocaleString()}</td>
                      <td style={S.td}><Badge value={wo.readiness_status} /></td>
                      <td style={S.td}>
                        {String(wo.readiness_status || '').toUpperCase() === 'READY' || Number(wo.blocked_qty || 0) <= 0
                          ? 'Inputs available'
                          : (wo.block_reason || '—')}
                      </td>
                      <td style={S.td}>
                        {isReleasableWo(wo) ? (
                          <button
                            onClick={() => releaseReadyWorkOrders([wo.id])}
                            disabled={releasingReadyWos}
                            style={{ ...S.prepareBtn, padding: '5px 10px', borderRadius: 8, fontSize: 12 }}
                          >
                            Release
                          </button>
                        ) : String(wo.status || '').toLowerCase() === 'released' ? (
                          <button
                            onClick={() => router.push('/production-work')}
                            style={{ border: 'none', background: 'transparent', color: '#15803D', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                          >
                            Go to Production Control →
                          </button>
                        ) : String(wo.readiness_status || '').toUpperCase() === 'BLOCKED' ? (
                          <span style={{ color: '#B45309', fontWeight: 600, fontSize: 12 }}>
                            Held — Fix Material
                          </span>
                        ) : (
                          <span style={{ color: '#9CA3AF' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))
                ])}
                {!filteredWorkOrders.length && (
                  <tr><td style={S.td} colSpan={10}>No review rows for this filter.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </section>
      )}

      {activeTab === 'TIMELINE' && (
        <section style={S.card}>
          <div style={{padding:14, borderBottom:'1px solid #E2E8F0', display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start', flexWrap:'wrap'}}>
            <div>
              <h2 style={{...S.head, padding:0, borderBottom:0}}>Timeline & Load</h2>
              <div style={S.sub}>Current progress plus tentative/expected production load from generated Work Orders.</div>
            </div>
            <button style={S.secondaryBtn} disabled={timelineLoading} onClick={loadTimeline}>
              {timelineLoading ? 'Refreshing...' : 'Refresh Timeline'}
            </button>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'repeat(5, minmax(150px, 1fr))', gap:10, padding:14}}>
            <div style={S.neutralCard}><span>Total WOs</span><strong>{fmtNum(timelineSummary.total_wos, 0)}</strong></div>
            <div style={S.readyCard}><span>Completed</span><strong>{fmtNum(timelineSummary.completed_wos, 0)}</strong></div>
            <div style={S.partialCard}><span>Running</span><strong>{fmtNum(timelineSummary.running_wos, 0)}</strong></div>
            <div style={S.blockedCard}><span>Blocked</span><strong>{fmtNum(timelineSummary.blocked_wos, 0)}</strong></div>
            <div style={S.neutralCard}><span>Capacity Missing</span><strong>{fmtNum(timelineSummary.capacity_missing_count, 0)}</strong></div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'repeat(4, minmax(180px, 1fr))', gap:10, padding:'0 14px 14px'}}>
            <div style={S.neutralCard}><span>Planned Qty</span><strong>{fmtNum(timelineSummary.total_planned_qty)}</strong></div>
            <div style={S.readyCard}><span>Completed Qty</span><strong>{fmtNum(timelineSummary.total_completed_qty)}</strong></div>
            <div style={S.partialCard}><span>Balance Qty</span><strong>{fmtNum(timelineSummary.total_balance_qty)}</strong></div>
            <div style={S.neutralCard}><span>Tentative Completion</span><strong style={{fontSize:13}}>{fmtDateTime(timelineSummary.tentative_completion_at)}</strong></div>
          </div>

          {timelineError && (
            <div style={{margin:'0 14px 14px', padding:12, border:'1px solid #FCA5A5', background:'#FEF2F2', color:'#991B1B', borderRadius:12, fontSize:13, fontWeight:800}}>
              {timelineError}
            </div>
          )}

          <div style={{overflowX:'auto'}}>
            <table style={S.table}>
              <thead>
                <tr>
                  {['WO', 'Item', 'Process', 'Planned', 'Completed', 'Balance', 'Progress', 'Status', 'Readiness', 'Worker / Machine', 'Timeline Note'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timelineLoading && (
                  <tr><td style={S.td} colSpan={11}>Loading Timeline & Load...</td></tr>
                )}

                {!timelineLoading && !timelineRows.length && (
                  <tr><td style={S.td} colSpan={11}>No Timeline & Load rows found for this PPO.</td></tr>
                )}

                {!timelineLoading && timelineRows.map(row => (
                  <tr key={row.wo_id || row.wo_number}>
                    <td style={S.td}><strong>{row.wo_number || '—'}</strong></td>
                    <td style={S.td}>
                      <strong>{row.item_code || row.stage_output_item_code || '—'}</strong>
                      <div style={S.muted}>{row.item_name || ''}</div>
                    </td>
                    <td style={S.td}>{row.process_name || row.process_code || '—'}</td>
                    <td style={S.td}>{fmtNum(row.planned_qty)}</td>
                    <td style={S.td}>{fmtNum(row.completed_qty)}</td>
                    <td style={S.td}>{fmtNum(row.balance_qty)}</td>
                    <td style={S.td}>
                      <strong>{fmtNum(row.progress_pct, 0)}%</strong>
                      <div style={{height:7, background:'#E2E8F0', borderRadius:999, overflow:'hidden', marginTop:6, minWidth:80}}>
                        <div style={{height:'100%', width:`${Math.max(0, Math.min(100, Number(row.progress_pct || 0)))}%`, background:'#004AC6'}} />
                      </div>
                    </td>
                    <td style={S.td}>{row.status || '—'}</td>
                    <td style={S.td}><Badge value={row.readiness_status} /></td>
                    <td style={S.td}>
                      <div>{row.assigned_worker_name || row.assigned_worker_code || 'No worker'}</div>
                      <div style={S.muted}>{row.assigned_machine_name || row.assigned_machine_code || 'No machine'}</div>
                    </td>
                    <td style={S.td}>
                      <strong>{row.tentative_note || '—'}</strong>
                      {row.risk_note && <div style={{...S.muted, color:'#B45309'}}>{row.risk_note}</div>}
                      <div style={S.muted}>Expected: {fmtDateTime(row.tentative_start_at)} → {fmtDateTime(row.tentative_end_at)}</div>
                      <div style={S.muted}>Actual: {fmtDateTime(row.actual_start_at)} → {fmtDateTime(row.actual_end_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'PRESS' && (
        <section style={S.card}>
          <h2 style={S.head}>Press Slots</h2>
          <table style={S.table}>
            <thead>
              <tr>
                {['Press', 'Slot', 'Seq', 'Item', 'Qty', 'PCS', 'Cavity', 'Runtime Hrs'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.press_slots || []).map(slot => (
                <tr key={slot.id}>
                  <td style={S.td}>{slot.press_code}</td>
                  <td style={S.td}>{slot.slot_code}</td>
                  <td style={S.td}>{slot.sequence_no}</td>
                  <td style={S.td}>{slot.item_master?.item_code}</td>
                  <td style={S.td}>{Number(slot.planned_qty || 0).toLocaleString()}</td>
                  <td style={S.td}>{Number(slot.production_pcs || 0).toLocaleString()}</td>
                  <td style={S.td}>{slot.cavity || '—'}</td>
                  <td style={S.td}>{slot.runtime_hours || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === 'DEPENDENCIES' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <section style={S.card}>
            <h2 style={S.head}>Production Chain</h2>
            <div style={{padding:14, color:'#475569', fontSize:13}}>
              This shows the current PPO item and the next blockers in the manufacturing chain.
            </div>

            <table style={S.table}>
              <thead>
                <tr>
                  {['Level', 'Item / Plan', 'Required', 'Available', 'Shortage', 'Status', 'Action'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.lines || []).map(line => (
                  <tr key={line.id}>
                    <td style={S.td}><strong>Current PPO</strong></td>
                    <td style={S.td}>
                      <strong>{line.item_master?.item_code}</strong>
                      <div style={S.muted}>{line.item_master?.item_name}</div>
                    </td>
                    <td style={S.td}>
                      {Number(line.approved_qty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} {line.uom_master?.uom_code || ''}
                    </td>
                    <td style={S.td}>—</td>
                    <td style={S.td}>—</td>
                    <td style={S.td}><Badge value={line.status || data.plan_status} /></td>
                    <td style={S.td}>
                      <button style={S.secondaryBtn} onClick={() => setActiveTab('WOS')}>
                        View WOs
                      </button>
                    </td>
                  </tr>
                ))}

                {actionNeededSummary.map(row => (
                  <tr key={`chain-action-${row.code}`}>
                    <td style={S.td}><strong>Upstream SFG</strong></td>
                    <td style={S.td}>
                      <strong>{row.code}</strong>
                      <div style={S.muted}>{row.name}</div>
                    </td>
                    <td style={S.td}>{displayQty(row.required, row.uom)}</td>
                    <td style={S.td}>{displayQty(row.available, row.uom)}</td>
                    <td style={S.td}>
                      <strong style={{color:'#B91C1C'}}>{displayQty(row.shortage, row.uom)}</strong>
                    </td>
                    <td style={S.td}><Badge value="BLOCKED" /></td>
                    <td style={S.td}>
                      <button
                        style={{...S.secondaryBtn, borderColor:'#FED7AA', color:'#9A3412'}}
                        disabled={creatingMixPlanCode === row.code}
                        onClick={() => createMixPlan(row)}
                      >
                        {creatingMixPlanCode === row.code ? 'Creating...' : `Create ${upstreamPlanLabel(row)}`}
                      </button>
                    </td>
                  </tr>
                ))}

                {rawMaterialSummary.map(row => (
                  <tr key={`chain-rm-${row.code}`}>
                    <td style={S.td}><strong>Purchase / RM</strong></td>
                    <td style={S.td}>
                      <strong>{row.code}</strong>
                      <div style={S.muted}>{row.name}</div>
                    </td>
                    <td style={S.td}>{displayQty(row.required, row.uom)}</td>
                    <td style={S.td}>{displayQty(row.available, row.uom)}</td>
                    <td style={S.td}>
                      <strong style={{color:'#B91C1C'}}>{displayQty(row.shortage, row.uom)}</strong>
                    </td>
                    <td style={S.td}><Badge value="PURCHASE NEEDED" /></td>
                    <td style={S.td}>Purchase action</td>
                  </tr>
                ))}

                {!actionNeededSummary.length && !rawMaterialSummary.length && (
                  <tr>
                    <td style={S.td} colSpan={7}>No upstream or purchase blocker found for this PPO.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}

const S = {
  page: {
    padding: 24,
    background: '#F7F9FC',
    minHeight: '100vh',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    color: '#0F172A',
  },
  back: {
    border: 0,
    background: 'transparent',
    color: '#64748B',
    cursor: 'pointer',
    marginBottom: 10,
    fontSize: 13,
  },
  title: {
    margin: 0,
    fontSize: 30,
    fontWeight: 950,
    letterSpacing: '-0.03em',
  },
  sub: {
    margin: '6px 0 0',
    color: '#64748B',
    fontSize: 14,
  },
  preparePanel: {
    margin: '18px 0 10px',
    background: '#EEF6FF',
    border: '1px solid #BFDBFE',
    borderRadius: 18,
    padding: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
  },
  prepareTitle: {
    fontSize: 16,
    fontWeight: 950,
    color: '#0F172A',
    marginBottom: 4,
  },
  prepareSub: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 1.45,
    maxWidth: 860,
  },
  prepareBtn: {
    border: 0,
    background: '#16A34A',
    color: '#fff',
    borderRadius: 14,
    padding: '14px 20px',
    fontWeight: 950,
    cursor: 'pointer',
    fontSize: 15,
    whiteSpace: 'nowrap',
    boxShadow: '0 8px 18px rgba(22, 163, 74, 0.24)',
  },
  prepareBtnBusy: {
    border: 0,
    background: '#64748B',
    color: '#fff',
    borderRadius: 14,
    padding: '14px 20px',
    fontWeight: 950,
    cursor: 'not-allowed',
    fontSize: 15,
    whiteSpace: 'nowrap',
  },
  prepareProgressBox: {
    margin: '0 0 12px',
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 14,
    padding: 12,
  },
  prepareProgressText: {
    fontSize: 13,
    fontWeight: 800,
    color: '#334155',
    marginBottom: 8,
  },
  advancedWrap: {
    margin: '0 0 16px',
  },
  advancedButtonRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  cancelPpoBtn: {
    border: '1px solid #FCA5A5',
    background: '#fff',
    color: '#B91C1C',
    borderRadius: 999,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  advancedToggle: {
    border: '1px solid #CBD5E1',
    background: '#fff',
    color: '#475569',
    borderRadius: 999,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  actionRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    alignItems: 'center',
    margin: '14px 0 16px',
  },
  primaryBtn: {
    border: 0,
    background: '#004AC6',
    color: '#fff',
    borderRadius: 10,
    padding: '11px 15px',
    fontWeight: 900,
    cursor: 'pointer',
    fontSize: 13,
  },
  secondaryBtn: {
    border: '1px solid #CBD5E1',
    background: '#fff',
    color: '#334155',
    borderRadius: 10,
    padding: '10px 13px',
    fontWeight: 900,
    cursor: 'pointer',
    fontSize: 12,
  },
  progressWrap: {
    width: 280,
    height: 8,
    background: '#E2E8F0',
    borderRadius: 999,
    overflow: 'hidden',
    margin: '0 0 16px',
  },
  progressWrapWide: {
    width: '100%',
    height: 9,
    background: '#E2E8F0',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: '#16A34A',
    transition: 'width 0.25s ease',
  },
  progressBarOrange: {
    height: '100%',
    background: '#F97316',
    transition: 'width 0.25s ease',
  },
  kpis: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 16,
  },
  kpi: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 14,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  readinessGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 16,
  },
  readyCard: {
    background: '#ECFDF5',
    border: '1px solid #86EFAC',
    borderRadius: 14,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    color: '#166534',
  },
  partialCard: {
    background: '#FFFBEB',
    border: '1px solid #FCD34D',
    borderRadius: 14,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    color: '#92400E',
  },
  blockedCard: {
    background: '#FEF2F2',
    border: '1px solid #FCA5A5',
    borderRadius: 14,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    color: '#991B1B',
  },
  neutralCard: {
    background: '#F8FAFC',
    border: '1px solid #CBD5E1',
    borderRadius: 14,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    color: '#475569',
  },
  reviewGroupRow: {
    background: '#F8FAFC',
  },
  reviewGroupMeta: {
    marginLeft: 10,
    color: '#64748B',
    fontSize: 12,
    fontWeight: 700,
  },
  tabBar: {
    display: 'flex',
    gap: 10,
    marginBottom: 16,
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 14,
    padding: 8,
  },
  tabBtn: {
    border: 0,
    background: 'transparent',
    color: '#64748B',
    borderRadius: 10,
    padding: '9px 13px',
    fontWeight: 900,
    cursor: 'pointer',
  },
  tabBtnActive: {
    border: 0,
    background: '#EFF6FF',
    color: '#004AC6',
    borderRadius: 10,
    padding: '9px 13px',
    fontWeight: 950,
    cursor: 'pointer',
  },
  card: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  head: {
    fontSize: 16,
    fontWeight: 900,
    margin: 0,
    padding: 14,
    borderBottom: '1px solid #E2E8F0',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    textAlign: 'left',
    fontSize: 12,
    color: '#64748B',
    padding: '10px 14px',
    borderBottom: '1px solid #E2E8F0',
    background: '#F8FAFC',
  },
  td: {
    fontSize: 13,
    padding: '10px 14px',
    borderBottom: '1px solid #EEF2F7',
  },
  filterBar: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    padding: '12px 14px',
    borderBottom: '1px solid #E2E8F0',
    background: '#F8FAFC',
  },
  filterBtn: {
    border: '1px solid #CBD5E1',
    background: '#fff',
    color: '#475569',
    borderRadius: 999,
    padding: '7px 11px',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
  },
  filterBtnActive: {
    border: '1px solid #004AC6',
    background: '#EFF6FF',
    color: '#004AC6',
    borderRadius: 999,
    padding: '7px 11px',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  badgeReady: {
    background: '#DCFCE7',
    color: '#166534',
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 900,
  },
  badgePartial: {
    background: '#FEF3C7',
    color: '#92400E',
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 900,
  },
  badgeBlocked: {
    background: '#FEE2E2',
    color: '#991B1B',
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 900,
  },
  badgeNeutral: {
    background: '#E2E8F0',
    color: '#475569',
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 900,
  },
  depListCompact: {
    padding: 14,
    display: 'grid',
    gap: 10,
  },
  depCompactCard: {
    border: '1px solid #E2E8F0',
    borderRadius: 14,
    background: '#F8FAFC',
    overflow: 'hidden',
  },
  depCompactHead: {
    width: '100%',
    border: 0,
    background: 'transparent',
    padding: 14,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    textAlign: 'left',
  },
  depGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 12,
    padding: 14,
  },
  depColTitle: {
    fontSize: 12,
    fontWeight: 900,
    color: '#475569',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  depEmpty: {
    fontSize: 12,
    color: '#94A3B8',
    padding: 8,
  },
  stepPill: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    fontSize: 12,
  },
  stepPillHot: {
    background: '#ECFDF5',
    border: '1px solid #86EFAC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    fontSize: 12,
  },
};
