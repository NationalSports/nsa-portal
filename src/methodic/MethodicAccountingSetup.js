import React, { useCallback, useEffect, useState } from 'react';
import { methodicAccountingApi } from './methodicApi';

const FIELDS = [
  ['methodic_customer_qb_id', 'Methodic QB customer ID for National'],
  ['methodic_income_item_qb_id', 'Methodic QB income item ID'],
  ['methodic_tax_code_qb_id', 'Methodic QB tax code ID'],
  ['methodic_deposit_account_qb_id', 'Methodic QB deposit account ID'],
  ['national_vendor_qb_id', 'National QB vendor ID for Methodic'],
  ['national_expense_account_qb_id', 'National QB Methodic expense / COGS account ID'],
  ['national_payment_account_qb_id', 'National QB payment bank account ID'],
];
const financeRole = (user) => ['admin', 'super_admin', 'accounting'].includes(user?.role);

export default function MethodicAccountingSetup({ currentUser, notify }) {
  const canManage = financeRole(currentUser);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const result = await methodicAccountingApi('status');
      setData(result); setForm(result.config || {});
    } catch (loadError) { setError(loadError.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const connect = async (company) => {
    setBusy(`connect-${company}`); setError('');
    try {
      const response = await fetch('/.netlify/functions/qb-auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect', company }),
      });
      const result = await response.json();
      if (!response.ok || !result.authUrl) throw new Error(result.error || 'QuickBooks connection failed.');
      window.location.href = result.authUrl;
    } catch (connectError) { setError(connectError.message); setBusy(''); }
  };

  const save = async () => {
    setBusy('save'); setError('');
    try {
      const result = await methodicAccountingApi('save_config', form);
      setForm(result.config || {}); notify?.('Methodic accounting configuration saved'); await load();
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(''); }
  };

  const connection = (key, label) => <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 9, border: '1px solid #e2e8f0', borderRadius: 8, background: 'white' }}>
    <span style={{ width: 9, height: 9, borderRadius: 9, background: data?.connections?.[key]?.connected ? '#16a34a' : '#dc2626' }} />
    <strong style={{ fontSize: 11 }}>{label}</strong>
    <span style={{ fontSize: 10, color: '#64748b' }}>{data?.connections?.[key]?.connected ? `Realm ${data.connections[key].realm_id}` : 'Not connected'}</span>
    {canManage && <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} disabled={!!busy} onClick={() => connect(key)}>{data?.connections?.[key]?.connected ? 'Reconnect' : 'Connect'}</button>}
  </div>;

  return <div className="card" style={{ marginBottom: 14, borderColor: '#c7d2fe' }}>
    <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div><h3 style={{ margin: 0, fontSize: 13 }}>Methodic intercompany accounting</h3><div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Methodic invoice → Methodic QBO · matching vendor bill → National QBO · paired payment records</div></div>
      <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setOpen((value) => !value)}>{open ? 'Hide setup' : 'Connections & mappings'}</button>
    </div>
    {open && <div className="card-body" style={{ padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 8, marginBottom: 12 }}>
        {connection('methodic', 'Methodic QuickBooks')}
        {connection('national', 'National QuickBooks')}
      </div>
      <div style={{ padding: 9, borderRadius: 7, background: '#fffbeb', color: '#92400e', fontSize: 10, marginBottom: 10 }}>Posting remains disabled until both companies are connected and every customer, vendor, item, tax, expense, bank, and deposit mapping is approved. This follows PR #2041’s fail-closed accounting model.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 9 }}>
        {FIELDS.map(([key, label]) => <label key={key}><span className="oe-label">{label}</span><input className="form-input" value={form[key] || ''} disabled={!canManage} onChange={(event) => set(key, event.target.value)} placeholder="QuickBooks entity ID" /></label>)}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 11 }}>
        <label style={{ fontSize: 11, fontWeight: 800 }}><input type="checkbox" checked={!!form.invoice_sync_enabled} disabled={!canManage} onChange={(event) => set('invoice_sync_enabled', event.target.checked)} /> Enable paired invoice + bill posting</label>
        <label style={{ fontSize: 11, fontWeight: 800 }}><input type="checkbox" checked={!!form.payment_sync_enabled} disabled={!canManage} onChange={(event) => set('payment_sync_enabled', event.target.checked)} /> Enable paired payment recording</label>
        {canManage && <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save accounting setup'}</button>}
      </div>
      {error && <div style={{ marginTop: 9, color: '#b91c1c', fontSize: 11 }}>{error}</div>}
    </div>}
  </div>;
}
