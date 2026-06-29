// Shared Item Master form styles (extracted verbatim from the original pages).
export const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
export const errStyle = { fontSize: 11, color: '#DC2626', marginTop: 3 };
export const flagRow = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', marginBottom: 10, cursor: 'pointer' };
export const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 };
export const lbl = { fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' };
export const hintStyle = { fontSize: 11, color: '#9CA3AF' };
export const sectionLabel = { fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 };
export const ctrl = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
export const roBox = { width: '100%', minHeight: 38, padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 14, color: '#374151', background: '#F9FAFB', display: 'flex', alignItems: 'center' };
export const roText = { fontSize: 13, color: '#374151', padding: '8px 0' };
export const area = { width: '100%', padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', resize: 'vertical', outline: 'none' };
export const cardStyle = { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 };
export const tabBtn = (active) => ({ padding: '8px 2px', marginRight: 20, background: 'none', border: 'none', borderBottom: `2px solid ${active ? '#4F46E5' : 'transparent'}`, color: active ? '#4F46E5' : '#6B7280', fontWeight: active ? 700 : 500, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' });
export const accHeader = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 700, color: '#374151', cursor: 'pointer' };
export const grid2 = (isMobile) => ({ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 });

export const TABS = [
  ['basic', 'Basic Information'], ['manufacturing', 'Manufacturing'], ['inventory', 'Inventory Planning'],
  ['commercial', 'Commercial'], ['qc', 'Quality Control'], ['drawings', 'Drawings & Documents'],
  ['system', 'System Information'], ['compatibility', 'Vehicle Compatibility'],
];
