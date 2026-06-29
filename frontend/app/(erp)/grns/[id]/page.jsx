'use client';

/**
 * CERADRIVE ERP — GRN Detail (Phase 9F-FE)
 * Header + lines. Actions: Post (draft -> posted), Cancel (posted -> cancelled, reversal).
 * Mirrors Work Order detail: inline STATUS_STYLE badge, status-gated buttons, inline confirm modal.
 * Endpoints: GET /api/v1/grns/:id, /:id/lines ; POST /:id/post, /:id/cancel {reason}.
 * Post/Cancel are role-guarded server-side (ADMIN/STORE_MANAGER); a 403 surfaces as a toast.
 * Read-only beyond post/cancel — except draft GRNs (see below). No backend/DB changes.
 *
 * GRN1-DRAFT-EDIT: a DRAFT GRN allows editing received_qty + unit_rate inline with
 * live line-total recalc; Save Draft -> PATCH /api/v1/grns/:id (draft-only).
 * No Post GRN change, no inventory posting, no schema change.
 *
 * GRNDRAFTCANCEL: a DRAFT GRN can be discarded — Discard Draft -> POST /grns/:id/cancel
 * (status='cancelled', no inventory, reason optional). Posted cancel stays reversal+reason.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams }             from 'next/navigation';
import { api }                              from '../../../../lib/api.js';
import { useToast }                         from '../../../../components/ui/Toast.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatQty(v) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-IN');
}
function formatMoney(v) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Defensive readers — nested embed primary, flat fallbacks.
function supplierName(g) {
  return g?.supplier_master?.supplier_name ?? g?.supplier?.supplier_name ?? g?.supplier_name ?? '—';
}
function warehouseName(g) {
  return g?.warehouse_master?.warehouse_name ?? g?.warehouse?.warehouse_name ?? g?.warehouse_name ?? '—';
}
function poNumber(g) {
  return g?.purchase_orders?.po_number ?? g?.po?.po_number ?? g?.po_number ?? '—';
}
function lineItem(l) {
  const code = l.item_master?.item_code ?? l.item_code ?? l.item?.item_code;
  const name = l.item_master?.item_name ?? l.item_name ?? l.item?.item_name;
  if (code && name) return `${code} — ${name}`;
  return code ?? name ?? (l.item_id ? String(l.item_id) : '—');
}

const STATUS_STYLE = {
  draft:     { color: '#6B7280', borderColor: '#D1D5DB', bg: '#F9FAFB' },
  posted:    { color: '#059669', borderColor: '#059669', bg: '#ECFDF5' },
  cancelled: { color: '#DC2626', borderColor: '#DC2626', bg: '#FEF2F2' },
};
const STATUS_LABEL = { draft: 'Draft', posted: 'Posted', cancelled: 'Cancelled' };

function btn(color, busy) {
  return { height: 36, padding: '0 16px', border: 'none', borderRadius: 6, background: color,
    fontSize: 13, fontWeight: 500, color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 };
}
function btnOutline(color, busy) {
  return { height: 36, padding: '0 16px', border: `1px solid ${color}`, borderRadius: 6, background: '#fff',
    fontSize: 13, fontWeight: 500, color, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 };
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#111827' }}>{value ?? '—'}</div>
    </div>
  );
}

const LGRID = '60px minmax(160px,1fr) 90px 110px 120px 130px';

export default function GRNDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const addToast = useToast();

  const [grn,          setGrn]          = useState(null);
  const [lines,        setLines]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [notFound,     setNotFound]     = useState(false);
  const [actionBusy,   setActionBusy]   = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { action, label }
  const [reason,       setReason]       = useState('');
  const [edits,        setEdits]        = useState({});    // GRN1-DRAFT-EDIT: line id -> { received_qty, unit_rate } (strings)
  const [savingDraft,  setSavingDraft]  = useState(false);

  // PBILL-CREATE-UI: posted GRN -> create/open the linked draft Purchase Bill (read-only link out).
  const [bill,     setBill]     = useState(null);   // active (non-cancelled) bill for this GRN, or null
  const [billBusy, setBillBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get(`/api/v1/grns/${id}`);
    if (error || !data) { setGrn(null); setNotFound(true); setLoading(false); return; }
    setGrn(data);
    setLines(data.lines ?? []);
    // PBILL-CREATE-UI: only a posted GRN can have a Purchase Bill.
    if (data.status === 'posted') {
      const { data: bills } = await api.get('/api/v1/purchase-bills', { grn_id: id });
      setBill((Array.isArray(bills) ? bills : []).find((b) => b.status !== 'cancelled') ?? null);
    } else {
      setBill(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const askConfirm = (action, label) => { setReason(''); setConfirmAction({ action, label }); };

  const runConfirmed = async () => {
    if (!confirmAction) return;
    setActionBusy(true);
    const { action, label } = confirmAction;
    const body = action === 'cancel' ? { reason: reason.trim() || null } : {};
    const { data, error } = await api.post(`/api/v1/grns/${id}/${action}`, body);
    setActionBusy(false);
    setConfirmAction(null);
    if (error) { addToast(`${label} failed`, error.message ?? ''); return; }
    const st = data?.status;
    if (st === 'ALREADY_POSTED' || st === 'ALREADY_CANCELLED') addToast(`GRN already ${st === 'ALREADY_POSTED' ? 'posted' : 'cancelled'}`);
    else addToast(`GRN ${label.toLowerCase()}ed`);
    load();
  };

  // ─── GRN1-DRAFT-EDIT — draft line editing ──────────────────────────────────
  const lineQty   = (l) => (edits[l.id]?.received_qty ?? String(num(l.received_qty)));
  const lineRate  = (l) => (edits[l.id]?.unit_rate    ?? String(num(l.unit_rate)));
  const liveTotal = (l) => num(lineQty(l)) * num(lineRate(l));
  const setEdit   = (lid, patch) => setEdits((p) => ({ ...p, [lid]: { ...(p[lid] || {}), ...patch } }));

  const saveDraft = async () => {
    const payloadLines = (lines ?? []).map((l) => ({
      id:           l.id,
      received_qty: num(lineQty(l)),
      unit_rate:    num(lineRate(l)),
    }));
    if (payloadLines.some((x) => !(x.received_qty > 0))) {
      addToast('Received qty must be greater than 0 on every line');
      return;
    }
    setSavingDraft(true);
    const { error } = await api.patch(`/api/v1/grns/${id}`, { lines: payloadLines });
    setSavingDraft(false);
    if (error) { addToast('Save failed', error.message ?? ''); return; }
    setEdits({});
    addToast('Draft GRN updated');
    load();
  };

  // PBILL-CREATE-UI — create a draft Purchase Bill from this posted GRN, then open it.
  const createBill = async () => {
    setBillBusy(true);
    const { data, error } = await api.post('/api/v1/purchase-bills', { grn_id: id });
    setBillBusy(false);
    if (error) { addToast('Create bill failed', error.message ?? ''); return; }
    addToast('Purchase Bill created', data?.bill_number ?? '');
    if (data?.id) router.push(`/purchase-bills/${data.id}`);
    else load();
  };

  if (loading) {
    return <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading goods receipt…</div>;
  }
  if (notFound || !grn) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: '#374151', marginBottom: 12 }}>Goods receipt not found.</div>
        <button onClick={() => router.push('/grns')} style={btnOutline('#6B7280', false)}>Back to GRNs</button>
      </div>
    );
  }

  const sStyle = STATUS_STYLE[grn.status] ?? STATUS_STYLE.draft;
  const isDraft  = grn.status === 'draft';
  const isPosted = grn.status === 'posted';

  return (
    <div style={{ maxWidth: 1000 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button onClick={() => router.push('/grns')}
          style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          ‹ Back
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#111827', margin: 0 }}>{grn.grn_number ?? 'GRN'}</h1>
        <span style={{
          display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 500,
          border: `1px solid ${sStyle.borderColor}`, color: sStyle.color, background: sStyle.bg, whiteSpace: 'nowrap',
        }}>
          {STATUS_LABEL[grn.status] ?? grn.status}
        </span>
      </div>

      {/* Detail card */}
      <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, background: '#fff', padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 16 }}>
          <Field label="GRN Date"        value={formatDate(grn.grn_date)} />
          <Field label="Supplier"        value={supplierName(grn)} />
          <Field label="Warehouse"       value={warehouseName(grn)} />
          <Field label="PO #"            value={poNumber(grn)} />
          <Field label="Supplier Challan" value={grn.supplier_challan} />
          <Field label="Supplier Invoice" value={grn.supplier_invoice} />
          <Field label="Created"         value={formatDate(grn.created_at)} />
          <Field label="Posted At"       value={grn.posted_at ? formatDate(grn.posted_at) : '—'} />
        </div>
        {grn.notes && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Notes</div>
            <div style={{ fontSize: 14, color: '#374151' }}>{grn.notes}</div>
          </div>
        )}
        {grn.status === 'cancelled' && grn.cancellation_reason && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Cancellation Reason</div>
            <div style={{ fontSize: 14, color: '#374151' }}>{grn.cancellation_reason}</div>
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="erp-table" style={{ marginBottom: 16 }}>
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: LGRID, padding: '9px 14px' }}>
          {['#', 'Item', 'UOM', 'Received Qty', 'Unit Rate', 'Line Total'].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', textAlign: i >= 3 ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>
        {lines.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No lines on this GRN.</div>
        ) : (
          lines.map((l, idx) => (
            <div key={l.id ?? idx} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: LGRID, padding: '0 14px', alignItems: 'center', minHeight: 46 }}>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{l.line_number ?? idx + 1}</div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{lineItem(l)}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{l.uom_master?.uom_code ?? '—'}</div>
              <div style={{ textAlign: 'right', paddingRight: 8 }}>
                {isDraft
                  ? <input type="number" min="0" step="0.0001" value={lineQty(l)}
                      onChange={e => setEdit(l.id, { received_qty: e.target.value })}
                      style={{ width: 90, height: 30, border: num(lineQty(l)) > 0 ? '1px solid #D1D5DB' : '1px solid #DC2626', borderRadius: 6, padding: '0 8px', fontSize: 13, textAlign: 'right', boxSizing: 'border-box' }} />
                  : <span style={{ fontSize: 13, color: '#111827' }}>{formatQty(l.received_qty)}</span>}
              </div>
              <div style={{ textAlign: 'right', paddingRight: 8 }}>
                {isDraft
                  ? <input type="number" min="0" step="0.0001" value={lineRate(l)}
                      onChange={e => setEdit(l.id, { unit_rate: e.target.value })}
                      style={{ width: 100, height: 30, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 8px', fontSize: 13, textAlign: 'right', boxSizing: 'border-box' }} />
                  : <span style={{ fontSize: 13, color: '#111827' }}>{formatMoney(l.unit_rate)}</span>}
              </div>
              <div style={{ fontSize: 13, color: '#111827', textAlign: 'right' }}>{isDraft ? formatMoney(liveTotal(l)) : formatMoney(l.line_total)}</div>
            </div>
          ))
        )}
      </div>

      {/* Actions */}
      {(isDraft || isPosted) && (
        <div style={{ display: 'flex', gap: 10 }}>
          {isDraft  && <button onClick={saveDraft} disabled={savingDraft || actionBusy} style={btnOutline('#2563EB', savingDraft || actionBusy)}>{savingDraft ? 'Saving…' : 'Save Draft'}</button>}
          {isDraft  && <button onClick={() => askConfirm('post', 'Post')}   disabled={actionBusy || savingDraft} style={btn('#059669', actionBusy || savingDraft)}>Post GRN</button>}
          {isDraft  && <button onClick={() => askConfirm('cancel', 'Discard')} disabled={actionBusy || savingDraft} style={btnOutline('#DC2626', actionBusy || savingDraft)}>Discard Draft</button>}
          {isPosted && <button onClick={() => askConfirm('cancel', 'Cancel')} disabled={actionBusy} style={btnOutline('#DC2626', actionBusy)}>Cancel GRN</button>}
        </div>
      )}

      {/* PBILL-CREATE-UI — Purchase Bill (posted GRN only) */}
      {isPosted && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          {bill
            ? <button onClick={() => router.push(`/purchase-bills/${bill.id}`)} style={btnOutline('#2563EB', false)}>
                Open Purchase Bill — {bill.bill_number}
              </button>
            : <button onClick={createBill} disabled={billBusy} style={btn('#2563EB', billBusy)}>
                {billBusy ? 'Creating…' : 'Create Purchase Bill'}
              </button>}
        </div>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <div onClick={() => !actionBusy && setConfirmAction(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 24, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 8 }}>{confirmAction.label} GRN</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
              {confirmAction.action === 'post'
                ? `Post ${grn.grn_number} to inventory? This receipts stock and cannot be edited afterward (reversible only by cancel).`
                : isDraft
                  ? `Discard draft ${grn.grn_number}? No inventory is posted. The PO can then create the next GRN or close short.`
                  : `Cancel ${grn.grn_number}? This reverses the posted inventory.`}
            </div>
            {confirmAction.action === 'cancel' && (
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={isPosted ? 'Reason (required)' : 'Reason (optional)'}
                style={{ width: '100%', height: 36, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 10px', fontSize: 13, color: '#374151', marginBottom: 16, boxSizing: 'border-box' }}
              />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setConfirmAction(null)} disabled={actionBusy}
                style={{ height: 36, padding: '0 16px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                Back
              </button>
              <button onClick={runConfirmed} disabled={actionBusy || (confirmAction.action === 'cancel' && isPosted && !reason.trim())}
                style={btn(confirmAction.action === 'post' ? '#059669' : '#DC2626', actionBusy || (confirmAction.action === 'cancel' && isPosted && !reason.trim()))}>
                {actionBusy ? 'Working…' : `Confirm ${confirmAction.label}`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
