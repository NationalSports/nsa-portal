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
// Non-positive cells are dropped, matching sumBoxContents — a corrupted negative size
// cell must not shrink the unit count printed on a physical box label.
export const boxUnits = (contents) =>
  (contents || []).reduce((a, e) => a + Object.values(e?.sizes || {}).reduce((b, v) => b + (+v > 0 ? +v : 0), 0), 0);

// po_id is part of the identity, NOT just a label: after three cartons become one box we
// must still answer "which PO did these 17 mediums come from" for short-ship claims and
// invoice reconciliation. Without it, the same garment received on two POs collapses into
// one line and the second PO's provenance is silently lost.
const _entryKey = (e) =>
  [e?.sku || '', e?.color || '', e?.so_id || '', e?.if_id || '', e?.po_id || ''].join('|');

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

// Fold N contents arrays into one (target first, then each source in scan order) — the
// multi-box twin of sumBoxContents, for merging 2–3 cartons in a single confirm.
export const mergeAllContents = (lists) => (lists || []).reduce((acc, c) => sumBoxContents(acc, c || []), []);

// Fold N source_refs arrays, de-duped, preserving target-first order.
export const mergeAllSourceRefs = (lists) => (lists || []).reduce((acc, r) => mergeSourceRefs(acc, r || []), []);

// Cross-customer guard. Takes the target + pending boxes already resolved to a customer
// ({id, customerId, customerName}); compares customer_id, falling back to so_id, and
// reports the distinct groups so the UI can name them in the warning.
// A box whose customer can't be resolved counts as its OWN group on purpose: an
// unidentified carton in a merge is exactly the case worth a second tap, not one to
// wave through. Warn, never hard-block — genuine multi-SO consolidation happens.
export const crossCustomerGroups = (boxes) => {
  const rows = (boxes || []).filter(Boolean).map((b) => ({
    id: b.id || '',
    key: b.customerId || b.soId || '',
    name: b.customerName || b.soId || 'Unknown customer',
  }));
  const keys = [...new Set(rows.map((r) => r.key))];
  return {
    mismatch: keys.length > 1,
    groups: keys.map((k) => ({ key: k, name: rows.find((r) => r.key === k).name, boxIds: rows.filter((r) => r.key === k).map((r) => r.id) })),
  };
};

// 4×6 label object for printQrLabel/downloadQrLabel (utils.js zones shape).
// Meta line renders as: BX-2001 · IF-1071 · PULLED — 6/16 (code + note);
// team stays the big program line, SO# the subtitle, and the SO memo (when the
// caller resolves one) sits under the team. QR encodes the plate:
// <scanBase>?scan=BX-2001.
// `supersedes` lists the plates this box absorbed. It prints as its own warning line so the
// warehouse knows to cover or bin the dead labels still taped to the merged-in cartons —
// those labels keep scanning (they redirect via merged_into), so the paper has to say so.
export const buildBoxLabel = (box, { program = '', memo = '', rep = '', scanBase = '', dateStr, supersedes = [] } = {}) => {
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
    memo: memo || '',
    rep: rep ? 'Rep: ' + rep : '',
    subtitle: box?.so_id || '',
    note: [box?.if_id, st.toUpperCase() + ' — ' + when].filter(Boolean).join(' · '),
    supersedes: (supersedes || []).filter(Boolean).length
      ? 'SUPERSEDES: ' + (supersedes || []).filter(Boolean).join(', ')
      : '',
    items,
    codeSub: boxUnits(box?.contents) + ' units · scan box',
  };
};
