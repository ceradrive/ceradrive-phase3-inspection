'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api.js';

const ctrl = { height: 38, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 10px', width: '100%', boxSizing: 'border-box', fontSize: 14, background: '#fff' };
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 5 };

export default function NewMouldingSlotSetup(){
  const router = useRouter();
  const [machines,setMachines] = useState([]);
  const [dies,setDies] = useState([]);
  const [saving,setSaving] = useState(false);
  const [f,setF] = useState({ setup_code:'MS-001', machine_id:'', slot_a_die_id:'', slot_b_die_id:'', cycle_time_sec:'', setup_time_min:'', heating_time_min:'90', notes:'' });

  useEffect(()=>{
    api.get('/api/v1/moulding-slots/machines').then(({data})=>setMachines(data??[]));
    api.get('/api/v1/moulding-slots/dies').then(({data})=>setDies(data??[]));
  },[]);

  function set(k,v){ setF(p=>({...p,[k]:v})); }

  function setMachine(id){
    const m = machines.find(x => x.id === id);
    setF(p => ({
      ...p,
      machine_id: id,
      cycle_time_sec: p.cycle_time_sec || m?.cycle_time_sec || '',
      setup_time_min: p.setup_time_min || m?.setup_time_min || '',
    }));
  }

  const a = dies.find(d=>d.id===f.slot_a_die_id);
  const b = dies.find(d=>d.id===f.slot_b_die_id);
  const total = Number(a?.num_impressions || 0) + Number(b?.num_impressions || 0);

  async function save(){
    setSaving(true);
    const {error} = await api.post('/api/v1/moulding-slots/master', f);
    setSaving(false);
    if(error){ alert(error.message || 'Failed'); return; }
    router.push('/masters/moulding-slots');
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 980 }}>
      <button onClick={()=>router.push('/masters/moulding-slots')} style={{ border: 0, background: 'none', color: '#6B7280', cursor: 'pointer', padding: 0, marginBottom: 8, fontSize: 13 }}>
        ← Moulding Slot Setups
      </button>

      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>New Moulding Slot Setup</h1>
        <p style={{ margin: '4px 0 0', color: '#6B7280', fontSize: 13 }}>Configure Slot A and Slot B die combination for moulding capacity.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #E5E7EB', background: '#F9FAFB', fontWeight: 700, fontSize: 14 }}>
          Setup Details
        </div>

        <div style={{ padding: 22 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={lbl}>Setup Code</label>
              <input value={f.setup_code} onChange={e=>set('setup_code',e.target.value.toUpperCase())} style={ctrl}/>
            </div>
            <div>
              <label style={lbl}>Moulding Machine</label>
              <select value={f.machine_id} onChange={e=>setMachine(e.target.value)} style={ctrl}>
                <option value="">Select machine</option>
                {machines.map(m=><option key={m.id} value={m.id}>{m.machine_code} — {m.machine_name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Slot A</div>
              <label style={lbl}>Die</label>
              <select value={f.slot_a_die_id} onChange={e=>set('slot_a_die_id',e.target.value)} style={ctrl}>
                <option value="">Empty slot</option>
                {dies.map(d=><option key={d.id} value={d.id}>{d.die_code} — {d.die_name} ({d.num_impressions} cavity)</option>)}
              </select>
              <div style={{ marginTop: 10, color: '#6B7280', fontSize: 13 }}>Output/cycle: <b>{a?.num_impressions || 0}</b> pcs</div>
            </div>

            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Slot B</div>
              <label style={lbl}>Die</label>
              <select value={f.slot_b_die_id} onChange={e=>set('slot_b_die_id',e.target.value)} style={ctrl}>
                <option value="">Empty slot</option>
                {dies.map(d=><option key={d.id} value={d.id}>{d.die_code} — {d.die_name} ({d.num_impressions} cavity)</option>)}
              </select>
              <div style={{ marginTop: 10, color: '#6B7280', fontSize: 13 }}>Output/cycle: <b>{b?.num_impressions || 0}</b> pcs</div>
            </div>
          </div>

          <div style={{ marginTop: 18, padding: 16, borderRadius: 8, background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#3730A3' }}>
            <b>Total PCS per Cycle:</b> {total}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 18 }}>
            <div><label style={lbl}>Cycle Time Sec</label><input value={f.cycle_time_sec} onChange={e=>set('cycle_time_sec',e.target.value)} style={ctrl}/></div>
            <div><label style={lbl}>Setup Time Min</label><input value={f.setup_time_min} onChange={e=>set('setup_time_min',e.target.value)} style={ctrl}/></div>
            <div><label style={lbl}>Heating Time Min</label><input value={f.heating_time_min} onChange={e=>set('heating_time_min',e.target.value)} style={ctrl}/></div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={lbl}>Notes</label>
            <input value={f.notes} onChange={e=>set('notes',e.target.value)} style={ctrl}/>
          </div>
        </div>

        <div style={{ padding: 18, borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={()=>router.push('/masters/moulding-slots')} style={{ height: 38, padding: '0 16px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ height: 38, padding: '0 18px', background: '#4F46E5', color: '#fff', border: 0, borderRadius: 6, fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save Setup'}
          </button>
        </div>
      </div>
    </div>
  );
}
