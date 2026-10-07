import React from 'react';
import { shippingDefaults } from '../lib/webstoreShippingRules.shared';
export default function WebstoreShippingSettings({ store, onChange }) {
  const c = shippingDefaults(store);
  const set = (key, value) => onChange({ shipping_settings: { ...c, [key]: value } });
  const field = (label, child) => <label style={{ display: 'block', margin: '10px 0', fontSize: 12, color: '#475569' }}>{label}{child}</label>;
  const number = (label, key) => field(label, <input className="form-input" type="number" min="0.1" step="0.1" value={c[key]} onChange={e => set(key, Number(e.target.value))} />);
  return <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
    {field('Shipping charged to buyer', <select className="form-select" value={c.mode} onChange={e => onChange({ shipping_settings: { ...c, mode: e.target.value, ...(['order_total', 'item_count'].includes(e.target.value) && e.target.value !== c.mode ? { tiers: [{ from: 0, amount_cents: Math.round((Number(store.flat_shipping) || 0) * 100) }] } : {}) } })}>
      <option value="flat">Flat rate per order</option><option value="free">Free shipping</option><option value="order_total">Based on merchandise total</option><option value="item_count">Based on item count</option><option value="ups_live">Live UPS rate</option>
    </select>)}
    {c.mode === 'flat' && field('Flat shipping ($)', <input className="form-input" type="number" min="0" step="0.01" value={store.flat_shipping} onChange={e => onChange({ flat_shipping: e.target.value, shipping_settings: c })} />)}
    {['order_total', 'item_count'].includes(c.mode) && <>
      <p style={{ fontSize: 12 }}>Each rate applies from its minimum up to the next tier. The final tier has no upper limit.</p>
      {c.tiers.map((tier, i) => <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {field(c.mode === 'order_total' ? 'Merchandise minimum ($)' : 'Minimum item count', <input className="form-input" aria-label={`Tier ${i + 1} minimum`} type="number" min="0" step={c.mode === 'order_total' ? '0.01' : '1'} disabled={i === 0} value={tier.from / (c.mode === 'order_total' ? 100 : 1)} onChange={e => set('tiers', c.tiers.map((t, j) => j === i ? { ...t, from: Math.round(Number(e.target.value) * (c.mode === 'order_total' ? 100 : 1)) } : t))} />)}
        {field('Shipping ($)', <input className="form-input" aria-label={`Tier ${i + 1} shipping`} type="number" min="0" step="0.01" value={tier.amount_cents / 100} onChange={e => set('tiers', c.tiers.map((t, j) => j === i ? { ...t, amount_cents: Math.round(Number(e.target.value) * 100) } : t))} />)}
        {i > 0 && <button type="button" onClick={() => set('tiers', c.tiers.filter((_, j) => j !== i))}>Remove</button>}
      </div>)}
      <button type="button" disabled={c.tiers.length >= 50} onClick={() => set('tiers', [...c.tiers, { from: c.tiers[c.tiers.length - 1].from + (c.mode === 'order_total' ? 5000 : 5), amount_cents: 0 }])}>Add tier</button>
    </>}
    {c.mode === 'ups_live' && <><p style={{ fontSize: 12 }}>UPS {c.service_code === 'ups_ground' ? 'Ground' : c.service_code} from the Orange warehouse. Product weights are required; checkout stops if a rate is unavailable.</p><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{number('Packaging weight (oz)', 'package_weight_oz')}{number('Length (in)', 'length_in')}{number('Width (in)', 'width_in')}{number('Height (in)', 'height_in')}</div></>}
    {c.mode !== 'free' && <>{field('Free shipping above a merchandise total', <input type="checkbox" checked={c.free_over_cents != null} onChange={e => set('free_over_cents', e.target.checked ? 10000 : null)} />)}{c.free_over_cents != null && field('Free shipping at or above ($)', <input className="form-input" type="number" min="0.01" step="0.01" value={c.free_over_cents / 100} onChange={e => set('free_over_cents', Math.round(Number(e.target.value) * 100))} />)}</>}
    <p style={{ fontSize: 12, color: '#64748b' }}>Merchandise totals exclude fundraising, tax, processing fees, and discounts. Item counts include the garments inside bundles.</p>
  </div>;
}
