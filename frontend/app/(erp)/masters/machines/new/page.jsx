'use client';

/**
 * CERADRIVE ERP — Create Machine
 * Mandatory: machine_code, machine_name, machine_type_id.
 * R46: Onboarding under 30 seconds — required fields at top, optional below fold.
 *
 * Status select limited to: active, under_maintenance, retired.
 * maintenance_frequency_days must be > 0 if entered.
 * Image/manual fields are plain text URLs (no upload).
 * Warehouse picker intentionally omitted (warehouse_id is optional/nullable).
 */

import { useEffect, useState } from 'react';
import { useRouter }           from 'next/navigation';
import { api }                 from '../../../../../lib/api.js';
import { useToast }            from '../../../../../components/ui/Toast.jsx';

const STATUS_OPTIONS = [
  { value: 'active',            label: 'Active' },
  { value: 'under_maintenance', label: 'Under maintenance' },
  { value: 'retired',           label: 'Retired' },
];

const CAPACITY_BASIS_OPTIONS = [
  { value: '',             label: 'Not set yet' },
  { value: 'WEIGHT_BATCH', label: 'Weight batch' },
  { value: 'PCS_TRAY',     label: 'PCS per tray' },
  { value: 'DIE_CAVITY',   label: 'Die cavity' },
  { value: 'PCS_CYCLE',    label: 'PCS per cycle' },
  { value: 'PCS_PER_HOUR', label: 'PCS per hour' },
  { value: 'PCS_PER_MIN',  label: 'PCS per minute' },
  { value: 'PCS_CRATE',    label: 'PCS per crate' },
  { value: 'TRAY_BATCH',   label: 'Tray batch' },
  { value: 'MANUAL',       label: 'Manual' },
];

function n(v) {
  return v === '' || v == null ? null : Number(v);
}

export default function MachineNewPage() {
  const router = useRouter();
  const addToast = useToast();

  // Mandatory
  const [code,        setCode]        = useState('');
  const [name,        setName]        = useState('');
  const [typeId,      setTypeId]      = useState('');
  // Status (NOT NULL, default active)
  const [status,      setStatus]      = useState('active');
  // Optional
  const [isBottleneck, setIsBottleneck] = useState(false);
  const [serial,      setSerial]      = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [freqDays,    setFreqDays]    = useState('');
  const [lastMaint,   setLastMaint]   = useState('');
  const [nextMaint,   setNextMaint]   = useState('');
  const [imageUrl,    setImageUrl]    = useState('');
  const [manualUrl,   setManualUrl]   = useState('');
  const [notes,       setNotes]       = useState('');

  // Capacity planning
  const [capacityBasis,    setCapacityBasis]    = useState('');
  const [ratedCapacity,    setRatedCapacity]    = useState('');
  const [planningCapacity, setPlanningCapacity] = useState('');
  const [capacityUom,      setCapacityUom]      = useState('');
  const [cycleTimeSec,     setCycleTimeSec]     = useState('');
  const [setupTimeMin,     setSetupTimeMin]     = useState('');
  const [changeoverTimeMin,setChangeoverTimeMin]= useState('');
  const [pcsPerCycle,      setPcsPerCycle]      = useState('');
  const [pcsPerHour,       setPcsPerHour]       = useState('');
  const [trayCapacity,     setTrayCapacity]     = useState('');
  const [batchCapacityKg,  setBatchCapacityKg]  = useState('');
  const [capacityTolerancePercent, setCapacityTolerancePercent] = useState('');
  const [slotsCount,       setSlotsCount]       = useState('');

  const [types,        setTypes]        = useState([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [showOptional,  setShowOptional] = useState(false);
  const [errors,        setErrors]       = useState({});
  const [saving,        setSaving]       = useState(false);

  useEffect(() => {
    api.get('/api/v1/machines/types').then(({ data, error }) => {
      if (error) addToast('Failed to load machine types.', 'error');
      else setTypes(data ?? []);
      setTypesLoading(false);
    });
  }, [addToast]);

  function validate() {
    const errs = {};
    if (!code.trim())  errs.machine_code = 'Machine code is required.';
    if (!name.trim())  errs.machine_name = 'Machine name is required.';
    if (!typeId)       errs.machine_type_id = 'Machine type is required.';
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/machines/master', {
      machine_code:               code.trim().toUpperCase(),
      machine_name:               name.trim(),
      machine_type_id:            typeId,
      status,
      is_bottleneck:              isBottleneck,
      serial_number:              serial.trim()       || null,
      manufacturer:               manufacturer.trim() || null,
      model_number:               modelNumber.trim()  || null,
      purchase_date:              purchaseDate        || null,
      maintenance_frequency_days: freqDays ? Number(freqDays) : null,
      last_maintenance_date:      lastMaint           || null,
      next_maintenance_date:      nextMaint           || null,
      machine_image_url:          imageUrl.trim()     || null,
      machine_manual_url:         manualUrl.trim()    || null,
      capacity_basis:             capacityBasis       || null,
      rated_capacity:             n(ratedCapacity),
      planning_capacity:          n(planningCapacity),
      capacity_uom:               capacityUom.trim()  || null,
      cycle_time_sec:             n(cycleTimeSec),
      setup_time_min:             n(setupTimeMin),
      changeover_time_min:        n(changeoverTimeMin),
      pcs_per_cycle:              n(pcsPerCycle),
      pcs_per_hour:               n(pcsPerHour),
      tray_capacity:              n(trayCapacity),
      batch_capacity_kg:          n(batchCapacityKg),
      capacity_tolerance_percent: n(capacityTolerancePercent),
      slots_count:                n(slotsCount),
      notes:                      notes.trim()        || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT' && error.message?.includes('code')) setErrors({ machine_code: error.message });
      else if (error.code === 'VALIDATION_ERROR' && error.message?.toLowerCase().includes('machine type')) setErrors({ machine_type_id: error.message });
      else if (error.code === 'VALIDATION_ERROR' && error.message?.toLowerCase().includes('status')) setErrors({ status: error.message });
      else if (error.code === 'VALIDATION_ERROR' && error.message?.toLowerCase().includes('frequency')) setErrors({ maintenance_frequency_days: error.message });
      else if (error.code === 'VALIDATION_ERROR' && error.message?.toLowerCase().includes('capacity')) setErrors({ capacity_basis: error.message });
      else addToast(error.message ?? 'Failed to create machine.', 'error');
    } else {
      addToast(`Machine ${data.machine_code} created.`, 'success');
      router.push('/masters/machines');
    }
  }

  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
  const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
  const selectStyle = (err) => ({ ...inputStyle(err), background: '#fff', cursor: 'pointer' });
  const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };
  const gridTwo    = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 600, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/machines')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Machines
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>New Machine</h1>
        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>Code, name and type are required. All other details can be added later.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 }}>

        {/* Mandatory fields */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Machine Code *</label>
          <input value={code} onChange={e => { setCode(e.target.value); setErrors(p => ({ ...p, machine_code: undefined })); }}
            placeholder="e.g. MLD001" maxLength={30}
            style={{ ...inputStyle(errors.machine_code), textTransform: 'uppercase', fontFamily: 'monospace' }} />
          {errors.machine_code
            ? <span style={errStyle}>{errors.machine_code}</span>
            : <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>Stored uppercase.</span>}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Machine Name *</label>
          <input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, machine_name: undefined })); }}
            placeholder="e.g. Moulding Press 1" maxLength={200}
            style={inputStyle(errors.machine_name)} />
          {errors.machine_name && <span style={errStyle}>{errors.machine_name}</span>}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Machine Type *</label>
          <select value={typeId} onChange={e => { setTypeId(e.target.value); setErrors(p => ({ ...p, machine_type_id: undefined })); }}
            disabled={typesLoading} style={selectStyle(errors.machine_type_id)}>
            <option value="">{typesLoading ? 'Loading types…' : 'Select machine type…'}</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
          </select>
          {errors.machine_type_id && <span style={errStyle}>{errors.machine_type_id}</span>}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={e => { setStatus(e.target.value); setErrors(p => ({ ...p, status: undefined })); }}
            style={selectStyle(errors.status)}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {errors.status && <span style={errStyle}>{errors.status}</span>}
        </div>

        {/* Capacity planning */}
        <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 18, marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Capacity Planning</div>
          <div style={gridTwo}>
            <div>
              <label style={labelStyle}>Calculation Basis</label>
              <select value={capacityBasis} onChange={e => { setCapacityBasis(e.target.value); setErrors(p => ({ ...p, capacity_basis: undefined })); }} style={selectStyle(errors.capacity_basis)}>
                {CAPACITY_BASIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {errors.capacity_basis && <span style={errStyle}>{errors.capacity_basis}</span>}
            </div>
            <div>
              <label style={labelStyle}>Capacity UOM</label>
              <input value={capacityUom} onChange={e => setCapacityUom(e.target.value)} placeholder="e.g. kg/batch, pcs/hr" style={inputStyle(false)} />
            </div>
          </div>
          <div style={gridTwo}>
            <div>
              <label style={labelStyle}>Rated Capacity</label>
              <input type="number" step="any" value={ratedCapacity} onChange={e => setRatedCapacity(e.target.value)} placeholder="e.g. 80" style={inputStyle(false)} />
            </div>
            <div>
              <label style={labelStyle}>Planning Capacity</label>
              <input type="number" step="any" value={planningCapacity} onChange={e => setPlanningCapacity(e.target.value)} placeholder="e.g. 60" style={inputStyle(false)} />
            </div>
          </div>
          <div style={gridTwo}>
            <div>
              <label style={labelStyle}>Cycle Time (sec)</label>
              <input type="number" step="any" value={cycleTimeSec} onChange={e => setCycleTimeSec(e.target.value)} placeholder="e.g. 2100" style={inputStyle(false)} />
            </div>
            <div>
              <label style={labelStyle}>Setup Time (min)</label>
              <input type="number" step="any" value={setupTimeMin} onChange={e => setSetupTimeMin(e.target.value)} placeholder="Optional" style={inputStyle(false)} />
            </div>
          </div>
          <div style={gridTwo}>
            <div>
              <label style={labelStyle}>Changeover Time (min)</label>
              <input type="number" step="any" value={changeoverTimeMin} onChange={e => setChangeoverTimeMin(e.target.value)} placeholder="Optional" style={inputStyle(false)} />
            </div>
            <div>
              <label style={labelStyle}>Batch Capacity (kg)</label>
              <input type="number" step="any" value={batchCapacityKg} onChange={e => setBatchCapacityKg(e.target.value)} placeholder="e.g. 60" style={inputStyle(false)} />
            </div>
          </div>
          <div style={gridTwo}>
            <div>
              <label style={labelStyle}>Capacity Tolerance (%)</label>
              <input type="number" step="any" value={capacityTolerancePercent} onChange={e => setCapacityTolerancePercent(e.target.value)} placeholder="e.g. 10" style={inputStyle(false)} />
            </div>
            <div>
              <label style={labelStyle}>PCS / Cycle</label>
              <input type="number" step="any" value={pcsPerCycle} onChange={e => setPcsPerCycle(e.target.value)} placeholder="e.g. 2" style={inputStyle(false)} />
            </div>
            <div>
              <label style={labelStyle}>PCS / Hour</label>
              <input type="number" step="any" value={pcsPerHour} onChange={e => setPcsPerHour(e.target.value)} placeholder="e.g. 500" style={inputStyle(false)} />
            </div>
          </div>
          <div style={gridTwo}>
            <div>
              <label style={labelStyle}>Tray Capacity</label>
              <input type="number" step="any" value={trayCapacity} onChange={e => setTrayCapacity(e.target.value)} placeholder="e.g. 74" style={inputStyle(false)} />
            </div>
            <div>
              <label style={labelStyle}>Slots Count</label>
              <input type="number" step="1" value={slotsCount} onChange={e => setSlotsCount(e.target.value)} placeholder="e.g. 2" style={inputStyle(false)} />
            </div>
          </div>
          <p style={{ fontSize: 11, color: '#6B7280', marginTop: -4, marginBottom: 16 }}>
            Used later by production planner. Example: Shot blast rated 80 kg, planning 60 kg, cycle 2100 sec.
          </p>
        </div>

        {/* Optional toggle */}
        <button
          type="button"
          onClick={() => setShowOptional(v => !v)}
          style={{ background: 'none', border: 'none', color: '#4F46E5', fontSize: 13, cursor: 'pointer', padding: '0 0 16px 0', fontWeight: 500 }}
        >
          {showOptional ? '▲ Hide optional details' : '▼ Add optional details (identifiers, maintenance, links…)'}
        </button>

        {showOptional && (
          <>
            {/* Bottleneck */}
            <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input id="bn" type="checkbox" checked={isBottleneck} onChange={e => setIsBottleneck(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <label htmlFor="bn" style={{ fontSize: 13, color: '#374151', cursor: 'pointer' }}>Mark as bottleneck machine</label>
            </div>

            {/* Identifiers */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Identifiers</span>
            </div>
            <div style={gridTwo}>
              <div>
                <label style={labelStyle}>Serial number</label>
                <input value={serial} onChange={e => setSerial(e.target.value)} placeholder="SN-xxxx" style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>Model number</label>
                <input value={modelNumber} onChange={e => setModelNumber(e.target.value)} placeholder="Model" style={inputStyle()} />
              </div>
            </div>
            <div style={gridTwo}>
              <div>
                <label style={labelStyle}>Manufacturer</label>
                <input value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="Manufacturer" style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>Purchase date</label>
                <input value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} type="date" style={inputStyle()} />
              </div>
            </div>

            {/* Maintenance */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Maintenance</span>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Frequency (days)</label>
              <input value={freqDays} onChange={e => { setFreqDays(e.target.value); setErrors(p => ({ ...p, maintenance_frequency_days: undefined })); }}
                type="number" min="1" placeholder="e.g. 30"
                style={inputStyle(errors.maintenance_frequency_days)} />
              {errors.maintenance_frequency_days
                ? <span style={errStyle}>{errors.maintenance_frequency_days}</span>
                : <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>Must be greater than 0 if entered.</span>}
            </div>
            <div style={gridTwo}>
              <div>
                <label style={labelStyle}>Last maintenance</label>
                <input value={lastMaint} onChange={e => setLastMaint(e.target.value)} type="date" style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>Next maintenance</label>
                <input value={nextMaint} onChange={e => setNextMaint(e.target.value)} type="date" style={inputStyle()} />
              </div>
            </div>

            {/* Links */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Links (URL)</span>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Image URL</label>
              <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…" style={inputStyle()} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Manual URL</label>
              <input value={manualUrl} onChange={e => setManualUrl(e.target.value)} placeholder="https://…" style={inputStyle()} />
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Optional notes…"
                style={{ width: '100%', padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', resize: 'vertical', outline: 'none' }} />
            </div>
          </>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: showOptional ? 0 : 8 }}>
          <button onClick={() => router.push('/masters/machines')}
            style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
            {saving ? 'Saving…' : 'Create Machine'}
          </button>
        </div>

      </div>
    </div>
  );
}
