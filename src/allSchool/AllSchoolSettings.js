import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { normalizeAllSchoolSettings } from './adminHelpers';
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
    <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>An always-open school store with separate sport collections. Garment shortages join the shared All School supplier queues.</p>
    <Field label="Displayed shipping estimate: days from payment to shipment (14 = 2 weeks)"><input className="form-input" type="number" min="1" max="90" value={s.target_ship_days} onChange={(e) => onChange({ ...s, target_ship_days: Number(e.target.value) })} /></Field>
    <p style={{ fontSize: 12, color: '#64748b' }}>Shown to shoppers; transit time is additional. This is the same estimate as Delivery settings.</p>
    <Field label="Production allowance after stock is ready (business days)"><input className="form-input" type="number" min="0" max="90" step="1" placeholder="Not yet confirmed" value={s.production.business_days ?? ''} onChange={e => change('production', 'business_days', e.target.value === '' ? null : Number(e.target.value))} /></Field>
    <p style={{ fontSize: 12, color: '#64748b' }}>Item estimates add this allowance after a 3-business-day stock pull or supplier arrival plus 2 business days for check-in. Business days are Monday–Friday. Leave blank to show stock timing while production timing is unconfirmed.</p>
    <h4>Production release</h4>
    {tick('production', 'auto_release_enabled', 'Automatically release ready jobs into production')}
    <div style={{ fontSize: 12, color: '#64748b' }}>A job releases only after approved production art, garments in hand, and required decoration materials or DTF prints are confirmed. Picking and receiving remain physical steps.</div>
    <h4>Shared garment purchasing</h4>
    {tick('purchasing', 'enabled', 'Enable automated garment purchasing for this store')}
    <Field label="Purchasing"><select className="form-select" value={s.purchasing.mode==='manual'?'manual':'minimum'} onChange={e=>change('purchasing','mode',e.target.value)}><option value="manual">Manual</option><option value="minimum">Shared supplier queue</option></select></Field>
    <p style={{fontSize:13}}>All enabled All School stores share one queue per supplier: S&amp;S, SanMar, and Momentec. Order at $200 in garment cost or after seven days from the oldest customer order, whichever comes first. Available warehouse stock is allocated first. Club ordering stays manual.</p>
    <p style={{fontSize:12,color:'#64748b'}}>Tax, freight and decoration do not count toward $200. Each garment stays linked to its customer order. Supplier connections and automatic submission must be enabled.</p>
    <h4>Low-stock alerts</h4><p style={{ fontSize: 12, color: '#64748b' }}>Set a reorder threshold for each decoration in Inventory. Available stock excludes paid-order demand. Incoming stock is shown separately. Alerts remain visible in Inventory; email goes to the store’s assigned rep.</p>
    <p style={{ fontSize: 12, color: repEmail ? '#166534' : '#b45309' }}>{repEmail ? `Low-stock emails: ${repEmail}` : 'Assign a rep with an active staff email to receive low-stock emails. Inventory warnings remain available.'}</p>
    <h4>DTF supplier</h4>
    <Field label="Default supplier (individual artwork may override)"><select className="form-select" value={s.dtf.supplier_id || ''} onChange={(e) => change('dtf', 'supplier_id', e.target.value || null)}><option value="">Choose per artwork</option>{s.dtf.supplier_id && !suppliers.some((v) => v.vendor === s.dtf.supplier_id) && <option value={s.dtf.supplier_id}>{s.dtf.supplier_id}</option>}{suppliers.map((v) => <option key={v.vendor} value={v.vendor}>{v.vendor}</option>)}</select></Field>
    {tick('dtf', 'auto_send', 'Automatically send production-ready DTF requests to the selected supplier')}
    <div style={{ fontSize: 12, color: '#64748b' }}>Missing artwork or print dimensions holds the request for review. Manage supplier addresses in the existing DTF purchasing settings.</div>
  </div>;
}
