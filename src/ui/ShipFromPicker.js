/* eslint-disable */
// Origin picker for shipping labels — "where is this parcel leaving from?".
// Shared by the Webstores batch/order label buttons, the store settings form,
// and the OMG order portal, so no surface can drift on which origins exist.
//
// Options are the two NSA sites plus every active decorator with an address on
// file (Settings → Deco Vendors, falling back to the linked Vendor record).
// value/onChange carry a location CODE (src/lib/shipFrom.js). The chosen
// address is shown underneath so nobody has to trust the label alone.

import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
// Namespace import — shipFrom.js is CommonJS (shared with the Netlify functions).
import * as SHIPFROM from '../lib/shipFrom';

const { SHIP_FROM_LOCATIONS, decoShipFromLocations, shipFromCode, shipFromAddressLine, decoIdFromCode } = SHIPFROM;

// Loads the decorator origins once per mount. Returns [] until loaded, so every
// caller can pass the result straight into the shipFrom helpers; a decorator
// code chosen before the list arrives still resolves once it does.
export function useDecoShipFromLocations() {
  const [locs, setLocs] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: dvs } = await supabase.from('deco_vendors').select('id,name,is_active,phone,address_line1,address_line2,city,state,zip,vendor_id');
        // Linked Vendor records supply the fallback address. Fetch exactly the
        // ones referenced — a linked vendor is not always flagged is_decorator,
        // and the server-side auto-label looks them up by id the same way.
        const ids = [...new Set((dvs || []).map((d) => d.vendor_id).filter(Boolean))];
        const { data: vs } = ids.length
          ? await supabase.from('vendors').select('id,name,contact_phone,address_line1,address_line2,city,state,zip').in('id', ids)
          : { data: [] };
        if (alive) setLocs(decoShipFromLocations(dvs || [], vs || []));
      } catch (_) { /* no decorators → NSA sites only */ }
    })();
    return () => { alive = false; };
  }, []);
  return locs;
}

export default function ShipFromPicker({ value, onChange, decoLocations = [], label = 'Ships from', compact = false, style = {}, selectStyle = {}, disabled = false }) {
  const code = shipFromCode(value, decoLocations);
  // A stored decorator code whose decorator is no longer on file: keep it
  // visible (and selected) rather than silently snapping to the warehouse.
  const orphan = decoIdFromCode(code) && !decoLocations.some((l) => l.code === code);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      {label && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>}
      <select
        value={code}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.value)}
        style={{ padding: compact ? '5px 8px' : '7px 10px', borderRadius: 8, border: '1px solid ' + (orphan ? '#fca5a5' : '#cbd5e1'), background: '#fff', fontSize: compact ? 12 : 13, fontWeight: 600, color: '#0f172a', cursor: disabled ? 'not-allowed' : 'pointer', ...selectStyle }}
      >
        <optgroup label="NSA">
          {SHIP_FROM_LOCATIONS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </optgroup>
        {decoLocations.length > 0 && (
          <optgroup label="Decorator ships direct">
            {decoLocations.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </optgroup>
        )}
        {orphan && <option value={code}>Decorator (not on file)</option>}
      </select>
      <span style={{ fontSize: 10.5, color: orphan ? '#b91c1c' : '#94a3b8' }}>{shipFromAddressLine(code, decoLocations)}</span>
    </div>
  );
}
