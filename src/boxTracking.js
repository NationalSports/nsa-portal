// ── BOX TRACKING (BX-#### license plates) — pure helpers ──────────────────────
// v1 of BOX_TRACKING_PLAN.md. A box is a physical container whose contents can
// change (combine, add), so the id is an opaque global plate ('BX-2001'); the
// human context (team, IF#, SO#) is printed on the label, not encoded in the id.
// Everything here is pure (no supabase, no window) so it unit-tests directly;
// App.js/MobilePortal own the persistence and UI around these.

// A scanned value counts as a box plate when it looks like BX-<something>.
export const isBoxCode = (v) => /^BX-[A-Z0-9]+$/i.test(String(v || '').trim());

// Plate from the atomic counter (next_counter('box_plate') → 1,2,3…): BX-2001, BX-2002…
export const plateFromCounter = (n) => 'BX-' + (2000 + n);

export const BOX_STATUS_META = {
  staged: { label: 'Staged', color: '#92400e', bg: '#fef3c7' },
  at_deco: { label: 'At Deco', color: '#5b21b6', bg: '#ede9fe' },
  shipped: { label: 'Shipped', color: '#166534', bg: '#dcfce7' },
  combined: { label: 'Combined', color: '#475569', bg: '#f1f5f9' },
};

// Total units across a contents array ([ {sku,name,color,so_id,if_id,sizes:{S:3}} ]).
export const boxUnits = (contents) =>
  (contents || []).reduce((a, e) => a + Object.values(e?.sizes || {}).reduce((b, v) => b + (+v || 0), 0), 0);

const _entryKey = (e) => [e?.sku || '', e?.color || '', e?.so_id || '', e?.if_id || ''].join('|');

// Combine two contents arrays: same SKU+color+refs lines merge with sizes summed,
// distinct lines are kept. Zero/negative size cells are dropped.
export const sumBoxContents = (a, b) => {
  const out = [];
  const byKey = {};
  [...(a || []), ...(b || [])].forEach((e) => {
    if (!e) return;
    const k = _entryKey(e);
    if (!byKey[k]) {
      byKey[k] = { ...e, sizes: {} };
      out.push(byKey[k]);
    }
    Object.entries(e.sizes || {}).forEach(([sz, v]) => {
      const n = +v || 0;
      if (n > 0) byKey[k].sizes[sz] = (byKey[k].sizes[sz] || 0) + n;
    });
  });
  return out.filter((e) => Object.keys(e.sizes).length > 0);
};

// Build a boxes-table row. Plain object shaped exactly like the 00185 schema.
export const makeBoxRow = ({ id, kind = 'fulfillment', contents = [], soId = null, ifId = null, poId = null, createdBy = null, now = new Date().toISOString() }) => ({
  id,
  kind,
  contents,
  source_refs: [
    ifId && { type: 'IF', id: ifId },
    poId && { type: 'PO', id: poId },
    soId && { type: 'SO', id: soId },
  ].filter(Boolean),
  so_id: soId,
  if_id: ifId,
  po_id: poId,
  status: 'staged',
  merged_into: null,
  bin: null,
  created_by: createdBy,
  created_at: now,
  updated_at: now,
});

// Merge source_refs, de-duped by type+id (survivor keeps its own order first).
export const mergeSourceRefs = (a, b) =>
  [...(a || []), ...(b || [])].filter(
    (r, i, arr) => r && arr.findIndex((r2) => r2 && r2.type === r.type && r2.id === r.id) === i
  );

// 4×6 label object for printQrLabel/downloadQrLabel (utils.js zones shape).
// Meta line renders as: BX-2001 · IF-1071 · PULLED — 6/16 (code + note);
// team stays the big program line, SO# the subtitle — unchanged from the
// merged label design. QR encodes the plate: <scanBase>?scan=BX-2001.
export const buildBoxLabel = (box, { program = '', rep = '', scanBase = '', dateStr } = {}) => {
  const st = BOX_STATUS_META[box?.status]?.label || box?.status || 'Staged';
  const when = dateStr || new Date(box?.updated_at || Date.now()).toLocaleDateString();
  const items = (box?.contents || []).map((e) => {
    const sz = Object.entries(e.sizes || {}).filter(([, v]) => (+v || 0) > 0);
    const q = sz.reduce((a, [, v]) => a + (+v || 0), 0);
    return {
      title: ((e.sku || '') + ' ' + (e.name || '')).trim(),
      detail: [e.color && e.color !== '—' ? e.color : '', q + ' units'].filter(Boolean).join(' · '),
      sizes: sz.map(([s, v]) => s + ': ' + v).join('  '),
    };
  });
  return {
    code: box?.id || '',
    qrData: scanBase ? scanBase + '?scan=' + encodeURIComponent(box?.id || '') : (box?.id || ''),
    program,
    rep: rep ? 'Rep: ' + rep : '',
    subtitle: box?.so_id || '',
    note: [box?.if_id, st.toUpperCase() + ' — ' + when].filter(Boolean).join(' · '),
    items,
    codeSub: boxUnits(box?.contents) + ' units · scan box',
  };
};
