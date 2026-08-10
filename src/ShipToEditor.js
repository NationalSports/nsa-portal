// Ship-to review + override for the vendor order modals (SanMar / S&S / Momentec).
//
// Every modal auto-selects a destination — the NSA warehouse, or the batch's deco
// vendor — and that stays the default. This adds the escape hatch: a rep can open
// the address, correct it, and submit to somewhere the auto-selection didn't cover
// (a customer's dock, a one-off event address, a suite number the vendor record is
// missing) without leaving the modal.
//
// An override is deliberately loud: while one is active the panel is purple and
// says so, because the address on screen no longer matches what the portal picked.
// Reset puts it back. All three vendors take the same ship-to shape:
//   { companyName, attentionTo, address1, address2, city, region, postalCode, country }
import React, { useState } from 'react';

// A ship-to the vendor will actually accept. Every vendor rejects (or silently
// mis-ships) an order missing any of these, so the modals block submit on it.
export function shipToIncomplete(s) {
  if (!s) return true;
  return ['companyName', 'address1', 'city', 'region', 'postalCode']
    .some(k => !String(s[k] || '').trim());
}

// One-line address summary for the modal headers.
export function formatShipTo(s) {
  if (!s) return '—';
  const cityLine = [s.city, s.region, s.postalCode].filter(Boolean).join(' ').trim();
  return [s.companyName, s.address1, s.address2, cityLine].filter(Boolean).join(', ');
}

const fieldRow = { display: 'flex', gap: 6 };

export default function ShipToEditor({
  auto,                 // the address the modal picked (warehouse / decorator)
  override,             // null = using `auto`, else the rep's edited copy
  onChange,             // (nextOverrideOrNull) => void
  disabled = false,
  shipVia = '',         // e.g. 'UPS Ground' — appended to the summary line
  autoLabel = 'auto-selected',
}) {
  const [open, setOpen] = useState(false);
  const ship = override || auto || {};
  const edited = !!override;
  const incomplete = shipToIncomplete(ship);

  const set = (key) => (e) => onChange({ ...ship, [key]: e.target.value });
  const startEdit = () => { setOpen(true); if (!override) onChange({ ...(auto || {}) }); };
  const reset = () => { onChange(null); setOpen(false); };

  return (
    <div style={{
      marginBottom: 12, padding: '8px 10px', borderRadius: 6, fontSize: 12,
      background: edited ? '#faf5ff' : '#f8fafc',
      border: '1px solid ' + (edited ? '#ddd6fe' : '#e2e8f0'),
      color: '#475569',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong>Ships to:</strong>
        <span style={{ flex: 1, minWidth: 220 }}>
          {formatShipTo(ship)}{shipVia ? ' · ' + shipVia : ''}
          {ship.attentionTo && <span style={{ marginLeft: 6, color: '#7c3aed', fontWeight: 700 }}>· Attn: {ship.attentionTo}</span>}
        </span>
        {edited && (
          <span style={{ fontSize: 10, fontWeight: 800, color: '#6d28d9', background: '#ede9fe', border: '1px solid #ddd6fe', borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Custom address
          </span>
        )}
        {!disabled && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => (open ? setOpen(false) : startEdit())}
          >
            {open ? 'Done' : '✏️ Edit address'}
          </button>
        )}
        {edited && !disabled && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={reset}
          >
            ↩ Reset to {autoLabel}
          </button>
        )}
      </div>

      {edited && !open && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#6d28d9' }}>
          Hand-edited — this overrides the {autoLabel} address and is what the vendor will ship to.
        </div>
      )}

      {open && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed ' + (edited ? '#ddd6fe' : '#e2e8f0'), display: 'grid', gap: 6, maxWidth: 520 }}>
          <div style={fieldRow}>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={lbl}>Company *</span>
              <input className="form-input" style={inp} value={ship.companyName || ''} onChange={set('companyName')} />
            </label>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={lbl}>Attention line</span>
              <input className="form-input" style={inp} placeholder="e.g. Receiving / DPO 1042" value={ship.attentionTo || ''} onChange={set('attentionTo')} />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={lbl}>Street address *</span>
            <input className="form-input" style={inp} value={ship.address1 || ''} onChange={set('address1')} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={lbl}>Suite / unit</span>
            <input className="form-input" style={inp} value={ship.address2 || ''} onChange={set('address2')} />
          </label>
          <div style={fieldRow}>
            <label style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={lbl}>City *</span>
              <input className="form-input" style={inp} value={ship.city || ''} onChange={set('city')} />
            </label>
            <label style={{ width: 70, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={lbl}>State *</span>
              <input
                className="form-input" style={inp} maxLength={2} value={ship.region || ''}
                onChange={e => onChange({ ...ship, region: e.target.value.toUpperCase() })}
              />
            </label>
            <label style={{ width: 100, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={lbl}>Zip *</span>
              <input className="form-input" style={inp} value={ship.postalCode || ''} onChange={set('postalCode')} />
            </label>
          </div>
          {incomplete && (
            <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 700 }}>
              ⚠ Company, street, city, state and zip are all required before this order can be submitted.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const lbl = { fontSize: 10, fontWeight: 700, color: '#64748b' };
const inp = { fontSize: 12 };
