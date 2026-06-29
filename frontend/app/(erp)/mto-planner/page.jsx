'use client';

/**
 * CERADRIVE ERP — MTO Planner (Phase 1, READ-ONLY).
 * Order-card based: one card per sales order (customer/order lot), item lines inside
 * with independent readiness. Guidance worklist — no writes, no Plan Now yet.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';

const TH = {
  primary: '#D42020',
  text: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  bg: '#F8FAFC',
  card: '#FFFFFF',
};

const STATUS_STYLE = {
  'Plan Now': { fg: '#15803D', bg: '#DCFCE7' },
  Partial: { fg: '#B45309', bg: '#FEF3C7' },
  Blocked: { fg: '#B91C1C', bg: '#FEE2E2' },
  Done: { fg: '#475569', bg: '#F1F5F9' },
};

const CARD_STYLE = {
  ATTENTION: { fg: '#15803D', bg: '#DCFCE7', label: 'Needs attention' },
  BLOCKED: { fg: '#B91C1C', bg: '#FEE2E2', label: 'Blocked' },
  DONE: { fg: '#475569', bg: '#F1F5F9', label: 'Done' },
};

const PRIORITY_RANK = { HIGH: 0, MED: 1, LOW: 2 };
const PRIORITY_STYLE = {
  HIGH: { fg: '#B91C1C', bg: '#FEE2E2' },
  MED: { fg: '#475569', bg: '#F1F5F9' },
  LOW: { fg: '#64748B', bg: '#F8FAFC' },
};

function Pill({ text, fg, bg }) {
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, color: fg, background: bg, border: `1px solid ${TH.border}`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{text}</span>
  );
}

function Chip({ text }) {
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: TH.muted, background: '#fff', border: `1px solid ${TH.border}`, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>{text}</span>
  );
}

function formatQtyValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);
}

function qtyDisplayParts(line, value, opts = {}) {
  const n = Number(value);
  const qty = Number.isFinite(n) ? n : 0;
  const salesUom = String(line?.sales_uom || line?.order_uom || '').toUpperCase();
  const productionUom = String(line?.production_uom || 'PCS').toUpperCase();
  const pcsPerSet = Number(line?.pcs_per_set);
  const hasSetRatio = Number.isFinite(pcsPerSet) && pcsPerSet > 1;

  if (opts.kind === 'order' && salesUom === 'SET') {
    const pcs = Number(line?.converted_pcs);
    return {
      primary: `${formatQtyValue(qty)} SETS`,
      secondary: Number.isFinite(pcs) ? `${formatQtyValue(pcs)} ${productionUom || 'PCS'}` : null,
    };
  }

  if (hasSetRatio && productionUom === 'PCS') {
    return {
      primary: `${formatQtyValue(qty / pcsPerSet)} SETS`,
      secondary: `${formatQtyValue(qty)} PCS`,
    };
  }

  return {
    primary: `${formatQtyValue(qty)} ${opts.uom || line?.order_uom || productionUom || ''}`.trim(),
    secondary: null,
  };
}

function QtyMetric({ label, value, line, kind, strong = false }) {
  const parts = qtyDisplayParts(line, value, { kind });
  return (
    <div style={{ textAlign: 'right', minWidth: 64 }}>
      <div style={{ color: TH.muted, fontSize: 10, fontWeight: 700 }}>{label}</div>
      <div style={{ fontWeight: strong ? 900 : 700, color: TH.text }}>{parts.primary}</div>
      {parts.secondary ? <div style={{ fontSize: 10, color: TH.muted, fontWeight: 700 }}>{parts.secondary}</div> : null}
    </div>
  );
}

function QtyInline({ value, line, kind }) {
  const parts = qtyDisplayParts(line, value, { kind });
  return `${parts.primary}${parts.secondary ? ` / ${parts.secondary}` : ''}`;
}

export default function MtoPlannerPage() {
  const [orders, setOrders] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [priority, setPriority] = useState({}); // so_id -> HIGH/MED/LOW (client-only)
  const [flatView, setFlatView] = useState(false);
  const [planningLine, setPlanningLine] = useState('');

  const loadWorklist = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get('/api/v1/mto-planner/worklist');
    if (error) {
      setErr(error.message ?? 'Failed to load MTO worklist.');
      setOrders([]);
    } else {
      setOrders(data?.orders ?? []);
      setGeneratedAt(data?.generated_at ?? null);
      setErr('');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadWorklist();
  }, [loadWorklist]);

  const setPrio = (soId, val) => setPriority((p) => ({ ...p, [soId]: val }));

  const handlePlanNow = async (line) => {
    if (!line?.so_line_id || line.status !== 'Plan Now') return;
    const ok = window.confirm(`Create PPO for ${line.fg_item_code || 'this item'} qty ${line.ready_qty || line.balance}?`);
    if (!ok) return;

    setPlanningLine(line.so_line_id);
    const { data, error } = await api.post('/api/v1/mto-planner/plan-now', {
      so_line_id: line.so_line_id,
      plan_qty: line.ready_qty || line.balance,
    });

    if (error) {
      window.alert(error.message || 'Failed to create MTO plan.');
      setPlanningLine('');
      return;
    }

    await loadWorklist();
    setPlanningLine('');
    window.alert(`PPO created: ${data?.ppo?.ppo_number || 'success'}`);
  };
  const prioOf = (o) => priority[o.so_id] ?? o.priority ?? 'MED';

  const sortedOrders = useMemo(() => {
    const CARD_RANK = { ATTENTION: 0, BLOCKED: 1, DONE: 2 };
    return [...orders].sort((a, b) => {
      const pr = PRIORITY_RANK[prioOf(a)] - PRIORITY_RANK[prioOf(b)];
      if (pr) return pr;
      const cr = CARD_RANK[a.card_status] - CARD_RANK[b.card_status];
      if (cr) return cr;
      if (a.due_soon !== b.due_soon) return a.due_soon ? -1 : 1;
      const ad = a.delivery_date || '9999-12-31';
      const bd = b.delivery_date || '9999-12-31';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return String(a.so_number).localeCompare(String(b.so_number));
    });
  }, [orders, priority]);

  const flatLines = useMemo(() => {
    const rows = [];
    for (const o of sortedOrders) for (const l of o.lines) rows.push({ o, l });
    return rows;
  }, [sortedOrders]);

  const totals = useMemo(() => {
    let ready = 0, partial = 0, blocked = 0, lines = 0;
    for (const o of orders) {
      ready += o.summary?.ready || 0;
      partial += o.summary?.partial || 0;
      blocked += o.summary?.blocked || 0;
      lines += o.summary?.total_lines || 0;
    }
    return { ready, partial, blocked, lines, orders: orders.length };
  }, [orders]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: TH.text, margin: 0 }}>MTO Planner</h1>
          <div style={{ fontSize: 13, color: TH.muted, marginTop: 4 }}>Sales-order fulfilment worklist. Read-only guidance — what to plan, what is blocked, what is already covered.</div>
        </div>
        <button type="button" onClick={() => setFlatView((v) => !v)} style={{ height: 34, padding: '0 14px', border: `1px solid ${TH.border}`, borderRadius: 6, background: '#fff', color: TH.text, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>{flatView ? 'Order cards' : 'All lines'}</button>
      </div>

      {!loading && !err && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 18px' }}>
          <Chip text={`${totals.orders} orders`} />
          <Chip text={`${totals.lines} lines`} />
          <Pill text={`${totals.ready} plan now`} fg={STATUS_STYLE['Plan Now'].fg} bg={STATUS_STYLE['Plan Now'].bg} />
          <Pill text={`${totals.partial} partial`} fg={STATUS_STYLE.Partial.fg} bg={STATUS_STYLE.Partial.bg} />
          <Pill text={`${totals.blocked} blocked`} fg={STATUS_STYLE.Blocked.fg} bg={STATUS_STYLE.Blocked.bg} />
          {generatedAt && <span style={{ fontSize: 11, color: TH.muted, alignSelf: 'center' }}>as of {new Date(generatedAt).toLocaleString()}</span>}
        </div>
      )}

      {loading && <div style={{ padding: 40, color: TH.muted, fontSize: 14 }}>Loading worklist…</div>}
      {err && !loading && <div style={{ padding: 16, color: '#B91C1C', background: '#FEE2E2', border: `1px solid ${TH.border}`, borderRadius: 8, fontSize: 14 }}>{err}</div>}
      {!loading && !err && orders.length === 0 && <div style={{ padding: 40, color: TH.muted, fontSize: 14 }}>No open sales orders to plan.</div>}

      {!loading && !err && !flatView && sortedOrders.map((o) => {
        const cs = CARD_STYLE[o.card_status] || CARD_STYLE.DONE;
        const prio = prioOf(o);
        return (
          <div key={o.so_id} style={{ background: TH.card, border: `1px solid ${TH.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: TH.text }}>{o.customer_name || 'Customer'} — {o.so_number}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                  <Pill text={cs.label} fg={cs.fg} bg={cs.bg} />
                  {o.due_soon && <Pill text="Due soon" fg="#B45309" bg="#FEF3C7" />}
                  {o.delivery_date && <Chip text={`Delivery ${o.delivery_date}`} />}
                  {o.credit_days != null && <Chip text={`Credit days: ${o.credit_days}`} />}
                  <Chip text={o.lot_label || 'Customer lot'} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: TH.muted, fontWeight: 700 }}>Priority</span>
                {['HIGH', 'MED', 'LOW'].map((p) => {
                  const active = prio === p;
                  const st = PRIORITY_STYLE[p];
                  return (
                    <button key={p} type="button" onClick={() => setPrio(o.so_id, p)} style={{ height: 28, padding: '0 10px', border: `1px solid ${active ? st.fg : TH.border}`, borderRadius: 6, background: active ? st.bg : '#fff', color: active ? st.fg : TH.muted, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>{p}</button>
                  );
                })}
              </div>
            </div>

            <div style={{ fontSize: 12, color: TH.muted, margin: '12px 0 6px', fontWeight: 700 }}>
              {o.summary?.ready_lines ?? o.summary?.ready ?? 0} ready · {o.summary?.blocked_lines ?? o.summary?.blocked ?? 0} blocked · {o.summary?.in_production_lines ?? 0} in-production · {o.summary?.ready_for_dispatch_lines ?? 0} ready-to-dispatch · {o.summary?.total_lines || 0} lines · {o.summary?.fulfillment_pct ?? 0}% filled
            </div>

            <div style={{ border: `1px solid ${TH.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {o.lines.map((l, idx) => {
                const ss = STATUS_STYLE[l.status] || STATUS_STYLE.Done;
                return (
                  <div key={l.so_line_id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderTop: idx === 0 ? 'none' : `1px solid ${TH.border}`, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 800, color: TH.text, fontSize: 14 }}>{l.fg_item_code || l.fg_item_id} {l.fg_item_name ? <span style={{ color: TH.muted, fontWeight: 600 }}>— {l.fg_item_name}</span> : null}</div>
                      <div style={{ fontSize: 12, color: TH.muted, marginTop: 3 }}>{l.guidance}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {(l.chips || []).map((c) => <Chip key={c} text={c} />)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 12, color: TH.text }}>
                      {/* MTO-SETS-DISPLAY-1: show business order in SETS plus production PCS. */}
                      <QtyMetric label="ORDER" value={l.order_qty} line={l} kind="order" />
                      <QtyMetric label="STOCK" value={l.fg_stock} line={l} />
                      <QtyMetric label="PLANNED" value={l.already_planned} line={l} />
                      <QtyMetric label="BALANCE" value={l.balance} line={l} strong />
                      <QtyMetric label="PRODUCED" value={l.produced_qty ?? 0} line={l} />
                      <QtyMetric label="COMPLETED" value={l.completed_qty ?? 0} line={l} />
                      <QtyMetric label="READY FG" value={l.ready_fg_qty ?? 0} line={l} />
                      <div style={{ textAlign: 'right', minWidth: 100 }}><div style={{ color: TH.muted, fontSize: 10, fontWeight: 700 }}>STATE</div>{l.line_status || l.status}</div>
                      <div style={{ minWidth: 92, textAlign: 'right' }}>
                        {l.status === 'Plan Now' ? (
                          <button
                            type="button"
                            disabled={planningLine === l.so_line_id}
                            onClick={() => handlePlanNow(l)}
                            style={{
                              border: 'none',
                              borderRadius: 999,
                              padding: '5px 11px',
                              background: ss.bg,
                              color: ss.fg,
                              fontWeight: 900,
                              fontSize: 11,
                              cursor: planningLine === l.so_line_id ? 'wait' : 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {planningLine === l.so_line_id ? 'Planning…' : 'Plan Now'}
                          </button>
                        ) : (
                          <Pill text={l.status} fg={ss.fg} bg={ss.bg} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {!loading && !err && flatView && (
        <div style={{ border: `1px solid ${TH.border}`, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <div style={{ display: 'flex', gap: 12, padding: '8px 12px', background: TH.bg, fontSize: 11, fontWeight: 900, color: TH.muted }}>
            <div style={{ flex: 1 }}>CUSTOMER / SO / FG</div>
            <div style={{ width: 110, textAlign: 'right' }}>ORDER</div>
            <div style={{ width: 90, textAlign: 'right' }}>STOCK</div>
            <div style={{ width: 100, textAlign: 'right' }}>PLANNED</div>
            <div style={{ width: 100, textAlign: 'right' }}>BALANCE</div>
            <div style={{ width: 80, textAlign: 'right' }}>PRODUCED</div>
            <div style={{ width: 80, textAlign: 'right' }}>COMPLETED</div>
            <div style={{ width: 80, textAlign: 'right' }}>READY FG</div>
            <div style={{ width: 120, textAlign: 'right' }}>STATE</div>
            <div style={{ width: 80, textAlign: 'right' }}>STATUS</div>
          </div>
          {flatLines.map(({ o, l }) => {
            const ss = STATUS_STYLE[l.status] || STATUS_STYLE.Done;
            return (
              <div key={`${o.so_id}-${l.so_line_id}`} style={{ display: 'flex', gap: 12, padding: '8px 12px', borderTop: `1px solid ${TH.border}`, fontSize: 12, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ color: TH.muted }}>{o.customer_name} · {o.so_number} · </span>
                  <strong style={{ color: TH.text }}>{l.fg_item_code || l.fg_item_id}</strong>
                  <span style={{ color: TH.muted }}> — {l.guidance}</span>
                </div>
                <div style={{ width: 110, textAlign: 'right', fontWeight: 700 }}>{QtyInline({ value: l.order_qty, line: l, kind: 'order' })}</div>
                <div style={{ width: 90, textAlign: 'right' }}>{QtyInline({ value: l.fg_stock, line: l })}</div>
                <div style={{ width: 100, textAlign: 'right' }}>{QtyInline({ value: l.already_planned, line: l })}</div>
                <div style={{ width: 100, textAlign: 'right' }}><strong>{QtyInline({ value: l.balance, line: l })}</strong></div>
                <div style={{ width: 80, textAlign: 'right' }}>{QtyInline({ value: l.produced_qty ?? 0, line: l })}</div>
                <div style={{ width: 80, textAlign: 'right' }}>{QtyInline({ value: l.completed_qty ?? 0, line: l })}</div>
                <div style={{ width: 80, textAlign: 'right' }}>{QtyInline({ value: l.ready_fg_qty ?? 0, line: l })}</div>
                <div style={{ width: 120, textAlign: 'right', fontWeight: 700 }}>{l.line_status || l.status}</div>
                <div style={{ width: 90, textAlign: 'right' }}>
                  {l.status === 'Plan Now' ? (
                    <button
                      type="button"
                      disabled={planningLine === l.so_line_id}
                      onClick={() => handlePlanNow(l)}
                      style={{
                        border: 'none',
                        borderRadius: 999,
                        padding: '5px 10px',
                        background: ss.bg,
                        color: ss.fg,
                        fontWeight: 900,
                        fontSize: 11,
                        cursor: planningLine === l.so_line_id ? 'wait' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {planningLine === l.so_line_id ? 'Planning…' : 'Plan Now'}
                    </button>
                  ) : (
                    <Pill text={l.status} fg={ss.fg} bg={ss.bg} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !err && (
        <div style={{ fontSize: 11, color: TH.muted, marginTop: 14 }}>MTO Phase 1b — Plan Now creates an order-linked PPO only. Work Orders are not auto-released.</div>
      )}
    </div>
  );
}
