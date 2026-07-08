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
import { buildSanMarPOPayload, buildSanMarPOSoap, SANMAR_PO_ENDPOINTS } from './sanmarPO';
import { sanmarSubmitPO, sanmarResolvePartIds } from './vendorApis';
import { NSA, NSA_WAREHOUSE } from './constants';

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

export default function SanMarPreviewModal({ batchPOs, poNumber, vendorName = 'SanMar', env = 'prod', shipTo, shipToDecoId = null, initialDpoNumber = '', decoVendors = [], onClose, onSubmitted }) {
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

  // Ship-to selector state; when shipToDecoId is set the mode is pre-determined (no manual picker)
  const isPrescribed = !!shipToDecoId;
  const [shipMode, setShipMode] = useState(shipToDecoId ? 'deco' : 'nsa'); // 'nsa' | 'deco'
  const activeDecoVendors = useMemo(() => (decoVendors || []).filter(v => v.is_active !== false), [decoVendors]);
  const [selectedDecoId, setSelectedDecoId] = useState(() => shipToDecoId || activeDecoVendors[0]?.id || '');
  const [dpoNumber, setDpoNumber] = useState(initialDpoNumber || '');
  const [inlineAddr, setInlineAddr] = useState({ address_line1: '', address_line2: '', city: '', state: '', zip: '' });

  // Keep selectedDecoId in sync if decoVendors loads after mount
  useEffect(() => {
    if (!selectedDecoId && activeDecoVendors.length > 0) setSelectedDecoId(activeDecoVendors[0].id);
  }, [activeDecoVendors, selectedDecoId]);

  const selectedDeco = useMemo(() => activeDecoVendors.find(v => v.id === selectedDecoId) || null, [activeDecoVendors, selectedDecoId]);
  const hasDecoAddr = selectedDeco && selectedDeco.address_line1 && selectedDeco.city && selectedDeco.state && selectedDeco.zip;

  const isLive = env === 'prod';

  // Compute the effective ship-to address inside the memo so it stays a stable dep.
  const base = useMemo(() => {
    let effectiveShip;
    if (shipMode === 'deco' && selectedDeco) {
      const a1 = selectedDeco.address_line1 || inlineAddr.address_line1 || '';
      const a2 = selectedDeco.address_line2 || inlineAddr.address_line2 || '';
      const city = selectedDeco.city || inlineAddr.city || '';
      const state = selectedDeco.state || inlineAddr.state || '';
      const zip = selectedDeco.zip || inlineAddr.zip || '';
      effectiveShip = {
        attentionTo: dpoNumber.trim() ? 'DPO ' + dpoNumber.trim() : (selectedDeco.contact_name || 'Receiving'),
        companyName: selectedDeco.name,
        address1: a1,
        address2: a2,
        city,
        region: state,
        postalCode: zip,
        country: 'US',
      };
    } else {
      effectiveShip = shipTo || NSA_SHIP_TO;
    }
    const p = buildSanMarPOPayload({ poNumber, batchPOs, shipTo: effectiveShip });
    return { payload: p, baseLines: p.PO.lineItems, totals: p._summary, effectiveShip };
  }, [batchPOs, poNumber, shipTo, shipMode, selectedDeco, dpoNumber, inlineAddr]);

  const ship = base.effectiveShip;

  // Lines still missing a partId after the base build — these need a live lookup.
  const missing = useMemo(
    () => base.baseLines.filter(l => !l.partId).map(l => ({ key: l.lineNumber, style: l.style, color: l.color, size: l.size })),
    [base.baseLines]
  );

  useEffect(() => {
    let cancelled = false;
    if (!missing.length) { setResolving(false); return; }
    setResolving(true); setResolveErr('');
    sanmarResolvePartIds(missing)
      .then(({ resolved, candidates }) => { if (cancelled) return; setResolvedParts(resolved || {}); setCandidates(candidates || {}); })
      .catch(e => { if (!cancelled) setResolveErr(e.message || 'Part ID lookup failed'); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [missing]);

  // Overlay resolved partIds onto the lines, then recompute warnings + the payload
  // that will actually be submitted.
  const lines = useMemo(
    () => base.baseLines.map(l => (l.partId ? l : { ...l, partId: resolvedParts[l.lineNumber] || '' })),
    [base.baseLines, resolvedParts]
  );
  const warnings = useMemo(
    () => lines.filter(l => !l.partId).map(l => `Line ${l.lineNumber} (${[l.style, l.color, l.size].filter(Boolean).join(' ')}) is missing a SanMar partId / Unique_Key`),
    [lines]
  );
  const payload = useMemo(() => ({ ...base.payload, PO: { ...base.payload.PO, lineItems: lines } }), [base.payload, lines]);
  const soap = useMemo(() => buildSanMarPOSoap(payload, { id: '<from env>' }), [payload]);
  const totals = base.totals;

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

  // Block submit if decorator mode but address is incomplete
  const decoAddrIncomplete = shipMode === 'deco' && selectedDeco && !hasDecoAddr
    && (!inlineAddr.address_line1.trim() || !inlineAddr.city.trim() || !inlineAddr.state.trim() || !inlineAddr.zip.trim());
  const decoNoVendor = shipMode === 'deco' && !selectedDeco;

  const blocked = lines.length === 0 || warnings.length > 0 || resolving || decoAddrIncomplete || decoNoVendor;
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
        const recorded = await onSubmitted(r, lines);
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
                      <input className="form-input" style={{ fontSize: 12, width: 160 }} placeholder="e.g. 1042" value={dpoNumber} onChange={e => setDpoNumber(e.target.value)} />
                    </div>
                    {dpoNumber.trim() && <div style={{ fontSize: 11, color: '#7c3aed', alignSelf: 'flex-end', paddingBottom: 4 }}>Attn: <strong>DPO {dpoNumber.trim()}</strong></div>}
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
                            placeholder="e.g. 1042"
                            value={dpoNumber}
                            onChange={e => setDpoNumber(e.target.value)}
                          />
                        </div>
                        {dpoNumber.trim() && (
                          <div style={{ fontSize: 11, color: '#7c3aed', alignSelf: 'flex-end', paddingBottom: 4 }}>
                            Attn: <strong>DPO {dpoNumber.trim()}</strong>
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
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 12, padding: '8px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>
            <strong>Ships to:</strong> {ship.companyName} · {ship.address1}{ship.address2 ? ', ' + ship.address2 : ''}, {ship.city} {ship.region} {ship.postalCode} · UPS Ground
            {ship.attentionTo && ship.attentionTo !== 'Receiving' && <span style={{ marginLeft: 6, color: '#7c3aed', fontWeight: 700 }}>· Attn: {ship.attentionTo}</span>}
          </div>

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
                    <th style={th}>Source SO</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.lineNumber} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={td}>{l.lineNumber}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: l.partId ? '#0f766e' : '#dc2626' }}>{l.partId || (resolving ? '…' : '⚠ missing')}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#1e40af' }}>{l.style}</td>
                      <td style={td}>{l.color || '—'}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{l.size}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{l.quantity}</td>
                      <td style={{ ...td, textAlign: 'right' }}>${(l.unitPrice || 0).toFixed(2)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>${(l.quantity * (l.unitPrice || 0)).toFixed(2)}</td>
                      <td style={{ ...td, color: '#64748b', fontSize: 11 }}>{l.sourceSO}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lines.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No line items.</div>}
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
