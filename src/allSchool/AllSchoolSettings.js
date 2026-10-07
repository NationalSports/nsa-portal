import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { normalizeAllSchoolSettings } from './adminHelpers';
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 };
const Field = ({ label, children }) => <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 700 }}>{label}{children}</label>;
export default function AllSchoolSettings({ value, onChange, repId }) {
  const s = normalizeAllSchoolSettings(value);
  const [repEmail, setRepEmail] = useState('');
  useEffect(() => { let live = true; setRepEmail(''); if (repId) supabase.from('team_members').select('email,is_active').eq('id', repId).maybeSingle().then(({ data }) => { if (live) setRepEmail(data?.is_active !== false ? data?.email || '' : ''); }); return () => { live = false; }; }, [repId]);
  const [suppliers, setSuppliers] = useState([]);
  useEffect(() => { let live = true; supabase.from('teamshop_auto_po_settings').select('vendor').eq('deco_type', 'dtf').then(({ data }) => { if (live) setSuppliers(data || []); }); return () => { live = false; }; }, []);
  const change = (section, key, val) => onChange({ ...s, [section]: { ...s[section], [key]: val } });
  const number = (section, key, label, min = 0, factor = 1) => <Field label={label}><input className="form-input" type="number" min={min} step={factor === 100 ? '.01' : '1'} value={s[section][key] / factor} onChange={(e) => change(section, key, Math.round(Number(e.target.value) * factor))} /></Field>;
  const tick = (section, key, label) => <label style={{ display: 'flex', gap: 8, margin: '10px 0', fontSize: 13 }}><input type="checkbox" checked={!!s[section][key]} onChange={(e) => change(section, key, e.target.checked)} />{label}</label>;
  return <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, margin: '14px 0' }}>
    <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>All School operations</h3>
    <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>An always-open school store with separate sport collections. Purchasing stays separate until the weekly cutoff; compatible regular batches may receive additions.</p>
    <Field label="Displayed shipping estimate: days from payment to shipment (14 = 2 weeks)"><input className="form-input" type="number" min="1" max="90" value={s.target_ship_days} onChange={(e) => onChange({ ...s, target_ship_days: Number(e.target.value) })} /></Field>
    <p style={{ fontSize: 12, color: '#64748b' }}>Shown to shoppers; transit time is additional. This is the same estimate as Delivery settings.</p>
    <h4>Garment purchasing cutoff</h4>
    {tick('purchasing', 'enabled', 'Enable automated garment purchasing for this store')}
    <div style={grid}>
      <Field label="Purchasing rule"><select className="form-select" value={s.purchasing.mode} onChange={(e) => change('purchasing', 'mode', e.target.value)}><option value="manual">Manual</option><option value="minimum">Minimum only</option><option value="weekly">Weekly only</option><option value="minimum_weekly">Minimum + weekly</option></select></Field>
      {number('purchasing', 'minimum_cents', 'Minimum blank cost per vendor ($)', 0, 100)}
      <Field label="Weekly cutoff (Pacific)"><select className="form-select" value={s.purchasing.weekday} onChange={(e) => change('purchasing', 'weekday', Number(e.target.value))}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => <option key={day} value={i}>{day}</option>)}</select></Field>
      <Field label="Weekly cutoff time"><input className="form-input" type="time" value={s.purchasing.time} onChange={(e) => change('purchasing', 'time', e.target.value)} /></Field>
      {number('purchasing', 'max_wait_days', 'Maximum purchasing wait (days)', 1)}
      {number('purchasing', 'max_run_cents', 'Maximum blank cost per run ($)', 0, 100)}
      <Field label="When no compatible regular batch exists"><select className="form-select" value={s.purchasing.no_batch_policy} onChange={(e) => change('purchasing', 'no_batch_policy', e.target.value)}><option value="separate">Create separate purchase</option><option value="hold">Hold until maximum wait</option></select></Field>
    </div>
    {tick('purchasing', 'combine_regular', 'At weekly cutoff, add below-minimum quantities to open regular purchasing batches')}
    <div style={{ fontSize: 12, color: '#64748b' }}>Blank cost excludes tax and freight. Store, customer, and decoration allocations remain separate. Automatic purchases also require the vendor lane to be enabled.</div>
    <h4>Low-stock alerts</h4><p style={{ fontSize: 12, color: '#64748b' }}>Set a reorder threshold for each decoration in Inventory. Available stock excludes paid-order demand. Incoming stock is shown separately. Alerts remain visible in Inventory; email goes to the store’s assigned rep.</p>
    <p style={{ fontSize: 12, color: repEmail ? '#166534' : '#b45309' }}>{repEmail ? `Low-stock emails: ${repEmail}` : 'Assign a rep with an active staff email to receive low-stock emails. Inventory warnings remain available.'}</p>
    <h4>DTF supplier</h4>
    <Field label="Default supplier (individual artwork may override)"><select className="form-select" value={s.dtf.supplier_id || ''} onChange={(e) => change('dtf', 'supplier_id', e.target.value || null)}><option value="">Choose per artwork</option>{s.dtf.supplier_id && !suppliers.some((v) => v.vendor === s.dtf.supplier_id) && <option value={s.dtf.supplier_id}>{s.dtf.supplier_id}</option>}{suppliers.map((v) => <option key={v.vendor} value={v.vendor}>{v.vendor}</option>)}</select></Field>
    {tick('dtf', 'auto_send', 'Automatically send production-ready DTF requests to the selected supplier')}
    <div style={{ fontSize: 12, color: '#64748b' }}>Missing artwork or print dimensions holds the request for review. Manage supplier addresses in the existing DTF purchasing settings.</div>
  </div>;
}
