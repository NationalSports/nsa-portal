// SanMar PO submission modal — PromoStandards sendPO.
// Verifies live program pricing against the queued PO costs (showing a diff the
// user can accept), then lets the user transmit the order to SanMar for real.
import React, { useEffect, useMemo, useState } from 'react';
import { buildSanMarPOPayload, buildSanMarPOSoap } from './sanmarPO';
import { sanmarGetPricing, sanmarSubmitPO } from './vendorApis';

// Normalize size labels so SanMar's pricing response lines up with the PO sizes.
function normSize(s) {
  const x = String(s || '').toUpperCase().replace(/\s+/g, '');
  const map = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL', XXXXXL: '5XL', XXXXXXL: '6XL' };
  return map[x] || x;
}

function deriveStyle(it) {
  return it._sanmar_style || (String(it.sku || '').split(/[\s_]/)[0] || it.sku || '');
}

// Recursively pull the first scalar value found under any of the given key names.
function deepFind(obj, names) {
  if (obj == null || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    if (names.includes(k) && obj[k] != null && typeof obj[k] !== 'object') return obj[k];
  }
  for (const k of Object.keys(obj)) {
    const v = deepFind(obj[k], names);
    if (v != null) return v;
  }
  return null;
}

export default function SanMarPreviewModal({ batchPOs, poNumber, vendorName = 'SanMar', shipTo, onClose, onApplyPrices, onSubmitted }) {
  const [tab, setTab] = useState('lines'); // 'lines' | 'xml'
  const [copied, setCopied] = useState(false);
  const [overrides, setOverrides] = useState({}); // lineNumber -> new unitPrice
  const [pc, setPc] = useState({ status: 'idle', rows: [], error: null, applied: false }); // price check
  const [sub, setSub] = useState({ status: 'idle', msg: '', raw: '', finalized: false }); // submission
  const [env, setEnv] = useState('test'); // 'test' (SanMar sandbox) | 'prod' (real order)

  // Live submit + price-apply are only enabled when the host wires the callbacks
  // (the Batch PO Queue page). Other mounts (e.g. the order-editor "batch ready"
  // popup) render this as a read-only preview so they can't place an unrecorded order.
  const liveSubmit = typeof onSubmitted === 'function';
  const canApply = typeof onApplyPrices === 'function';

  const basePayload = useMemo(
    () => buildSanMarPOPayload({ poNumber, batchPOs, customerNumber: '' }),
    [batchPOs, poNumber]
  );
  const baseLines = basePayload.PO.lineItems;

  // Lines with any accepted price overrides applied.
  const lines = useMemo(
    () => baseLines.map(l => (overrides[l.lineNumber] != null ? { ...l, unitPrice: overrides[l.lineNumber] } : l)),
    [baseLines, overrides]
  );
  const totals = useMemo(() => ({
    lineCount: lines.length,
    totalQty: lines.reduce((s, l) => s + l.quantity, 0),
    totalCost: lines.reduce((s, l) => s + l.quantity * (l.unitPrice || 0), 0),
  }), [lines]);

  const soap = useMemo(
    () => buildSanMarPOSoap({ ...basePayload, PO: { ...basePayload.PO, lineItems: lines } }, { username: '<from env>', customerNumber: '<from env>' }),
    [basePayload, lines]
  );

  // Verify live SanMar program pricing as soon as the modal opens.
  // eslint-disable-next-line
  useEffect(() => { verifyPrices(); }, []);

  async function verifyPrices() {
    setPc({ status: 'loading', rows: [], error: null, applied: false });
    try {
      const combos = {};
      baseLines.forEach(l => { combos[l.style + '||' + (l.color || '')] = { style: l.style, color: l.color || '' }; });
      const priceByCombo = {};
      for (const k of Object.keys(combos)) {
        const { style, color } = combos[k];
        try {
          const data = await sanmarGetPricing(style, color, '');
          const map = {};
          (data?.items || []).forEach(it => {
            const sz = normSize(it.size || it.labelSize || 'OSFA');
            const mp = parseFloat(it.myPrice || 0), sp = parseFloat(it.salePrice || 0), pp = parseFloat(it.piecePrice || 0);
            const price = mp > 0 ? mp : sp > 0 ? sp : pp > 0 ? pp : 0;
            if (price > 0) map[sz] = price;
          });
          priceByCombo[k] = map;
        } catch (e) { priceByCombo[k] = {}; }
      }
      const rows = [];
      baseLines.forEach(l => {
        const map = priceByCombo[l.style + '||' + (l.color || '')] || {};
        const live = map[normSize(l.size)];
        if (live != null && Math.abs(live - (l.unitPrice || 0)) > 0.005) {
          rows.push({ lineNumber: l.lineNumber, sourceSO: l.sourceSO, style: l.style, color: l.color || '', size: l.size, oldPrice: l.unitPrice || 0, newPrice: live });
        }
      });
      setPc({ status: 'done', rows, error: null, applied: false });
    } catch (e) {
      setPc({ status: 'done', rows: [], error: e.message || 'Price check failed', applied: false });
    }
  }

  function applyPrices() {
    const next = {};
    pc.rows.forEach(r => { next[r.lineNumber] = r.newPrice; });
    setOverrides(prev => ({ ...prev, ...next }));

    // Rebuild the queued batch POs with the new per-size costs so the order we log
    // (and the SO cost basis) reflects SanMar's live pricing.
    const updated = batchPOs.map(bp => {
      let touched = false;
      const items = bp.items.map(it => {
        const style = deriveStyle(it);
        const color = it._sanmar_color || it.color || '';
        const sc = { ...(it._size_costs || it._sizeCosts || {}) };
        let itemTouched = false;
        Object.keys(it.sizes || {}).forEach(sz => {
          const row = pc.rows.find(r => r.sourceSO === bp.so_id && r.style === style && (r.color || '') === (color || '') && r.size === sz);
          if (row) { sc[sz] = row.newPrice; itemTouched = true; touched = true; }
        });
        if (!itemTouched) return it;
        const costVals = Object.keys(it.sizes || {}).map(sz => (sc[sz] != null ? sc[sz] : it.unit_cost));
        const base = costVals.length ? Math.min(...costVals) : it.unit_cost;
        const multi = new Set(Object.values(sc).map(v => (+v).toFixed(2))).size > 1;
        const nextIt = { ...it, unit_cost: base };
        if (multi) nextIt._size_costs = sc; else delete nextIt._size_costs;
        return nextIt;
      });
      if (!touched) return bp;
      const total = items.reduce((a, it) => a + Object.entries(it.sizes || {}).reduce((s, [sz, q]) => {
        const c = (it._size_costs && it._size_costs[sz] != null) ? it._size_costs[sz] : it.unit_cost;
        return s + q * c;
      }, 0), 0);
      return { ...bp, items, total_cost: total };
    });
    if (onApplyPrices) onApplyPrices(updated);
    setPc(p => ({ ...p, rows: [], applied: true }));
  }

  async function submit() {
    const isTest = env === 'test';
    const ok = window.confirm(
      isTest
        ? `Send a TEST order to SanMar's sandbox?\n\n${poNumber} · ${totals.totalQty} units\n\nNo real order is placed — SanMar reviews the format only.`
        : `Place a REAL, billable purchase order with ${vendorName}?\n\n${poNumber} · ${totals.lineCount} lines · ${totals.totalQty} units · $${totals.totalCost.toFixed(2)}\n\nThis cannot be undone here.`
    );
    if (!ok) return;
    setSub({ status: 'submitting', msg: '', raw: '', finalized: false });
    try {
      const payload = {
        poNum: poNumber,
        attention: poNumber,
        shipTo: shipTo?.name || '',
        shipAddress1: shipTo?.addr || '',
        shipAddress2: shipTo?.addr2 || '',
        shipCity: shipTo?.city || '',
        shipState: shipTo?.state || '',
        shipZip: shipTo?.zip || '',
        shipEmail: shipTo?.email || '',
        shipMethod: 'UPS',
        residence: 'N',
        items: lines.map(l => ({ style: l.style, color: l.color, size: l.size, quantity: l.quantity })),
      };
      const res = await sanmarSubmitPO(payload, { test: isTest });
      const errOcc = String(deepFind(res, ['errorOccurred', 'errorOccured']) ?? '').toLowerCase();
      const msg = deepFind(res, ['message']);
      const raw = (res && res._rawXml) || JSON.stringify(res, null, 2);
      const accepted = errOcc === 'false' || (errOcc !== 'true' && /success/i.test(msg || ''));
      if (accepted) {
        if (isTest) {
          setSub({ status: 'success', msg: `Test order accepted (${msg || 'OK'}). Email this test PO (${poNumber}) to sanmarintegrations@sanmar.com to verify, then switch to Live.`, raw, finalized: false });
        } else {
          setSub({ status: 'success', msg: msg || `${vendorName} accepted the order.`, raw, finalized: true });
          if (onSubmitted) onSubmitted({ transactionId: '', raw, env: 'prod', message: msg || '' });
        }
      } else {
        const m = msg || '';
        let hint = '';
        if (/FTP.*folder|folder does not exist/i.test(m)) {
          hint = ' — Your SanMar credentials authenticated and the order format is correct, but PO submission is not yet enabled on your SanMar account. Email sanmarintegrations@sanmar.com and ask them to provision the integration (FTP "In") folder for your customer number, then resubmit. No code change is needed.';
        } else if (/authenticat|credential|user.*fail/i.test(m)) {
          hint = isTest
            ? ' — SanMar\'s sandbox (test-ws) uses a separate account that won\'t accept your production login. Ask SanMar for test/integration credentials (set as SANMAR_TEST_* env vars), or switch to Live, since the order format is now validated.'
            : '';
        }
        setSub({ status: 'error', msg: m + hint, raw, finalized: false });
      }
    } catch (e) {
      setSub({ status: 'error', msg: e.message || 'Submission failed', raw: '', finalized: false });
    }
  }

  const copyXml = () => {
    navigator.clipboard?.writeText(soap);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const submitting = sub.status === 'submitting';
  const done = sub.status === 'success' && sub.finalized; // a real (prod) order was placed

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="modal-header">
          <h2>{liveSubmit ? `📦 ${vendorName} — Submit Purchase Order` : `🔍 ${vendorName} PO Preview`}</h2>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          {!done && liveSubmit && env === 'test' && (
            <div style={{ padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
              <strong style={{ color: '#1d4ed8' }}>🧪 Test mode.</strong> Submits to SanMar's sandbox (test-ws.sanmar.com) via the submitPO service. <strong>No real order is placed.</strong> Use this to validate the format, then switch to Live.
            </div>
          )}
          {!done && liveSubmit && env === 'prod' && (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
              <strong style={{ color: '#b91c1c' }}>⚠ Live mode.</strong> Clicking <strong>Submit LIVE to {vendorName}</strong> places a REAL, billable order via the submitPO service. Credentials are injected server-side. Verify line items and pricing first.
            </div>
          )}
          {!liveSubmit && (
            <div style={{ padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
              <strong style={{ color: '#b45309' }}>Preview only.</strong> Nothing is sent from here. To verify pricing and submit the order to {vendorName}, open it from the <strong>Batch PO Queue</strong> page.
            </div>
          )}

          {/* Price verification */}
          <PriceCheck pc={pc} onApply={applyPrices} onRecheck={verifyPrices} canApply={canApply} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, margin: '12px 0' }}>
            <Stat label="PO Number" value={poNumber} mono />
            <Stat label="Line Items" value={totals.lineCount} />
            <Stat label="Total Units" value={totals.totalQty} />
            <Stat label="Total Cost" value={'$' + totals.totalCost.toFixed(2)} />
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
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#1e40af' }}>{l.style}</td>
                      <td style={td}>{l.color || '—'}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{l.size}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{l.quantity}</td>
                      <td style={{ ...td, textAlign: 'right', color: overrides[l.lineNumber] != null ? '#166534' : 'inherit', fontWeight: overrides[l.lineNumber] != null ? 700 : 400 }}>${(l.unitPrice || 0).toFixed(2)}</td>
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
                <span style={{ fontSize: 11, color: '#64748b' }}>POST → <code>ws.sanmar.com:8080/promostandards/POServiceBinding</code></span>
                <button className="btn btn-sm btn-secondary" onClick={copyXml}>{copied ? '✓ Copied' : '📋 Copy XML'}</button>
              </div>
              <pre style={{ background: '#0f172a', color: '#a5f3fc', padding: 12, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 360, margin: 0 }}>{soap}</pre>
            </div>
          )}

          {/* Submission result */}
          {sub.status !== 'idle' && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 8, fontSize: 13,
              background: sub.status === 'error' ? '#fef2f2' : sub.status === 'success' ? '#f0fdf4' : '#fffbeb',
              border: '1px solid ' + (sub.status === 'error' ? '#fecaca' : sub.status === 'success' ? '#bbf7d0' : '#fde68a') }}>
              {sub.status === 'submitting' && <span>⏳ Submitting to {vendorName}…</span>}
              {sub.status === 'success' && <div><strong style={{ color: '#166534' }}>✓ {sub.msg}</strong></div>}
              {sub.status === 'error' && <div><strong style={{ color: '#b91c1c' }}>✕ Submission failed</strong><div style={{ marginTop: 4 }}>{sub.msg}</div></div>}
              {sub.raw && sub.status === 'error' && (
                <pre style={{ marginTop: 8, background: '#0f172a', color: '#fca5a5', padding: 10, borderRadius: 6, fontSize: 10, overflow: 'auto', maxHeight: 200 }}>{sub.raw}</pre>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {liveSubmit && !done && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Mode:</span>
              <button onClick={() => setEnv('test')} style={segBtn(env === 'test', '#2563eb')}>Test</button>
              <button onClick={() => setEnv('prod')} style={segBtn(env === 'prod', '#dc2626')}>Live</button>
            </div>
          )}
          {!liveSubmit && <span style={{ flex: 1, fontSize: 11, color: '#94a3b8' }}>Preview only — submit from the Batch PO Queue page.</span>}
          <button className="btn btn-secondary" onClick={onClose}>{done ? 'Close' : liveSubmit ? 'Cancel' : 'Close'}</button>
          {!done && liveSubmit && (
            <button className="btn btn-primary" style={{ background: env === 'test' ? '#2563eb' : '#16a34a', borderColor: env === 'test' ? '#2563eb' : '#16a34a' }} disabled={submitting || lines.length === 0} onClick={submit}>
              {submitting ? 'Submitting…' : env === 'test' ? '🧪 Send Test to SanMar' : `🚀 Submit LIVE to ${vendorName}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PriceCheck({ pc, onApply, onRecheck, canApply }) {
  if (pc.status === 'loading') {
    return <div style={{ padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#64748b' }}>⏳ Verifying line costs against SanMar live program pricing…</div>;
  }
  if (pc.status !== 'done') return null;
  if (pc.error) {
    return <div style={{ padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12 }}>
      ⚠ Couldn't verify pricing: {pc.error} <button className="btn btn-sm btn-secondary" style={{ marginLeft: 8 }} onClick={onRecheck}>Retry</button>
    </div>;
  }
  if (pc.applied || pc.rows.length === 0) {
    return <div style={{ padding: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534' }}>
      ✓ {pc.applied ? 'Prices updated to match SanMar live pricing.' : 'All line costs match SanMar live program pricing.'}
      <button className="btn btn-sm btn-secondary" style={{ marginLeft: 8 }} onClick={onRecheck}>Re-check</button>
    </div>;
  }
  return (
    <div style={{ padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 6 }}>
        ⚠ {pc.rows.length} price{pc.rows.length !== 1 ? 's' : ''} differ from SanMar's live program pricing
      </div>
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={{ ...th, fontSize: 10 }}>Style</th><th style={{ ...th, fontSize: 10 }}>Color</th><th style={{ ...th, fontSize: 10 }}>Size</th>
          <th style={{ ...th, fontSize: 10, textAlign: 'right' }}>PO cost</th><th style={{ ...th, fontSize: 10, textAlign: 'right' }}>SanMar</th><th style={{ ...th, fontSize: 10, textAlign: 'right' }}>Δ</th>
        </tr></thead>
        <tbody>
          {pc.rows.map(r => {
            const diff = r.newPrice - r.oldPrice;
            return <tr key={r.lineNumber} style={{ borderTop: '1px solid #fef3c7' }}>
              <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700 }}>{r.style}</td>
              <td style={td}>{r.color || '—'}</td>
              <td style={{ ...td, fontWeight: 700 }}>{r.size}</td>
              <td style={{ ...td, textAlign: 'right' }}>${r.oldPrice.toFixed(2)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#166534' }}>${r.newPrice.toFixed(2)}</td>
              <td style={{ ...td, textAlign: 'right', color: diff > 0 ? '#b91c1c' : '#166534', fontWeight: 700 }}>{diff > 0 ? '+' : ''}{diff.toFixed(2)}</td>
            </tr>;
          })}
        </tbody>
      </table>
      {canApply && <button className="btn btn-sm btn-primary" style={{ marginTop: 8 }} onClick={onApply}>Update {pc.rows.length} price{pc.rows.length !== 1 ? 's' : ''} to SanMar pricing</button>}
    </div>
  );
}

const th = { padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#475569', borderBottom: '1px solid #e2e8f0' };
const td = { padding: '6px 8px', fontSize: 12 };

function segBtn(active, activeColor) {
  return {
    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: '1px solid ' + (active ? activeColor : '#cbd5e1'),
    background: active ? activeColor : 'white',
    color: active ? 'white' : '#64748b',
  };
}

function Stat({ label, value, mono }) {
  return (
    <div style={{ padding: 8, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
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
