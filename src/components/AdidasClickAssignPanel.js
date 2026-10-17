import React, { useMemo } from 'react';
import {
  ADIDAS_CLICK_CHOICES,
  ADIDAS_CLICK_DEFAULT_SHIP_TO,
  ADIDAS_CLICK_LOCATIONS,
  ADIDAS_CLICK_SHIP_METHODS,
  aggregateAdidasOrderLines,
  buildAdidasInventoryIndex,
  downloadClickImportFile,
  planAdidasClickOrder,
  resolvePortalSize,
  sanitizeClickCustomerPo,
  splitClickSizeLabel,
} from '../lib/adidasClickPlan';

const CHOICE_LABELS = {
  [ADIDAS_CLICK_CHOICES.AVAILABLE_NOW]: 'Available now only',
  [ADIDAS_CLICK_CHOICES.COMPLETE_SKU]: 'Complete SKU',
  [ADIDAS_CLICK_CHOICES.EACH_SIZE]: 'Each size when ready',
  [ADIDAS_CLICK_CHOICES.HOLD]: 'Hold & re-check',
};

const defaultConfig = (payload) => ({
  default_choice: ADIDAS_CLICK_CHOICES.COMPLETE_SKU,
  sku_choices: {},
  preferences: {},
  customer_po: sanitizeClickCustomerPo(payload?.po_number),
  ship_method: 'Default',
  delivery_location: payload?.ship_to
    ? { type: 'one_time', address: payload.ship_to }
    : { type: 'saved', number: ADIDAS_CLICK_DEFAULT_SHIP_TO },
});

export function getAdidasClickConfig(payload, value) {
  const base = defaultConfig(payload);
  return {
    ...base,
    ...(value || {}),
    sku_choices: { ...base.sku_choices, ...(value?.sku_choices || {}) },
    preferences: { ...base.preferences, ...(value?.preferences || {}) },
  };
}

export default function AdidasClickAssignPanel({
  payload,
  inventoryRows = [],
  savedPreferences = {},
  value,
  onChange,
  onSavePreference,
}) {
  const config = getAdidasClickConfig(payload, value);
  const preferences = { ...savedPreferences, ...config.preferences };
  const index = useMemo(() => buildAdidasInventoryIndex(inventoryRows), [inventoryRows]);
  const plan = useMemo(() => planAdidasClickOrder({
    lines: payload?.lines || [],
    inventoryRows,
    preferences,
    defaultChoice: config.default_choice,
    skuChoices: config.sku_choices,
    customerPo: config.customer_po,
    shipMethod: config.ship_method,
    deliveryLocation: config.delivery_location,
  }), [payload, inventoryRows, preferences, config.default_choice, config.sku_choices, config.customer_po, config.ship_method, config.delivery_location]);

  const update = (patch) => onChange?.({ ...config, ...patch });
  const updateAddress = (patch) => update({
    delivery_location: {
      type: 'one_time',
      address: { ...(config.delivery_location?.address || {}), ...patch },
    },
  });
  const ageHours = index.oldestSyncedAt ? (Date.now() - new Date(index.oldestSyncedAt).getTime()) / 36e5 : null;
  const stale = ageHours == null || ageHours > 24;
  const lines = useMemo(() => aggregateAdidasOrderLines(payload?.lines || []).lines, [payload]);

  const variantsFor = (line) => {
    const known = Object.keys(index.bySku[line.sku] || {});
    const variants = new Set();
    Object.keys(line.sizes || {}).forEach((portalSize) => {
      const result = resolvePortalSize(portalSize, known, preferences[line.sku]);
      result.candidates.forEach((candidate) => {
        const token = splitClickSizeLabel(candidate).variant;
        if (token) variants.add(token);
      });
    });
    return [...variants].sort((a, b) => Number(a) - Number(b));
  };

  return <div style={{ marginBottom: 12, border: '1px solid #93c5fd', borderRadius: 10, overflow: 'hidden' }}>
    <div style={{ padding: '10px 14px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <b style={{ color: '#0f172a' }}>adidas CLICK import plan</b>
      <span className="badge badge-gray">PO {config.customer_po || 'required'}</span>
      <span className="badge badge-blue">{plan.import_rows.reduce((sum, row) => sum + row.qty, 0)} pcs planned</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: stale ? '#b91c1c' : '#166534', fontWeight: 700 }}>
        {ageHours == null ? '⚠ No inventory sync data' : `${stale ? '⚠' : '✓'} Inventory ${ageHours < 1 ? '<1h' : Math.round(ageHours) + 'h'} old`}
      </span>
    </div>

    <div style={{ padding: '10px 14px', background: stale ? '#fff7ed' : '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
      <label className="form-label">Order-level default</label>
      <select className="form-select" aria-label="Order-level default" value={config.default_choice} onChange={(e) => update({ default_choice: e.target.value })}>
        {Object.entries(CHOICE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>Override individual SKUs below. There is no “ask later” mode.</div>
    </div>

    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
      {lines.map((line, i) => {
        const skuPlan = plan.sku_plans.find((p) => p.sku === line.sku);
        const variants = variantsFor(line);
        const choice = config.sku_choices[line.sku] || config.default_choice;
        return <div key={`${line.sku}-${i}`} style={{ padding: '9px 14px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontFamily: 'ui-monospace,monospace' }}>{line.sku}</b>
            <select className="form-select" style={{ width: 190, padding: '4px 7px', fontSize: 11 }} value={choice} onChange={(e) => update({ sku_choices: { ...config.sku_choices, [line.sku]: e.target.value } })}>
              {Object.entries(CHOICE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            {variants.length > 1 && <select className="form-select" style={{ width: 145, padding: '4px 7px', fontSize: 11 }} value={preferences[line.sku] || ''} onChange={(e) => {
              const preference = e.target.value;
              update({ preferences: { ...config.preferences, [line.sku]: preference } });
              if (preference) onSavePreference?.(line.sku, preference);
            }}>
              <option value="">Choose variant…</option>
              {variants.map((variant) => <option key={variant} value={variant}>{variant}&quot; variant</option>)}
            </select>}
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
            {(skuPlan?.requested || []).map((request) => {
              const inv = request.click_size ? index.bySku[line.sku]?.[request.click_size] : null;
              const enough = inv && inv.stock >= request.qty;
              return <span key={request.portal_size} title={request.click_size ? `CLICK: ${request.click_size}` : (request.candidates || []).join(', ')}
                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: !request.click_size ? '#fee2e2' : enough ? '#dcfce7' : '#fef3c7', color: !request.click_size ? '#b91c1c' : enough ? '#166534' : '#92400e' }}>
                {request.portal_size}:{request.qty} → {request.click_size || 'choose variant'}{inv ? ` · now ${inv.stock}${inv.date ? ` · ${inv.date} +${inv.future_qty || 0}` : ''}` : ''}
              </span>;
            })}
          </div>
          {skuPlan?.unfilled?.length > 0 && <div style={{ color: '#b45309', fontSize: 10, marginTop: 4 }}>
            Unfilled: {skuPlan.unfilled.map((u) => `${u.click_size} ${u.qty}`).join(' · ')}
          </div>}
        </div>;
      })}
    </div>

    <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: '#f8fafc' }}>
      <div>
        <label className="form-label">Customer PO</label>
        <input className="form-input" aria-label="Customer PO" value={config.customer_po} onChange={(e) => update({ customer_po: sanitizeClickCustomerPo(e.target.value) })} />
        {sanitizeClickCustomerPo(payload?.po_number) !== String(payload?.po_number || '') && <div style={{ fontSize: 10, color: '#92400e' }}>CLICK-safe value (hyphens and unsupported characters removed).</div>}
      </div>
      <div>
        <label className="form-label">Shipping method</label>
        <select className="form-select" aria-label="Shipping method" value={config.ship_method} onChange={(e) => update({ ship_method: e.target.value })}>
          {ADIDAS_CLICK_SHIP_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
        </select>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label className="form-label">Delivery location</label>
        <select className="form-select" aria-label="Delivery location" value={config.delivery_location?.type === 'one_time' ? 'one_time' : config.delivery_location?.number}
          onChange={(e) => update({ delivery_location: e.target.value === 'one_time'
            ? { type: 'one_time', address: payload?.ship_to || {} }
            : { type: 'saved', number: e.target.value } })}>
          {ADIDAS_CLICK_LOCATIONS.map((location) => <option key={location.number} value={location.number}>{location.label}</option>)}
          <option value="one_time">One-time drop-ship address</option>
        </select>
        {config.delivery_location?.type === 'one_time' && <div style={{ marginTop: 7, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <input className="form-input" aria-label="One-time company or attention" placeholder="Company / Attention 1" value={config.delivery_location.address?.name || ''} onChange={(e) => updateAddress({ name: e.target.value })} />
          <input className="form-input" aria-label="One-time attention line 2" placeholder="Attention 2 (optional)" value={config.delivery_location.address?.attention || ''} onChange={(e) => updateAddress({ attention: e.target.value })} />
          <input className="form-input" aria-label="One-time street address" style={{ gridColumn: '1 / -1' }} placeholder="Street address" value={config.delivery_location.address?.line1 || ''} onChange={(e) => updateAddress({ line1: e.target.value })} />
          <input className="form-input" aria-label="One-time address line 2" style={{ gridColumn: '1 / -1' }} placeholder="Address line 2 (optional)" value={config.delivery_location.address?.line2 || ''} onChange={(e) => updateAddress({ line2: e.target.value })} />
          <input className="form-input" aria-label="One-time city" placeholder="City" value={config.delivery_location.address?.city || ''} onChange={(e) => updateAddress({ city: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input className="form-input" aria-label="One-time state" placeholder="State" value={config.delivery_location.address?.state || ''} onChange={(e) => updateAddress({ state: e.target.value })} />
            <input className="form-input" aria-label="One-time ZIP" placeholder="ZIP" value={config.delivery_location.address?.zip || ''} onChange={(e) => updateAddress({ zip: e.target.value })} />
          </div>
        </div>}
      </div>
    </div>

    <div style={{ padding: '8px 14px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: plan.issues.length ? '#b91c1c' : '#166534', flex: 1 }}>
        {plan.issues.length ? `⚠ ${plan.issues.map((issue) => issue.message).join(' ')}` : '✓ Plan resolved. Grok Bot can import this without interpreting prose.'}
      </span>
      <button type="button" className="btn btn-sm btn-secondary" disabled={!plan.import_rows.length || plan.issues.some((issue) => issue.code !== 'insufficient_inventory')}
        onClick={() => downloadClickImportFile(plan)}>Download CLICK import file</button>
    </div>
  </div>;
}
