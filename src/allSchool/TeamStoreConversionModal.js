import React, { useMemo, useState } from 'react';
import { buildTeamStoreConversionPlan } from './teamStoreConversion';

const TONE = {
  keep_active: { label: 'Keep active', color: '#166534', bg: '#dcfce7' },
  map_dtf: { label: 'Map to DTF', color: '#1d4ed8', bg: '#dbeafe' },
  deactivate: { label: 'Hide', color: '#9a3412', bg: '#ffedd5' },
  keep_hidden: { label: 'Keep hidden', color: '#475569', bg: '#e2e8f0' },
};

export default function TeamStoreConversionModal({ store, catalog, transfers, art, stockByWp, inventorySourceByProductId, orders, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const plan = useMemo(() => buildTeamStoreConversionPlan({
    store, catalog, transfers, art, stockByWp, inventorySourceByProductId, orders,
  }), [store, catalog, transfers, art, stockByWp, inventorySourceByProductId, orders]);
  const apply = async () => {
    setBusy(true); setError('');
    try {
      const ok = await onConfirm(plan);
      if (!ok) setError('The conversion was not applied. Nothing in this review was deleted.');
    } catch (conversionError) {
      setError(conversionError?.message || 'The conversion could not be applied.');
    } finally { setBusy(false); }
  };
  return <div role="dialog" aria-modal="true" aria-labelledby="team-conversion-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15,23,42,.62)', display: 'flex', padding: 24, overflowY: 'auto' }}>
    <div onMouseDown={(event) => event.stopPropagation()} style={{ width: 'min(900px,100%)', margin: 'auto', background: '#fff', borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,.35)', overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid #e2e8f0' }}>
        <h2 id="team-conversion-title" style={{ margin: 0, fontSize: 20 }}>Convert to a 24/7 store</h2>
        <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 13 }}>Review every offering before changing the fulfillment model. Compatible logo choices and grouping are preserved.</p>
      </div>
      <div style={{ padding: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginBottom: 16 }}>
          {[['Ready', plan.readyCount], ['DTF mappings', plan.mappedCount], ['Will be hidden', plan.deactivatedCount]].map(([label, value]) => <div key={label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: 12 }}><b style={{ fontSize: 20 }}>{value}</b><div style={{ color: '#64748b', fontSize: 11 }}>{label}</div></div>)}
        </div>
        {plan.blockers.map((blocker) => <div key={blocker} role="alert" style={{ padding: 10, marginBottom: 8, borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: 12 }}>{blocker}</div>)}
        {plan.warnings.map((warning) => <div key={warning} role="status" style={{ padding: 10, marginBottom: 8, borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 12 }}>{warning}</div>)}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, maxHeight: 390, overflowY: 'auto' }}>
          {plan.actions.map((action) => { const tone = TONE[action.action]; return <div key={action.id} style={{ padding: '11px 13px', borderBottom: '1px solid #eef2f7', display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) 110px minmax(260px,2fr)', gap: 12, alignItems: 'start' }}>
            <b style={{ fontSize: 12 }}>{action.label}</b>
            <span style={{ justifySelf: 'start', borderRadius: 999, padding: '3px 8px', color: tone.color, background: tone.bg, fontSize: 10, fontWeight: 800 }}>{tone.label}</span>
            <span style={{ color: '#64748b', fontSize: 11.5, lineHeight: 1.4 }}>{action.reason}</span>
          </div>; })}
        </div>
        <div style={{ marginTop: 16, padding: 13, borderRadius: 9, background: '#f8fafc', fontSize: 12, color: '#475569' }}>
          The store will be closed, switched to ship-to-home and daily 24/7 fulfillment, and its timed close date will be removed. Incompatible items are hidden, not deleted. Existing orders stay intact.
        </div>
        <label style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 700 }}>Type <code>CONVERT</code> to confirm
          <input className="form-input" aria-label="Type CONVERT to confirm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} style={{ marginTop: 5 }} />
        </label>
        {error && <div role="alert" style={{ marginTop: 10, color: '#b91c1c', fontSize: 12 }}>{error}</div>}
      </div>
      <div style={{ padding: '14px 22px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || !!plan.blockers.length || confirmation !== 'CONVERT'} onClick={apply}>{busy ? 'Converting…' : 'Convert store'}</button>
      </div>
    </div>
  </div>;
}
