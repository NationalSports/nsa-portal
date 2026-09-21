/* eslint-disable */
// Origin picker for shipping labels — "where is this parcel leaving from?".
// Shared by the Webstores batch/order label buttons and the OMG order portal so
// the two surfaces can never drift apart on which locations exist.
//
// value/onChange carry a location CODE (src/lib/shipFrom.js). The chosen address
// is shown underneath so nobody has to trust the label alone.

import React from 'react';
// Namespace import — shipFrom.js is CommonJS (shared with the Netlify functions).
import * as SHIPFROM from '../lib/shipFrom';
const { SHIP_FROM_LOCATIONS, shipFromCode, shipFromAddressLine } = SHIPFROM;

export default function ShipFromPicker({ value, onChange, label = 'Ships from', compact = false, style = {}, selectStyle = {}, disabled = false }) {
  const code = shipFromCode(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      {label && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>}
      <select
        value={code}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.value)}
        style={{ padding: compact ? '5px 8px' : '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: compact ? 12 : 13, fontWeight: 600, color: '#0f172a', cursor: disabled ? 'not-allowed' : 'pointer', ...selectStyle }}
      >
        {SHIP_FROM_LOCATIONS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
      <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{shipFromAddressLine(code)}</span>
    </div>
  );
}
