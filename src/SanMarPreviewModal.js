// SanMar PO submission modal — review the exact PromoStandards v24.3 sendPO payload,
// then place the order. env='prod' submits a LIVE production order (ships real goods);
// env='test' targets the onboarding TEST host. Credentials (SanMar.com username +
// password) are injected server-side by the proxy and never appear here.
//
// On open it resolves each line's SanMar Unique_Key (partId) from the product API
// (orders don't carry it). The lookup is correct-biased — it only fills a key on an
// exact color+size match and never guesses, so an unmatched line stays blocked and
// the rep falls back to manual ordering rather than risk shipping the wrong item.
import React, { useEffect, useMemo, useState } from 'react';
import { buildSanMarPOPayload, buildSanMarPOSoap, buildSanMarLineItems, SANMAR_PO_ENDPOINTS } from './sanmarPO';
import { sanmarSubmitPO, sanmarResolvePartIds, sanmarGetWarehouseStock, sanmarStyleVariants } from './vendorApis';
import WarehouseChips, {
  rankWarehouses, pickConsolidatedWarehouse, warehouseKey, warehouseCity,
  shipToCoords, warehouseCoords, milesBetween, SANMAR_WAREHOUSE_INFO,
} from './WarehouseChips';
import ShipToEditor, { shipToIncomplete } from './ShipToEditor';
import { NSA, NSA_WAREHOUSE } from './constants';

// SanMar Option 3, "Warehouse Selection": the rep names the warehouse and it rides
// on each line as <shar:fobId>. It only takes effect once SanMar reconfigures our
// integration account off Option 1 (Warehouse Consolidation) — until then SanMar
// picks the warehouse and fobId is ignored, so the picker stays read-only rather
// than promising routing we can't deliver. Flip this to true after SanMar confirms
// (request it via sanmarintegrations@sanmar.com).
// NOTE Option 3 removes the safety net: a line short at the chosen warehouse puts
// the WHOLE order on hold for manual keying instead of bumping to the next DC.
const WAREHOUSE_SELECTION_ENABLED = false;

// SanMar ships integrated orders to NSA's receiving address (Warehouse Consolidation).
// PromoStandards requires a ContactDetails block on both OrderContact and ShipTo — without
// it SanMar rejects the PO ("element 'shar:shipmentId'… ContactDetails is expected").
const NSA_SHIP_TO = {
  attentionTo: 'Receiving',
  companyName: NSA.name,
  address1: NSA_WAREHOUSE.street1,
  address2: NSA_WAREHOUSE.street2,
  city: NSA_WAREHOUSE.city,
  region: NSA_WAREHOUSE.state,
  postalCode: NSA_WAREHOUSE.zip,
  country: 'US',
};

export default function SanMarPreviewModal({ batchPOs, poNumber, vendorName = 'SanMar', env = 'prod', shipTo, shipWarning = '', shipToDecoId = null, initialDpoNumber = '', decoVendors = [], onClose, onSubmitted }) {
  const [tab, setTab] = useState('lines'); // 'lines' | 'xml'
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitState, setSubmitState] = useState('idle'); // idle | submitting | success | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [bookErr, setBookErr] = useState(''); // order placed at vendor but NOT recorded in the portal
  // partId (Unique_Key) resolution
  const [resolving, setResolving] = useState(true);
  const [resolvedParts, setResolvedParts] = useState({}); // lineNumber -> uniqueKey
  const [candidates, setCandidates] = useState({});       // STYLE -> [{color,size,uniqueKey}]
  const [resolveErr, setResolveErr] = useState('');
  // Hand-picked parts, lineNumber -> {uniqueKey,style,color,size}. The automatic match is
  // correct-biased and refuses to guess, so a naming difference SanMar's catalog can't be
  // talked out of (a cap sized "MD-LG (ONE SIZE FITS MOST)" against their "OSFA") used to
  // dead-end the whole order. The rep can now search SanMar and say which part it is.
  const [manualParts, setManualParts] = useState({});
  const [pickerLine, setPickerLine] = useState(null);     // lineNumber whose picker is open
  // Per-warehouse availability keyed by "style|color|size" -> [{id,qty}] (SanMar's legacy
  // inventory list, warehouse order 1-7,12) — informational "ships from" display only;
  // a lookup failure leaves the column blank, never blocks.
  const [whseByLine, setWhseByLine] = useState(null); // null = loading

  // Ship-to selector state; when shipToDecoId is set the mode is pre-determined (no manual picker).
  // 'order' appears only when the caller resolved a destination off the batch itself
  // (a drop-ship program address, or a write-in address on the PO) — without it that
  // address would sit under a radio labelled "NSA Warehouse".
  const isPrescribed = !!shipToDecoId;
  const [shipMode, setShipMode] = useState(shipToDecoId ? 'deco' : (shipTo ? 'order' : 'nsa')); // 'nsa' | 'deco' | 'order'
  const activeDecoVendors = useMemo(() => (decoVendors || []).filter(v => v.is_active !== false), [decoVendors]);
  const [selectedDecoId, setSelectedDecoId] = useState(() => shipToDecoId || activeDecoVendors[0]?.id || '');
  const [dpoNumber, setDpoNumber] = useState(initialDpoNumber || '');
  // Attention-line value from the DPO field: ALWAYS "DPO ..." — the prefix is what lets the
  // decorator's receiving desk match the box to their job. Idempotent so a field already holding
  // the full "DPO 1042 XYZ" (the callers now pass po_id verbatim) doesn't get double-prefixed.
  const dpoAttn = (v) => { const t = String(v || '').trim(); return t ? (/^dpo\b/i.test(t) ? t : 'DPO ' + t) : ''; };
  const [inlineAddr, setInlineAddr] = useState({ address_line1: '', address_line2: '', city: '', state: '', zip: '' });

  // Keep selectedDecoId in sync if decoVendors loads after mount
  useEffect(() => {
    if (!selectedDecoId && activeDecoVendors.length > 0) setSelectedDecoId(activeDecoVendors[0].id);
  }, [activeDecoVendors, selectedDecoId]);

  const selectedDeco = useMemo(() => activeDecoVendors.find(v => v.id === selectedDecoId) || null, [activeDecoVendors, selectedDecoId]);
  const hasDecoAddr = selectedDeco && selectedDeco.address_line1 && selectedDeco.city && selectedDeco.state && selectedDeco.zip;

  const isLive = env === 'prod';

  // Hand-edited ship-to (null = use the auto-selected warehouse/decorator address).
  const [shipOverride, setShipOverride] = useState(null);
  // Re-selecting a destination replaces the address wholesale, so a stale override
  // must not silently survive it.
  useEffect(() => { setShipOverride(null); }, [shipMode, selectedDecoId]);

  // The address the modal picks on its own — warehouse or decorator.
  const autoShip = useMemo(() => {
    let effectiveShip;
    if (shipMode === 'deco' && selectedDeco) {
      const a1 = selectedDeco.address_line1 || inlineAddr.address_line1 || '';
      const a2 = selectedDeco.address_line2 || inlineAddr.address_line2 || '';
      const city = selectedDeco.city || inlineAddr.city || '';
      const state = selectedDeco.state || inlineAddr.state || '';
      const zip = selectedDeco.zip || inlineAddr.zip || '';
      effectiveShip = {
        attentionTo: dpoAttn(dpoNumber) || (selectedDeco.contact_name || 'Receiving'),
        companyName: selectedDeco.name,
        address1: a1,
        address2: a2,
        city,
        region: state,
        postalCode: zip,
        country: 'US',
      };
    } else if (shipMode === 'order' && shipTo) {
      effectiveShip = shipTo;
    } else {
      effectiveShip = NSA_SHIP_TO;
    }
    return effectiveShip;
  }, [shipTo, shipMode, selectedDeco, dpoNumber, inlineAddr]);

  // Base lines (no network) — built WITHOUT the ship-to, and memoized separately from the
  // payload below. Lines don't vary by destination, but folding them into a ship-dependent
  // memo re-fired the partId resolver on every keystroke in the address editor AND the
  // inline deco-address fields (owner 2026-08-13: the same chain in SSOrderModal blanked
  // every matched SKU when the ship-to was edited).
  const baseLines = useMemo(() => buildSanMarLineItems(batchPOs).lines, [batchPOs]);

  // The payload still tracks the ship-to (that's the point of editing it) and still builds
  // its own copy of the lines, so its _warnings stay populated. Rebuilding it per keystroke
  // is pure CPU — what mattered is that the resolver chain above no longer hangs off it.
  const base = useMemo(() => {
    const effectiveShip = shipOverride || autoShip;
    const p = buildSanMarPOPayload({ poNumber, batchPOs, shipTo: effectiveShip });
    return { payload: p, totals: p._summary, effectiveShip };
  }, [batchPOs, poNumber, autoShip, shipOverride]);

  const ship = base.effectiveShip;

  // Lines still missing a partId after the base build — these need a live lookup.
  const missing = useMemo(
    () => baseLines.filter(l => !l.partId).map(l => ({ key: l.lineNumber, style: l.style, color: l.color, size: l.size })),
    [baseLines]
  );

  useEffect(() => {
    let cancelled = false;
    if (!missing.length) { setResolving(false); return; }
    setResolving(true); setResolveErr('');
    sanmarResolvePartIds(missing)
      // Merge, never replace: sanmarResolvePartIds swallows per-style API failures and
      // returns an empty map, so a degraded re-run must not wipe partIds already matched.
      .then(({ resolved, candidates }) => { if (cancelled) return; setResolvedParts(prev => ({ ...prev, ...(resolved || {}) })); setCandidates(prev => ({ ...prev, ...(candidates || {}) })); })
      .catch(e => { if (!cancelled) setResolveErr(e.message || 'Part ID lookup failed'); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [missing]);

  // Overlay resolved partIds onto the lines, then recompute warnings + the payload
  // that will actually be submitted.
  // A hand-picked part outranks both the order's own partId and the resolver's match — the
  // picker exists for the lines those two got wrong or couldn't make. SanMar's own spelling
  // of the chosen part replaces ours on the line, so the payload, the warehouse lookup and
  // the vendor_keys we record all describe the item that will actually ship; what the order
  // said is kept on _manual so the table can show both.
  const lines = useMemo(
    () => baseLines.map(l => {
      const man = manualParts[l.lineNumber];
      if (man && man.uniqueKey) {
        const style = man.style || l.style, color = man.color || l.color, size = man.size || l.size;
        return {
          ...l, partId: man.uniqueKey, style, color, size,
          description: [style, color, size].filter(Boolean).join(' ').replace(/,/g, ' '),
          _manual: { orderedStyle: l.style, orderedColor: l.color, orderedSize: l.size },
        };
      }
      return l.partId ? l : { ...l, partId: resolvedParts[l.lineNumber] || '' };
    }),
    [baseLines, resolvedParts, manualParts]
  );
  // Changing what ships un-confirms the order: the checkbox says "I confirm this is a real
  // order", and it was checked against the previous set of parts.
  const manualKey = useMemo(() => JSON.stringify(manualParts), [manualParts]);
  useEffect(() => { setConfirmed(false); }, [manualKey]);
  const warnings = useMemo(
    () => lines.filter(l => !l.partId).map(l => `Line ${l.lineNumber} (${[l.style, l.color, l.size].filter(Boolean).join(' ')}) is missing a SanMar partId / Unique_Key`),
    [lines]
  );
  // Forced ship-from warehouse (SanMar warehouse number, '' = let SanMar route).
  const [forcedWhse, setForcedWhse] = useState('');
  // Lines as submitted: a forced warehouse rides on every line as fobId.
  const submitLines = useMemo(
    () => (forcedWhse ? lines.map(l => ({ ...l, fobId: String(forcedWhse) })) : lines),
    [lines, forcedWhse]
  );
  const payload = useMemo(() => ({ ...base.payload, PO: { ...base.payload.PO, lineItems: submitLines } }), [base.payload, submitLines]);
  const soap = useMemo(() => buildSanMarPOSoap(payload, { id: '<from env>' }), [payload]);
  const totals = base.totals;

  // Fetch per-warehouse stock for every unique style+color+size on the order (one
  // legacy-inventory call each) — matched back to each line by the same key.
  const _whseKey = (l) => [l.style, l.color, l.size].map(s => String(s || '').toUpperCase().trim()).join('|');
  const whseDescriptors = useMemo(() => {
    const seen = new Set(); const out = [];
    // partId rides along so the lookup can use the part's EXACT catalog color/size
    // spelling (the legacy service errors on our abbreviated order colors).
    for (const l of lines) { const k = _whseKey(l); if (!l.style || seen.has(k)) continue; seen.add(k); out.push({ key: k, style: l.style, color: l.color, size: l.size, partId: l.partId || '' }); }
    return out;
  }, [lines]);
  const whseFetchKey = useMemo(() => whseDescriptors.map(d => d.key + ':' + d.partId).sort().join(','), [whseDescriptors]);
  useEffect(() => {
    let cancelled = false;
    // Wait for partId resolution — the catalog-spelling lookup needs each line's partId.
    if (!whseFetchKey || resolving) return;
    setWhseByLine(null);
    sanmarGetWarehouseStock(whseDescriptors)
      .then(m => { if (!cancelled) setWhseByLine(m || {}); })
      .catch(() => { if (!cancelled) setWhseByLine({}); });
    return () => { cancelled = true; };
  }, [whseFetchKey, resolving]);

  // Per-line warehouse rows, each carrying its distance from the ship-to. SanMar
  // routes by proximity, so the prediction has to rank by distance — ranking by
  // "who holds the most stock" pointed at Cincinnati/Minneapolis for a California
  // ship-to when Reno and Phoenix were both full.
  const shipCoords = useMemo(() => shipToCoords(ship), [ship]);
  const lineWhseRows = useMemo(() => {
    const map = {};
    for (const l of lines) {
      const k = _whseKey(l);
      if (map[k]) continue;
      map[k] = (whseByLine?.[k] || []).filter(w => w.qty > 0).map(w => {
        const city = warehouseCity(w.name, w.id);
        return {
          id: w.id,
          label: city.split(',')[0],
          city,
          qty: w.qty,
          dist: milesBetween(shipCoords, warehouseCoords(w.name, w.id)),
        };
      });
    }
    return map;
  }, [lines, whseByLine, shipCoords]);

  // SanMar consolidates: the whole PO ships from the closest warehouse that can
  // fill every line. Predict that one DC for all lines (null = no single warehouse
  // covers the order, so SanMar will split and each line falls back to its own).
  const consolidatedWhse = useMemo(
    () => pickConsolidatedWarehouse(lines.map(l => ({ rows: lineWhseRows[_whseKey(l)] || [], need: l.quantity }))),
    [lines, lineWhseRows]
  );

  const consolidatedRow = useMemo(() => {
    if (!consolidatedWhse || !lines.length) return null;
    return (lineWhseRows[_whseKey(lines[0])] || []).find(r => warehouseKey(r) === consolidatedWhse) || null;
  }, [consolidatedWhse, lines, lineWhseRows]);

  // Stock at a forced warehouse, matched to the inventory rows by city name (the
  // inventory service's location ids aren't the same numbering as fobId).
  const forcedInfo = forcedWhse ? SANMAR_WAREHOUSE_INFO[forcedWhse] : null;
  const forcedRowFor = (rows) => {
    if (!forcedInfo) return null;
    const city = forcedInfo.city.split(',')[0].toLowerCase();
    return (rows || []).find(r => String(r.label || '').toLowerCase().includes(city)
      || String(r.city || '').toLowerCase().includes(city)) || null;
  };
  // Lines the forced warehouse can't cover — SanMar puts the ENTIRE order on hold
  // for one of these, so it's a hard warning, not a nudge.
  const forcedShort = useMemo(() => {
    if (!forcedInfo) return [];
    return lines.filter(l => {
      const row = forcedRowFor(lineWhseRows[_whseKey(l)]);
      return !row || row.qty < l.quantity;
    }).map(l => ({ line: l, have: forcedRowFor(lineWhseRows[_whseKey(l)])?.qty ?? 0 }));
  }, [forcedInfo, lines, lineWhseRows]);

  // Styles still unresolved → surface what SanMar actually returned for them.
  const unresolvedStyles = useMemo(() => {
    const s = new Set(lines.filter(l => !l.partId).map(l => String(l.style || '').toUpperCase().trim()));
    return [...s];
  }, [lines]);

  const copyXml = () => {
    navigator.clipboard?.writeText(soap);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Block submit if decorator mode but address is incomplete. A hand-edited
  // ship-to supersedes both checks — the rep has supplied the address themselves.
  const decoAddrIncomplete = !shipOverride && shipMode === 'deco' && selectedDeco && !hasDecoAddr
    && (!inlineAddr.address_line1.trim() || !inlineAddr.city.trim() || !inlineAddr.state.trim() || !inlineAddr.zip.trim());
  const decoNoVendor = !shipOverride && shipMode === 'deco' && !selectedDeco;
  // Whatever the source, the address that actually goes to SanMar has to be complete.
  const shipIncomplete = shipToIncomplete(ship);

  const blocked = lines.length === 0 || warnings.length > 0 || resolving || decoAddrIncomplete || decoNoVendor || shipIncomplete;
  const done = submitState === 'success';
  const submitting = submitState === 'submitting';
  const canSubmit = !blocked && confirmed && !submitting && !done;

  const doSubmit = async () => {
    if (!canSubmit) return;
    setSubmitState('submitting');
    setErrorMsg('');
    let r;
    try {
      r = await sanmarSubmitPO(payload, env);
    } catch (e) {
      setErrorMsg(e.message || 'Submit failed — try again or place the order manually on sanmar.com.');
      setSubmitState('error');
      return;
    }
    // SanMar accepted the order — this is a success no matter what the local bookkeeping does.
    setResult(r);
    setSubmitState('success');
    // Promote/clear the batch OUTSIDE the submit try: a bookkeeping error must never make a
    // genuinely-placed order look like it failed. But it must not fail SILENTLY either —
    // NSA 4536 was placed at SanMar with zero portal record because the (async) bookkeeping
    // result was ignored. Await it and surface anything short of a recorded batch number.
    if (onSubmitted) {
      try {
        const recorded = await onSubmitted(r, submitLines);
        if (!recorded) setBookErr('the recording step reported that nothing was written to the portal');
      } catch (e) {
        console.error('[SanMar] order placed but post-order bookkeeping failed:', e);
        setBookErr(e.message || 'recording failed with an error');
      }
    }
  };

  const safeClose = submitting ? undefined : onClose;

  return (
    <div className="modal-overlay" onClick={safeClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="modal-header">
          <h2>{done ? '✅' : isLive ? '🚀' : '🧪'} {vendorName} Order — {done ? 'Submitted' : 'Review & Submit'}</h2>
          <button className="modal-close" onClick={safeClose}>x</button>
        </div>
        <div className="modal-body">
          {done ? (
            <div style={{ padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 12, fontSize: 13, color: '#166534' }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>✓ Order placed with SanMar{isLive ? '' : ' (TEST)'}</div>
              <div>SanMar accepted the order and returned a transaction ID. A confirmation email will follow to your shipping-notification address.</div>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Stat label="PO Number" value={result?.orderNumber || poNumber} mono />
                <Stat label="Transaction ID" value={result?.transactionId || '—'} mono />
              </div>
              {bookErr && <div style={{ marginTop: 10, padding: 10, background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 8, color: '#92400e', fontWeight: 700 }}>
                ⚠ SanMar HAS this order, but the portal did NOT record it ({bookErr}).
                Do NOT submit or re-order this batch — record the PO on the sales order manually and remove the queue entries, or the batch will look unordered and get double-ordered.
              </div>}
            </div>
          ) : submitState === 'error' ? (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
              <strong>✗ SanMar did not accept the order — nothing was placed.</strong>
              <div style={{ marginTop: 4, fontFamily: 'monospace' }}>{errorMsg}</div>
              <div style={{ marginTop: 6 }}>Fix the issue and retry, or place this order manually on sanmar.com.</div>
            </div>
          ) : isLive ? (
            <div style={{ padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
              <strong style={{ color: '#b45309' }}>⚠ LIVE production order.</strong> Submitting sends this PO straight to SanMar and <strong>ships real goods</strong>. Review every line below — nothing is sent until you check the box and click <em>Submit Order</em>.
            </div>
          ) : (
            <div style={{ padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#1e40af' }}>
              <strong>🧪 TEST environment.</strong> Submits to SanMar's onboarding TEST host — no goods ship.
            </div>
          )}

          {!done && resolving && (
            <div style={{ padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#1e40af' }}>
              <strong>🔄 Looking up SanMar Part IDs…</strong> Matching each line to its SanMar Unique_Key. Submit unlocks once every line has one.
            </div>
          )}

          {!done && !resolving && resolveErr && (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
              <strong>⚠ Couldn't reach SanMar to look up Part IDs:</strong> {resolveErr}. Try reopening, or place this order manually.
            </div>
          )}

          {!done && !resolving && warnings.length > 0 && (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
              <strong>⚠ Cannot submit — {warnings.length} line(s) without a matched SanMar <code>partId</code> (Unique_Key):</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              <div style={{ marginTop: 6 }}>Click a line's <strong>⚠ missing</strong> in the table below to search SanMar and pick the part by hand.</div>
              {unresolvedStyles.some(st => (candidates[st] || []).length) && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #fecaca' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>What SanMar lists for these styles (for matching):</div>
                  {unresolvedStyles.map(st => (candidates[st] || []).length ? (
                    <div key={st} style={{ marginBottom: 4 }}>
                      <code>{st}</code>: {[...new Set((candidates[st] || []).map(c => c.color).filter(Boolean))].slice(0, 16).join(' · ') || '(no colors returned)'}
                    </div>
                  ) : null)}
                  <div style={{ marginTop: 4, color: '#7f1d1d' }}>If the right color/size is in that list but didn't match, it's a naming difference — send me a screenshot and I'll fix the match. Otherwise, order these lines manually.</div>
                </div>
              )}
            </div>
          )}

          {/* Ship-to selector */}
          {!done && (
            <div style={{ marginBottom: 12, padding: '10px 12px', background: isPrescribed ? '#faf5ff' : '#f8fafc', border: '1px solid ' + (isPrescribed ? '#ede9fe' : '#e2e8f0'), borderRadius: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: isPrescribed ? '#7c3aed' : '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Ship To{isPrescribed ? ' — Decorator' : ''}</div>

              {isPrescribed ? (
                /* Prescribed deco mode — locked to the batch's deco vendor, show address + DPO# */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedDeco && hasDecoAddr && (
                    <div style={{ fontSize: 12, color: '#475569', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 4, padding: '6px 10px', fontWeight: 500 }}>
                      📍 <strong>{selectedDeco.name}</strong> · {selectedDeco.address_line1}{selectedDeco.address_line2 ? ', ' + selectedDeco.address_line2 : ''}, {selectedDeco.city} {selectedDeco.state} {selectedDeco.zip}
                    </div>
                  )}
                  {selectedDeco && !hasDecoAddr && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 5, padding: '8px 10px' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>
                        No address on file for {selectedDeco.name} — enter it below:
                      </div>
                      <div style={{ display: 'grid', gap: 6, maxWidth: 480 }}>
                        <input className="form-input" style={{ fontSize: 12 }} placeholder="Street address *" value={inlineAddr.address_line1} onChange={e => setInlineAddr(a => ({ ...a, address_line1: e.target.value }))} />
                        <input className="form-input" style={{ fontSize: 12 }} placeholder="Suite / unit (optional)" value={inlineAddr.address_line2} onChange={e => setInlineAddr(a => ({ ...a, address_line2: e.target.value }))} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input className="form-input" style={{ fontSize: 12, flex: 2 }} placeholder="City *" value={inlineAddr.city} onChange={e => setInlineAddr(a => ({ ...a, city: e.target.value }))} />
                          <input className="form-input" style={{ fontSize: 12, width: 60 }} placeholder="State *" maxLength={2} value={inlineAddr.state} onChange={e => setInlineAddr(a => ({ ...a, state: e.target.value.toUpperCase() }))} />
                          <input className="form-input" style={{ fontSize: 12, width: 90 }} placeholder="Zip *" value={inlineAddr.zip} onChange={e => setInlineAddr(a => ({ ...a, zip: e.target.value }))} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b' }}>DPO # <span style={{ fontWeight: 400, color: '#94a3b8' }}>(goes in attention line — optional)</span></label>
                      <input className="form-input" style={{ fontSize: 12, width: 160 }} placeholder="e.g. DPO 1042" value={dpoNumber} onChange={e => setDpoNumber(e.target.value)} />
                    </div>
                    {dpoNumber.trim() && <div style={{ fontSize: 11, color: '#7c3aed', alignSelf: 'flex-end', paddingBottom: 4 }}>Attn: <strong>{dpoAttn(dpoNumber)}</strong></div>}
                  </div>
                </div>
              ) : (
                /* Manual mode — radio picker + decorator dropdown */
                <>
                  <div style={{ display: 'flex', gap: 20, marginBottom: shipMode === 'deco' ? 10 : 0 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', fontWeight: shipMode === 'nsa' ? 700 : 400 }}>
                      <input type="radio" name="sanmar-ship-mode" checked={shipMode === 'nsa'} onChange={() => setShipMode('nsa')} />
                      NSA Warehouse
                    </label>
                    {shipTo && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', fontWeight: shipMode === 'order' ? 700 : 400, color: shipMode === 'order' ? '#b45309' : 'inherit' }}>
                        <input type="radio" name="sanmar-ship-mode" checked={shipMode === 'order'} onChange={() => setShipMode('order')} />
                        Drop ship — order address
                      </label>
                    )}
                    {activeDecoVendors.length > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', fontWeight: shipMode === 'deco' ? 700 : 400, color: shipMode === 'deco' ? '#7c3aed' : 'inherit' }}>
                        <input type="radio" name="sanmar-ship-mode" checked={shipMode === 'deco'} onChange={() => setShipMode('deco')} />
                        Decorator (outside deco)
                      </label>
                    )}
                  </div>

                  {shipMode === 'deco' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b' }}>Decorator</label>
                          <select
                            className="form-select"
                            style={{ fontSize: 12, minWidth: 180 }}
                            value={selectedDecoId}
                            onChange={e => { setSelectedDecoId(e.target.value); setInlineAddr({ address_line1: '', address_line2: '', city: '', state: '', zip: '' }); }}
                          >
                            {activeDecoVendors.map(dv => <option key={dv.id} value={dv.id}>{dv.name}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b' }}>DPO # <span style={{ fontWeight: 400, color: '#94a3b8' }}>(goes in attention line)</span></label>
                          <input
                            className="form-input"
                            style={{ fontSize: 12, width: 140 }}
                            placeholder="e.g. DPO 1042"
                            value={dpoNumber}
                            onChange={e => setDpoNumber(e.target.value)}
                          />
                        </div>
                        {dpoNumber.trim() && (
                          <div style={{ fontSize: 11, color: '#7c3aed', alignSelf: 'flex-end', paddingBottom: 4 }}>
                            Attn: <strong>{dpoAttn(dpoNumber)}</strong>
                          </div>
                        )}
                      </div>

                      {selectedDeco && hasDecoAddr && (
                        <div style={{ fontSize: 11, color: '#475569', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 4, padding: '5px 8px' }}>
                          📍 <strong>{selectedDeco.name}</strong> · {selectedDeco.address_line1}{selectedDeco.address_line2 ? ', ' + selectedDeco.address_line2 : ''}, {selectedDeco.city} {selectedDeco.state} {selectedDeco.zip}
                        </div>
                      )}

                      {selectedDeco && !hasDecoAddr && (
                        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 5, padding: '8px 10px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>
                            No address on file for {selectedDeco.name} — enter it below for this order (or save it first in Settings → Deco Vendors):
                          </div>
                          <div style={{ display: 'grid', gap: 6, maxWidth: 480 }}>
                            <input
                              className="form-input"
                              style={{ fontSize: 12 }}
                              placeholder="Street address *"
                              value={inlineAddr.address_line1}
                              onChange={e => setInlineAddr(a => ({ ...a, address_line1: e.target.value }))}
                            />
                            <input
                              className="form-input"
                              style={{ fontSize: 12 }}
                              placeholder="Suite / unit (optional)"
                              value={inlineAddr.address_line2}
                              onChange={e => setInlineAddr(a => ({ ...a, address_line2: e.target.value }))}
                            />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input
                                className="form-input"
                                style={{ fontSize: 12, flex: 2 }}
                                placeholder="City *"
                                value={inlineAddr.city}
                            onChange={e => setInlineAddr(a => ({ ...a, city: e.target.value }))}
                          />
                          <input
                            className="form-input"
                            style={{ fontSize: 12, width: 60 }}
                            placeholder="State *"
                            maxLength={2}
                            value={inlineAddr.state}
                            onChange={e => setInlineAddr(a => ({ ...a, state: e.target.value.toUpperCase() }))}
                          />
                          <input
                            className="form-input"
                            style={{ fontSize: 12, width: 90 }}
                            placeholder="Zip *"
                            value={inlineAddr.zip}
                            onChange={e => setInlineAddr(a => ({ ...a, zip: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
                </>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <Stat label="PO Number" value={poNumber} mono />
            <Stat label="Line Items" value={totals.lineCount} />
            <Stat label="Total Units" value={totals.totalQty} />
            <Stat label="Total Cost" value={'$' + totals.totalCost.toFixed(2)} />
          </div>
          {!done && shipWarning && (
            <div style={{ padding: 10, background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#92400e', fontWeight: 600 }}>
              <strong>⚠ Mixed destinations in this batch.</strong> {shipWarning}
            </div>
          )}
          <ShipToEditor
            auto={autoShip}
            override={shipOverride}
            onChange={setShipOverride}
            disabled={done || submitting}
            shipVia="UPS Ground"
            autoLabel={shipMode === 'deco' ? 'decorator' : shipMode === 'order' ? 'order address' : 'warehouse'}
          />

          {/* Ships FROM — which SanMar warehouse fills the order */}
          {!done && (
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 12, padding: '8px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>Ships from:</strong>
                <select
                  className="form-select"
                  style={{ fontSize: 12, minWidth: 220 }}
                  value={forcedWhse}
                  disabled={!WAREHOUSE_SELECTION_ENABLED || submitting}
                  onChange={e => setForcedWhse(e.target.value)}
                >
                  <option value="">
                    Auto — closest warehouse that can fill the order{consolidatedRow ? ` (${consolidatedRow.city})` : ''}
                  </option>
                  {Object.entries(SANMAR_WAREHOUSE_INFO).map(([num, w]) => (
                    <option key={num} value={num}>{w.city} — ship everything from here</option>
                  ))}
                </select>
                {!WAREHOUSE_SELECTION_ENABLED && (
                  <span style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '3px 7px' }}>
                    Picking a warehouse needs SanMar to switch our integration account to <strong>Warehouse Selection</strong> — request it from sanmarintegrations@sanmar.com. Until then SanMar routes the order itself.
                  </span>
                )}
              </div>
              {forcedInfo && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#475569' }}>
                  Every line is sent with <code>fobId {forcedWhse}</code> ({forcedInfo.code} · {forcedInfo.city}).
                  If a line is short there, SanMar puts the <strong>whole order</strong> on hold for manual keying instead of using another warehouse.
                </div>
              )}
              {forcedInfo && forcedShort.length > 0 && (
                <div style={{ marginTop: 6, padding: '6px 8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 11, color: '#991b1b' }}>
                  <strong>⚠ {forcedInfo.city} can't cover {forcedShort.length} line(s):</strong>{' '}
                  {forcedShort.map(s => `${s.line.style} ${s.line.size} (need ${s.line.quantity}, have ${s.have})`).join(' · ')}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 10 }}>
            <TabBtn active={tab === 'lines'} onClick={() => setTab('lines')}>Line Items ({lines.length})</TabBtn>
            <TabBtn active={tab === 'xml'} onClick={() => setTab('xml')}>SOAP XML</TabBtn>
          </div>

          {tab === 'lines' && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th style={th}>#</th>
                    <th style={th}>Part ID</th>
                    <th style={th}>Style</th>
                    <th style={th}>Color</th>
                    <th style={th}>Size</th>
                    <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                    <th style={{ ...th, textAlign: 'right' }}>Unit $</th>
                    <th style={{ ...th, textAlign: 'right' }}>Line $</th>
                    <th style={th}>Ships From (stock)</th>
                    <th style={th}>Source SO</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (<React.Fragment key={l.lineNumber}>
                    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={td}>{l.lineNumber}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: l.partId ? '#0f766e' : '#dc2626' }}>
                        <button
                          type="button"
                          onClick={() => setPickerLine(pickerLine === l.lineNumber ? null : l.lineNumber)}
                          title={l.partId ? 'Wrong part? Search SanMar and pick another' : 'Search SanMar and pick this part by hand'}
                          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted' }}
                        >{l.partId || (resolving ? '…' : '⚠ missing')}</button>
                        {l._manual && <div style={{ fontSize: 9, fontWeight: 700, color: '#b45309', fontFamily: 'system-ui' }}>picked by hand</div>}
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#1e40af' }}>
                        {l.style}
                        {l._manual && l._manual.orderedStyle !== l.style && <div style={sub}>ordered as {l._manual.orderedStyle}</div>}
                      </td>
                      <td style={td}>
                        {l.color || '—'}
                        {l._manual && l._manual.orderedColor !== l.color && <div style={sub}>ordered as {l._manual.orderedColor || '—'}</div>}
                      </td>
                      <td style={{ ...td, fontWeight: 700 }}>
                        {l.size}
                        {l._manual && l._manual.orderedSize !== l.size && <div style={{ ...sub, fontWeight: 400 }}>ordered as {l._manual.orderedSize}</div>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{l.quantity}</td>
                      <td style={{ ...td, textAlign: 'right' }}>${(l.unitPrice || 0).toFixed(2)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>${(l.quantity * (l.unitPrice || 0)).toFixed(2)}</td>
                      <td style={td}>
                        <WarehouseChips
                          loading={whseByLine === null}
                          entries={forcedInfo
                            ? [{
                                label: forcedInfo.city.split(',')[0],
                                city: forcedInfo.city,
                                qty: forcedRowFor(lineWhseRows[_whseKey(l)])?.qty || 0,
                                primary: (forcedRowFor(lineWhseRows[_whseKey(l)])?.qty || 0) >= l.quantity,
                              }]
                            : rankWarehouses(lineWhseRows[_whseKey(l)] || [], l.quantity, consolidatedWhse).filter(e => e.primary)}
                        />
                      </td>
                      <td style={{ ...td, color: '#64748b', fontSize: 11 }}>{l.sourceSO}</td>
                    </tr>
                    {pickerLine === l.lineNumber && (
                      <tr style={{ background: '#f8fafc' }}>
                        <td colSpan={10} style={{ padding: 10 }}>
                          <PartPicker
                            line={l}
                            candidates={candidates}
                            picked={manualParts[l.lineNumber] || null}
                            onPick={p => { setManualParts(prev => ({ ...prev, [l.lineNumber]: p })); setPickerLine(null); }}
                            onClear={() => setManualParts(prev => { const n = { ...prev }; delete n[l.lineNumber]; return n; })}
                            onClose={() => setPickerLine(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>))}
                </tbody>
              </table>
              {lines.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No line items.</div>}
              {lines.length > 0 && (
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#64748b', background: '#f8fafc', borderTop: '1px solid #f1f5f9' }}>
                  📦 = expected ship-from warehouse. SanMar consolidates: the whole order ships from the closest warehouse to the ship-to that can fill every line, bumping to the next closest when something is short. Hover the chip for current stock.
                </div>
              )}
            </div>
          )}

          {tab === 'xml' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>POST → <code>{(SANMAR_PO_ENDPOINTS[env] || SANMAR_PO_ENDPOINTS.prod).replace(/^https?:\/\//, '')}</code> ({isLive ? 'LIVE' : 'TEST'})</span>
                <button className="btn btn-sm btn-secondary" onClick={copyXml}>{copied ? '✓ Copied' : '📋 Copy XML'}</button>
              </div>
              <pre style={{ background: '#0f172a', color: '#a5f3fc', padding: 12, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 420, margin: 0 }}>{soap}</pre>
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {done ? (
            <>
              <span style={{ flex: 1, fontSize: 12, color: '#166534', fontWeight: 700 }}>✓ Submitted — transaction {result?.transactionId}</span>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </>
          ) : (
            <>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: blocked ? '#94a3b8' : '#334155', cursor: blocked ? 'not-allowed' : 'pointer' }}>
                <input type="checkbox" checked={confirmed} disabled={blocked || submitting} onChange={e => setConfirmed(e.target.checked)} />
                {isLive
                  ? <span>I confirm this is a real order — submit it to SanMar and ship the goods.</span>
                  : <span>Confirm test submission to SanMar's TEST environment.</span>}
              </label>
              <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={doSubmit}
                disabled={!canSubmit}
                title={
                  resolving ? 'Looking up Part IDs…'
                  : decoAddrIncomplete ? 'Enter the decorator\'s full address first'
                  : decoNoVendor ? 'Select a decorator first'
                  : shipIncomplete ? 'The ship-to address is incomplete — company, street, city, state and zip are all required'
                  : blocked ? 'Every line needs a matched SanMar Part ID first'
                  : !confirmed ? 'Check the confirmation box first'
                  : ''
                }
                style={{ background: isLive ? '#b91c1c' : '#1e40af', borderColor: isLive ? '#b91c1c' : '#1e40af', opacity: canSubmit ? 1 : 0.55 }}
              >
                {submitting ? 'Submitting…' : resolving ? 'Looking up Part IDs…' : isLive ? '🚀 Submit Order to SanMar' : '🧪 Submit Test Order'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const th = { padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#475569', borderBottom: '1px solid #e2e8f0' };
const td = { padding: '6px 8px', fontSize: 12 };
// "ordered as …" note under a cell whose value the rep's hand-picked part replaced.
const sub = { fontSize: 9, fontWeight: 400, color: '#94a3b8', fontFamily: 'system-ui' };

// Hand-match one line to a SanMar part. Lists every color/size variant SanMar returned for
// the line's style (already fetched by the resolver), filterable, and can search any other
// style when the order's code isn't what SanMar catalogs it under. Picking sets the line's
// partId — the ONLY id that decides what SanMar ships — so every row shows the part's own
// color/size spelling and its Unique_Key for the rep to check against the order.
function PartPicker({ line, candidates, picked, onPick, onClear, onClose }) {
  const [q, setQ] = useState('');
  const [styleQuery, setStyleQuery] = useState('');
  const [extra, setExtra] = useState([]);        // variants pulled by a hand-typed style search
  const [searchedStyle, setSearchedStyle] = useState('');
  const [searching, setSearching] = useState(false);

  // The resolver's candidates carry no style (they're keyed by it), so stamp the line's on.
  const styleKey = String(line.style || '').toUpperCase().trim();
  const pool = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const c of [...extra, ...(candidates[styleKey] || []).map(c => ({ style: line.style, ...c }))]) {
      if (!c.uniqueKey || seen.has(c.uniqueKey)) continue;
      seen.add(c.uniqueKey); out.push(c);
    }
    return out;
  }, [candidates, styleKey, extra, line.style]);

  const filtered = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (!t) return pool;
    const terms = t.split(/\s+/);
    return pool.filter(c => {
      const hay = [c.style, c.color, c.size, c.uniqueKey].join(' ').toUpperCase();
      return terms.every(term => hay.includes(term));
    });
  }, [pool, q]);

  const runSearch = async () => {
    const s = styleQuery.trim();
    if (!s || searching) return;
    setSearching(true);
    const v = await sanmarStyleVariants(s);
    setExtra(v); setSearchedStyle(s); setSearching(false);
  };

  const chip = { fontSize: 10, padding: '1px 6px', borderRadius: 8, fontWeight: 700 };
  return (
    <div style={{ border: '1px solid #cbd5e1', borderRadius: 6, background: 'white', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12 }}>Find the SanMar part for line {line.lineNumber}</strong>
        <span style={{ fontSize: 11, color: '#64748b' }}>
          ordered as <code>{line._manual ? line._manual.orderedStyle : line.style}</code> ·
          {' '}{(line._manual ? line._manual.orderedColor : line.color) || '—'} ·
          {' '}{line._manual ? line._manual.orderedSize : line.size}
        </span>
        {picked && <span style={{ ...chip, background: '#fef3c7', color: '#92400e' }}>picked {picked.uniqueKey}</span>}
        <span style={{ flex: 1 }} />
        {picked && <button type="button" className="btn btn-sm btn-secondary" style={{ fontSize: 10 }} onClick={onClear}>Undo pick</button>}
        <button type="button" className="btn btn-sm btn-secondary" style={{ fontSize: 10 }} onClick={onClose}>Close</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          className="form-input" style={{ fontSize: 12, flex: '1 1 220px' }} autoFocus
          placeholder="Filter by color, size or part id…"
          value={q} onChange={e => setQ(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 4, flex: '1 1 260px' }}>
          <input
            className="form-input" style={{ fontSize: 12, flex: 1 }}
            placeholder={'Search another style (e.g. ' + (line.style || '112') + ')'}
            value={styleQuery}
            onChange={e => setStyleQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
          />
          <button type="button" className="btn btn-sm btn-secondary" style={{ fontSize: 11 }} onClick={runSearch} disabled={searching || !styleQuery.trim()}>
            {searching ? 'Searching…' : '🔍 Search'}
          </button>
        </div>
      </div>

      {searchedStyle !== '' && !searching && extra.length === 0 && (
        <div style={{ fontSize: 11, color: '#991b1b', marginBottom: 6 }}>SanMar returned nothing for <code>{searchedStyle}</code> — check the style code.</div>
      )}

      <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 4 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
            {pool.length === 0
              ? 'Nothing loaded for this style yet — search a style above.'
              : 'No variant matches that filter.'}
          </div>
        ) : filtered.map(c => (
          <button
            key={c.uniqueKey} type="button"
            onClick={() => onPick({ uniqueKey: c.uniqueKey, style: c.style || line.style, color: c.color, size: c.size })}
            style={{
              display: 'flex', width: '100%', gap: 10, alignItems: 'center', textAlign: 'left',
              padding: '6px 10px', border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
              background: picked && picked.uniqueKey === c.uniqueKey ? '#eff6ff' : 'white', fontSize: 12,
            }}
          >
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e40af', minWidth: 64 }}>{c.style || line.style}</span>
            <span style={{ flex: 1 }}>{c.color || '—'}</span>
            <span style={{ fontWeight: 700, minWidth: 70 }}>{c.size || '—'}</span>
            <span style={{ fontFamily: 'monospace', color: '#0f766e' }}>{c.uniqueKey}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>
        The part id is what SanMar ships — check the color and size on the row you pick, not the ones the order line carries.
      </div>
    </div>
  );
}

function Stat({ label, value, mono }) {
  return (
    <div style={{ padding: 8, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
      fontSize: 12, fontWeight: 700,
      color: active ? '#1e40af' : '#64748b',
      borderBottom: active ? '2px solid #1e40af' : '2px solid transparent',
      marginBottom: -1,
    }}>{children}</button>
  );
}
