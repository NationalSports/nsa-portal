// Momentec Brands order modal — review the batch, then submit via the REST API
// (POST /v2/Order). Defaults to the STAGE (sandbox) environment, so an accidental
// submit can't place a real production order; flip "Live production order" to send
// to prod (behind an explicit confirm). Each line's Momentec order SKU
// (design.colorCode.size) comes from the stamped fields when present, and is
// otherwise resolved live from /v2/Style (momentecResolveSkus) — so it works for
// items added any way. Credentials (logonId/password) are injected server-side by
// momentec-proxy and never appear in this payload.
import React, { useEffect, useMemo, useState } from 'react';
import { buildMomentecOrderPayload } from './momentecOrder';
import { momentecSubmitOrder, momentecResolveSkus } from './vendorApis';
import { NSA, NSA_WAREHOUSE } from './constants';

// Momentec ships integrated orders to NSA's receiving dock (caller can override via shipTo).
const NSA_SHIP_TO = {
  companyName: NSA.name,
  attentionTo: 'Receiving',
  address1: NSA_WAREHOUSE.street1,
  address2: NSA_WAREHOUSE.street2,
  city: NSA_WAREHOUSE.city,
  region: NSA_WAREHOUSE.state,
  postalCode: NSA_WAREHOUSE.zip,
};

export default function MomentecOrderModal({ batchPOs, poNumber, vendorName = 'Momentec', shipTo, onClose, onSubmitted }) {
  const [tab, setTab] = useState('lines'); // 'lines' | 'json'
  const [confirmed, setConfirmed] = useState(false);
  const [live, setLive] = useState(false);  // false = stage/sandbox, true = prod
  const [submitState, setSubmitState] = useState('idle'); // idle | submitting | success | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [resolving, setResolving] = useState(true);
  const [resolvedSkus, setResolvedSkus] = useState({}); // line key -> sku
  const [candidates, setCandidates] = useState({});     // STYLE -> [{color,colorCode,size,sku}]
  const [resolveErr, setResolveErr] = useState('');

  const ship = shipTo || NSA_SHIP_TO;
  const env = live ? 'prod' : 'stage';

  // Base lines (no network) — sku comes from the stamped _mt_skus when present.
  const baseLines = useMemo(() => buildMomentecOrderPayload({ poNumber, batchPOs, shipTo: ship }).lines, [poNumber, batchPOs, ship]);
  const missing = useMemo(() => baseLines.filter(l => !l.sku).map(l => ({ key: l.key, style: l.style, color: l.color, size: l.size })), [baseLines]);

  // Resolve any line without a stamped SKU live from /v2/Style.
  useEffect(() => {
    let cancelled = false;
    if (!missing.length) { setResolving(false); return; }
    setResolving(true); setResolveErr('');
    momentecResolveSkus(missing)
      .then(({ resolved, candidates }) => { if (cancelled) return; setResolvedSkus(resolved || {}); setCandidates(candidates || {}); })
      .catch(e => { if (!cancelled) setResolveErr(e.message || 'SKU lookup failed'); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [missing]);

  // Overlay resolved SKUs, then recompute warnings + the order that will be submitted.
  const lines = useMemo(() => baseLines.map(l => (l.sku ? l : { ...l, sku: resolvedSkus[l.key] || '' })), [baseLines, resolvedSkus]);
  const warnings = useMemo(() => lines.filter(l => !l.sku).map(l => `Line (${[l.style, l.color, l.size].filter(Boolean).join(' ')}) has no matched Momentec SKU`), [lines]);
  const built = useMemo(() => buildMomentecOrderPayload({ poNumber, lineItems: lines, shipTo: ship }), [poNumber, lines, ship]);
  const totals = built.summary;
  const unresolvedStyles = useMemo(() => [...new Set(lines.filter(l => !l.sku).map(l => String(l.style || '').toUpperCase().trim()))], [lines]);

  const blocked = lines.length === 0 || warnings.length > 0 || resolving;
  const done = submitState === 'success';
  const submitting = submitState === 'submitting';
  const canSubmit = !blocked && confirmed && !submitting && !done;

  const doSubmit = async () => {
    if (!canSubmit) return;
    setSubmitState('submitting'); setErrorMsg('');
    let r;
    try {
      r = await momentecSubmitOrder(built.order, env);
    } catch (e) {
      setErrorMsg(e.message || 'Submit failed — try again or order manually on momentecbrands.com.');
      setSubmitState('error');
      return;
    }
    // Momentec accepted the order — success regardless of local bookkeeping.
    setResult(r); setSubmitState('success');
    // Only a LIVE (prod) order should mark the batch as ordered; stage validates only.
    // Run bookkeeping OUTSIDE the submit try so a promotion error can't mask a placed order.
    try {
      if (live) onSubmitted && onSubmitted(r);
    } catch (e) {
      console.error('[Momentec] order placed but post-order bookkeeping failed:', e);
    }
  };

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
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>✓ {live ? 'Order placed with Momentec' : 'Stage order accepted'}</div>
              <div>{live ? 'Momentec accepted the order and returned an order number.' : 'Momentec’s sandbox accepted the order — your account can order and the payload is valid. Nothing real was placed.'}</div>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Stat label="PO Number" value={poNumber} mono />
                <Stat label={live ? 'Momentec Order #' : 'Stage Order #'} value={result?.orderId || '—'} mono />
              </div>
            </div>
          ) : submitState === 'error' ? (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
              <strong>✗ Momentec did not accept the order — nothing was placed.</strong>
              <div style={{ marginTop: 4, fontFamily: 'monospace' }}>{errorMsg}</div>
              <div style={{ marginTop: 6 }}>Fix the issue and retry, or place this order manually on momentecbrands.com.</div>
            </div>
          ) : live ? (
            <div style={{ padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
              <strong style={{ color: '#b45309' }}>⚠ LIVE production order.</strong> Submitting sends this order to Momentec and <strong>ships real goods</strong>. Review every line below — nothing is sent until you check the box and click <em>Place Order</em>.
            </div>
          ) : (
            <div style={{ padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#1e40af' }}>
              <strong>🧪 Stage (sandbox) order.</strong> Submits to Momentec’s test environment to confirm the account can order and every line resolves — nothing ships. Check "Live production order" below to place it for real.
            </div>
          )}

          {!done && resolving && (
            <div style={{ padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#1e40af' }}>
              <strong>🔄 Looking up Momentec SKUs…</strong> Matching each line to its design.color.size SKU. Submit unlocks once every line has one.
            </div>
          )}

          {!done && !resolving && resolveErr && (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
              <strong>⚠ Couldn't reach Momentec to look up SKUs:</strong> {resolveErr}. Try reopening, or order manually.
            </div>
          )}

          {!done && !resolving && warnings.length > 0 && (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
              <strong>⚠ Cannot submit — {warnings.length} line(s) without a matched Momentec SKU:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              {unresolvedStyles.some(st => (candidates[st] || []).length) && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #fecaca' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Colors Momentec lists for these styles (for matching):</div>
                  {unresolvedStyles.map(st => (candidates[st] || []).length ? (
                    <div key={st} style={{ marginBottom: 4 }}>
                      <code>{st}</code>: {[...new Set((candidates[st] || []).map(c => c.color).filter(Boolean))].slice(0, 16).join(' · ') || '(no colors returned)'}
                    </div>
                  ) : null)}
                  <div style={{ marginTop: 4, color: '#7f1d1d' }}>If the right color is listed but didn't match, it's a naming difference — tell me and I'll fix it. Otherwise order those lines manually.</div>
                </div>
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
            <strong>Ships to:</strong> {ship.companyName} · {ship.address1}{ship.address2 ? ', ' + ship.address2 : ''}, {ship.city} {ship.region} {ship.postalCode} · Ground
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
                    <th style={th}>Momentec SKU</th>
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
                  {lines.map((l, i) => (
                    <tr key={l.key} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={td}>{i + 1}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: l.sku ? '#0f766e' : '#dc2626' }}>{l.sku || (resolving ? '…' : '⚠ missing')}</td>
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

          {tab === 'json' && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>POST → <code>{live ? 'api' : 'stage-api'}.momentecbrands.com/v2/Order</code> ({live ? 'LIVE' : 'STAGE'})</div>
              <pre style={{ background: '#0f172a', color: '#a5f3fc', padding: 12, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 420, margin: 0 }}>{JSON.stringify(built.order, null, 2)}</pre>
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {done ? (
            <>
              <span style={{ flex: 1, fontSize: 12, color: '#166534', fontWeight: 700 }}>✓ {live ? 'Order' : 'Stage'} {result?.orderId}</span>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </>
          ) : (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155', cursor: 'pointer' }} title="Off = Momentec sandbox (nothing ships); on = real production order">
                <input type="checkbox" checked={live} disabled={submitting} onChange={e => { setLive(e.target.checked); setConfirmed(false); }} />
                Live production order
              </label>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: blocked ? '#94a3b8' : '#334155', cursor: blocked ? 'not-allowed' : 'pointer' }}>
                <input type="checkbox" checked={confirmed} disabled={blocked || submitting} onChange={e => setConfirmed(e.target.checked)} />
                {live
                  ? <span>I confirm this is a real order — place it with Momentec and ship the goods.</span>
                  : <span>Confirm stage submission (validates only — nothing ships).</span>}
              </label>
              <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={doSubmit}
                disabled={!canSubmit}
                title={resolving ? 'Looking up SKUs…' : blocked ? 'Every line needs a Momentec SKU first' : !confirmed ? 'Check the confirmation box first' : ''}
                style={{ background: live ? '#b91c1c' : '#1e40af', borderColor: live ? '#b91c1c' : '#1e40af', opacity: canSubmit ? 1 : 0.55 }}
              >
                {submitting ? 'Submitting…' : resolving ? 'Looking up SKUs…' : live ? '🚀 Place Order with Momentec' : '🧪 Submit Stage Order'}
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
