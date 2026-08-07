// S&S Activewear order modal — review the order, resolve each line's S&S Sku, then
// submit via the REST API (POST /v2/orders/). Defaults to a TEST order, which S&S
// creates and cancels (nothing ships), so it's safe to validate before going live.
// Credentials are injected server-side by ss-proxy and never appear here.
import React, { useEffect, useMemo, useState } from 'react';
import { buildSSOrderPayload } from './ssOrder';
import { ssResolveSkus, ssSearchProducts, ssSubmitOrder, ssGetWarehouseStock } from './vendorApis';
import WarehouseChips, { rankWarehouses, SS_WAREHOUSES } from './WarehouseChips';
import { NSA, NSA_WAREHOUSE } from './constants';

// S&S ships integrated orders to NSA's receiving dock (caller can override via shipTo).
const NSA_SHIP_TO = {
  companyName: NSA.name,
  attentionTo: 'Receiving',
  address1: NSA_WAREHOUSE.street1,
  address2: NSA_WAREHOUSE.street2,
  city: NSA_WAREHOUSE.city,
  region: NSA_WAREHOUSE.state,
  postalCode: NSA_WAREHOUSE.zip,
};

export default function SSOrderModal({ batchPOs, poNumber, vendorName = 'S&S Activewear', shipTo, onClose, onSubmitted, onLearnSkus }) {
  const [tab, setTab] = useState('lines'); // 'lines' | 'json'
  const [confirmed, setConfirmed] = useState(false);
  // Live-only (owner 2026-07-31): the test-order mode was removed once S&S orders were
  // validated end-to-end. Every submission is a real order — the confirm checkbox below is
  // the gate. Kept as a const so the existing `live` branches render the production copy.
  const testMode = false;
  const [submitState, setSubmitState] = useState('idle'); // idle | submitting | success | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [bookErr, setBookErr] = useState(''); // order placed at vendor but NOT recorded in the portal
  const [resolving, setResolving] = useState(true);
  const [resolvedSkus, setResolvedSkus] = useState({}); // line key -> sku
  const [candidates, setCandidates] = useState({});     // STYLE -> [{color,size,sku}]
  const [resolveErr, setResolveErr] = useState('');
  // Manual SKU picker: a rep searches S&S live and hand-picks the exact per-size Sku for a
  // line the auto-resolver couldn't match. manualSku overrides the auto-resolved value.
  const [manualSku, setManualSku] = useState({}); // line key -> S&S sku chosen by hand
  const [searchLine, setSearchLine] = useState(null); // the line being matched, or null
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState('');

  const ship = shipTo || NSA_SHIP_TO;

  // Per-warehouse availability for the resolved SKUs — informational "ships from"
  // display only; a lookup failure just leaves the column blank, never blocks.
  const [whseBySku, setWhseBySku] = useState(null); // SKUUPPER -> [{abbr,qty,closest}], null = loading

  // Base lines (no network) — flatten the batch.
  const baseLines = useMemo(() => buildSSOrderPayload({ poNumber, batchPOs, shipTo: ship }).lines, [poNumber, batchPOs, ship]);
  const missing = useMemo(() => baseLines.filter(l => !l.sku).map(l => ({ key: l.key, style: l.style, color: l.color, size: l.size })), [baseLines]);

  useEffect(() => {
    let cancelled = false;
    if (!missing.length) { setResolving(false); return; }
    setResolving(true); setResolveErr('');
    ssResolveSkus(missing)
      .then(({ resolved, candidates }) => { if (cancelled) return; setResolvedSkus(resolved || {}); setCandidates(candidates || {}); })
      .catch(e => { if (!cancelled) setResolveErr(e.message || 'SKU lookup failed'); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [missing]);

  // Overlay resolved skus (a hand-picked sku wins over the auto-resolved one), recompute
  // warnings + the order that will be submitted.
  const lines = useMemo(() => baseLines.map(l => (l.sku ? l : { ...l, sku: manualSku[l.key] || resolvedSkus[l.key] || '' })), [baseLines, resolvedSkus, manualSku]);
  const warnings = useMemo(() => lines.filter(l => !l.sku).map(l => `Line (${[l.style, l.color, l.size].filter(Boolean).join(' ')}) has no matched S&S SKU`), [lines]);
  const built = useMemo(() => buildSSOrderPayload({ poNumber, lineItems: lines, shipTo: ship, testOrder: testMode }), [poNumber, lines, ship, testMode]);
  const totals = built.summary;
  const unresolvedStyles = useMemo(() => [...new Set(lines.filter(l => !l.sku).map(l => String(l.style || '').toUpperCase().trim()))], [lines]);

  // Once SKUs are known, fetch each one's per-warehouse stock (one chunked call).
  const skuKey = useMemo(() => [...new Set(lines.map(l => String(l.sku || '').toUpperCase()).filter(Boolean))].sort().join(','), [lines]);
  useEffect(() => {
    let cancelled = false;
    if (resolving || !skuKey) return;
    setWhseBySku(null);
    ssGetWarehouseStock(skuKey.split(','))
      .then(m => { if (!cancelled) setWhseBySku(m || {}); })
      .catch(() => { if (!cancelled) setWhseBySku({}); });
    return () => { cancelled = true; };
  }, [skuKey, resolving]);

  const blocked = lines.length === 0 || warnings.length > 0 || resolving;
  const done = submitState === 'success';
  const submitting = submitState === 'submitting';
  const live = !testMode;
  const canSubmit = !blocked && confirmed && !submitting && !done;

  const doSubmit = async () => {
    if (!canSubmit) return;
    setSubmitState('submitting'); setErrorMsg('');
    let r;
    try {
      r = await ssSubmitOrder(built.order);
    } catch (e) {
      setErrorMsg(e.message || 'Submit failed — try again or order manually on ssactivewear.com.');
      setSubmitState('error');
      return;
    }
    // S&S accepted the order — success regardless of local bookkeeping.
    setResult(r); setSubmitState('success');
    // Learn each line's S&S-SKU ↔ our-style pairing (test OR live: a validated test proves
    // S&S accepted these exact part numbers). Fire-and-forget; never affects the success UI.
    if (onLearnSkus) { try { onLearnSkus(lines, vendorName); } catch (e) { console.warn('[S&S] alias learn skipped:', e); } }
    // Only a LIVE order should mark the batch as ordered; a test order places nothing.
    // Run bookkeeping OUTSIDE the submit try so a promotion error can't mask a placed order —
    // but await the (async) result and surface a silent no-op, so a placed-but-unrecorded
    // order (the NSA 4536 failure) can't look like a clean success.
    if (live && onSubmitted) {
      try {
        const recorded = await onSubmitted(r, lines);
        if (!recorded) setBookErr('the recording step reported that nothing was written to the portal');
      } catch (e) {
        console.error('[S&S] order placed but post-order bookkeeping failed:', e);
        setBookErr(e.message || 'recording failed with an error');
      }
    }
  };

  // ── Manual SKU search ──────────────────────────────────────────────────────
  const openSearch = (l) => { setSearchLine(l); setSearchQuery(l.style || ''); setSearchResults([]); setSearchErr(''); };
  const closeSearch = () => { setSearchLine(null); setSearchResults([]); setSearchErr(''); setSearchBusy(false); };
  const runSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchErr('Type at least 2 characters (a style like NL1580, or a keyword).'); return; }
    setSearchBusy(true); setSearchErr(''); setSearchResults([]);
    try {
      const rows = await ssSearchProducts(q);
      setSearchResults(rows);
      if (!rows.length) setSearchErr('No S&S products found for "' + q + '".');
    } catch (e) { setSearchErr(e.message || 'S&S search failed — try again.'); }
    finally { setSearchBusy(false); }
  };
  const pickSku = (row) => {
    if (!searchLine || !row || !row.sku) return;
    setManualSku(m => ({ ...m, [searchLine.key]: row.sku }));
    closeSearch();
  };
  const clearManual = (key) => setManualSku(m => { const n = { ...m }; delete n[key]; return n; });

  const safeClose = submitting ? undefined : onClose;

  return (
    <div className="modal-overlay" onClick={safeClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="modal-header">
          <h2>{done ? '✅' : live ? '🚀' : '🧪'} {vendorName} Order — {done ? 'Submitted' : 'Review & Submit'}</h2>
          <button className="modal-close" onClick={safeClose}>x</button>
        </div>
        <div className="modal-body">
          {done ? (
            <div style={{ padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 12, fontSize: 13, color: '#166534' }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>✓ {live ? 'Order placed with S&S' : 'Test order validated'}</div>
              <div>{live ? 'S&S accepted the order and returned an order number.' : 'S&S accepted and auto-cancelled the test order — your account can place orders and the payload is valid. Nothing shipped.'}</div>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Stat label="PO Number" value={poNumber} mono />
                <Stat label={live ? 'S&S Order #' : 'Test Order #'} value={result?.orderNumber || '—'} mono />
              </div>
              {bookErr && <div style={{ marginTop: 10, padding: 10, background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 8, color: '#92400e', fontWeight: 700 }}>
                ⚠ S&S HAS this order, but the portal did NOT record it ({bookErr}).
                Do NOT submit or re-order this batch — record the PO on the sales order manually and remove the queue entries, or the batch will look unordered and get double-ordered.
              </div>}
            </div>
          ) : submitState === 'error' ? (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
              <strong>✗ S&S did not accept the order — nothing was placed.</strong>
              <div style={{ marginTop: 4, fontFamily: 'monospace' }}>{errorMsg}</div>
              <div style={{ marginTop: 6 }}>Fix the issue and retry, or place this order manually on ssactivewear.com.</div>
            </div>
          ) : live ? (
            <div style={{ padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
              <strong style={{ color: '#b45309' }}>⚠ LIVE production order.</strong> Submitting sends this order to S&S and <strong>ships real goods</strong>. Review every line below — nothing is sent until you check the box and click <em>Place Order</em>.
            </div>
          ) : (
            <div style={{ padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#1e40af' }}>
              <strong>🧪 Test order.</strong> S&S will create and immediately cancel it — nothing ships. Use this to confirm the account can order and the lines resolve. Uncheck "Test order" below to place it for real.
            </div>
          )}

          {/* Ship-to, plainly visible (owner 2026-07-23): drop-ship orders carry a CUSTOMER
              address — the human must see where goods will land without digging into the JSON. */}
          {!done && shipTo && (
            <div style={{ padding: 10, background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 8, marginBottom: 12, fontSize: 12.5, color: '#6b21a8' }}>
              <strong>📦 Ships to:</strong> {[ship.companyName, ship.attentionTo && 'Attn: ' + ship.attentionTo, ship.address1, ship.address2, [ship.city, ship.region, ship.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
              <span style={{ marginLeft: 8, color: '#9333ea' }}>— confirm this address before submitting.</span>
            </div>
          )}

          {!done && resolving && (
            <div style={{ padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#1e40af' }}>
              <strong>🔄 Looking up S&S SKUs…</strong> Matching each line to its S&S item number. Submit unlocks once every line has one.
            </div>
          )}

          {!done && !resolving && resolveErr && (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
              <strong>⚠ Couldn't reach S&S to look up SKUs:</strong> {resolveErr}. Try reopening, or order manually.
            </div>
          )}

          {!done && !resolving && warnings.length > 0 && (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
              <strong>⚠ Cannot submit — {warnings.length} line(s) without a matched S&S SKU:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              {unresolvedStyles.some(st => (candidates[st] || []).length) && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #fecaca' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>What S&S lists for these styles (for matching):</div>
                  {unresolvedStyles.map(st => (candidates[st] || []).length ? (
                    <div key={st} style={{ marginBottom: 4 }}>
                      <code>{st}</code>: {[...new Set((candidates[st] || []).map(c => c.color).filter(Boolean))].slice(0, 16).join(' · ') || '(no colors returned)'}
                    </div>
                  ) : null)}
                  <div style={{ marginTop: 4, color: '#7f1d1d' }}>If the right color/size is in that list but didn't match, it's a naming difference — send me a screenshot and I'll fix the match. Or click <strong>🔍 find SKU</strong> on the line below to search S&S and pick the right item yourself.</div>
                </div>
              )}
            </div>
          )}

          {!done && searchLine && (
            <div style={{ padding: 12, background: '#f5f3ff', border: '2px solid #6366f1', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#3730a3' }}>
                  🔍 Find S&S SKU for <code>{searchLine.style}</code> · {searchLine.color || '—'} · {searchLine.size}
                </div>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={closeSearch}>Close</button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="S&S style # or keyword (e.g. 1580, Next Level crop)"
                  style={{ flex: 1, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }} />
                <button className="btn btn-primary" onClick={runSearch} disabled={searchBusy} style={{ background: '#4f46e5', borderColor: '#4f46e5' }}>
                  {searchBusy ? 'Searching…' : 'Search S&S'}
                </button>
              </div>
              {searchErr && <div style={{ fontSize: 12, color: '#991b1b', marginBottom: 6 }}>{searchErr}</div>}
              {searchResults.length > 0 && (
                <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead style={{ background: '#eef2ff', position: 'sticky', top: 0 }}>
                      <tr>
                        <th style={th}>S&S SKU</th><th style={th}>Style</th><th style={th}>Color</th><th style={th}>Size</th>
                        <th style={{ ...th, textAlign: 'right' }}>$</th><th style={th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResults.map((r, i) => {
                        const sizeMatch = _norm(r.size) === _norm(searchLine.size);
                        return (
                          <tr key={r.sku + '-' + i} style={{ borderTop: '1px solid #f1f5f9', background: sizeMatch ? '#f0fdf4' : 'transparent' }}>
                            <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0f766e' }}>{r.sku}</td>
                            <td style={{ ...td, fontFamily: 'monospace' }}>{r.style || '—'}</td>
                            <td style={td}>{r.color || '—'}</td>
                            <td style={{ ...td, fontWeight: 700 }}>{r.size || '—'}{sizeMatch ? ' ✓' : ''}</td>
                            <td style={{ ...td, textAlign: 'right' }}>${(r.price || 0).toFixed(2)}</td>
                            <td style={td}><button className="btn btn-primary" style={{ fontSize: 11, padding: '2px 10px', background: '#16a34a', borderColor: '#16a34a' }} onClick={() => pickSku(r)}>Use</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                Pick the row matching this line's color and size (size-matching rows are highlighted). The chosen S&S SKU fills this line so the order can submit.
              </div>
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
          </div>

          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 10 }}>
            <TabBtn active={tab === 'lines'} onClick={() => setTab('lines')}>Line Items ({lines.length})</TabBtn>
            <TabBtn active={tab === 'json'} onClick={() => setTab('json')}>Order JSON</TabBtn>
          </div>

          {tab === 'lines' && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th style={th}>#</th>
                    <th style={th}>S&S SKU</th>
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
                  {lines.map((l, i) => (
                    <tr key={l.key} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={td}>{i + 1}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: l.sku ? '#0f766e' : '#dc2626' }}>
                        {l.sku
                          ? (manualSku[l.key]
                              ? <span title="Hand-picked SKU — click ✕ to clear and re-match">{l.sku} <span style={{ fontSize: 9, color: '#7c3aed', fontFamily: 'sans-serif', fontWeight: 700 }}>✎ picked</span> <button onClick={() => clearManual(l.key)} style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 12 }}>✕</button></span>
                              : l.sku)
                          : resolving
                            ? '…'
                            : <button onClick={() => openSearch(l)} title="Search S&S and pick the matching SKU for this line" style={{ border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', padding: '2px 6px' }}>🔍 find SKU</button>}
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#1e40af' }}>{l.style}</td>
                      <td style={td}>{l.color || '—'}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{l.size}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{l.quantity}</td>
                      <td style={{ ...td, textAlign: 'right' }}>${(l.unitPrice || 0).toFixed(2)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>${(l.quantity * (l.unitPrice || 0)).toFixed(2)}</td>
                      <td style={td}>
                        <WarehouseChips
                          loading={l.sku ? whseBySku === null : false}
                          entries={rankWarehouses(
                            (whseBySku?.[String(l.sku || '').toUpperCase()] || []).map(w => ({ label: w.abbr, city: SS_WAREHOUSES[w.abbr], qty: w.qty, closest: w.closest })),
                            l.quantity
                          )}
                        />
                      </td>
                      <td style={{ ...td, color: '#64748b', fontSize: 11 }}>{l.sourceSO}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lines.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No line items.</div>}
              {lines.length > 0 && (
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#64748b', background: '#f8fafc', borderTop: '1px solid #f1f5f9' }}>
                  📦 = expected ship-from (S&S routes each line from the nearest warehouse with stock at submission — split shipments possible). Numbers are current stock per warehouse; hover a chip for the city.
                </div>
              )}
            </div>
          )}

          {tab === 'json' && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>POST → <code>api.ssactivewear.com/v2/orders/</code> ({live ? 'LIVE' : 'TEST'})</div>
              <pre style={{ background: '#0f172a', color: '#a5f3fc', padding: 12, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 420, margin: 0 }}>{JSON.stringify(built.order, null, 2)}</pre>
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {done ? (
            <>
              <span style={{ flex: 1, fontSize: 12, color: '#166534', fontWeight: 700 }}>✓ {live ? 'Order' : 'Test'} {result?.orderNumber}</span>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </>
          ) : (
            <>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: blocked ? '#94a3b8' : '#334155', cursor: blocked ? 'not-allowed' : 'pointer' }}>
                <input type="checkbox" checked={confirmed} disabled={blocked || submitting} onChange={e => setConfirmed(e.target.checked)} />
                <span>I confirm this is a real order — place it with S&S and ship the goods.</span>
              </label>
              <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={doSubmit}
                disabled={!canSubmit}
                title={resolving ? 'Looking up SKUs…' : blocked ? 'Every line needs a matched S&S SKU first' : !confirmed ? 'Check the confirmation box first' : ''}
                style={{ background: live ? '#b91c1c' : '#1e40af', borderColor: live ? '#b91c1c' : '#1e40af', opacity: canSubmit ? 1 : 0.55 }}
              >
                {submitting ? 'Submitting…' : resolving ? 'Looking up SKUs…' : live ? '🚀 Place Order with S&S' : '🧪 Submit Test Order'}
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
const _norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); // size compare in the SKU search

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
