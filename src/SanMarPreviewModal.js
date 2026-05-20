// SanMar PO submission preview modal — dry-run only.
// Renders the line items that would be sent + the raw SOAP envelope so a
// human can verify the payload before we wire up the real network call.
import React, { useMemo, useState } from 'react';
import { buildSanMarPOPayload, buildSanMarPOSoap } from './sanmarPO';

export default function SanMarPreviewModal({ batchPOs, poNumber, vendorName = 'SanMar', onClose }) {
  const [tab, setTab] = useState('lines'); // 'lines' | 'xml'
  const [copied, setCopied] = useState(false);

  const { payload, soap, lines, totals } = useMemo(() => {
    const p = buildSanMarPOPayload({
      poNumber,
      batchPOs,
      // Customer number isn't known on the client (it lives in Netlify env).
      // Leave blank in the preview — the proxy populates it on real submit.
      customerNumber: '',
    });
    const xml = buildSanMarPOSoap(p, { username: '<from env>', customerNumber: '<from env>' });
    return { payload: p, soap: xml, lines: p.PO.lineItems, totals: p._summary };
  }, [batchPOs, poNumber]);

  const copyXml = () => {
    navigator.clipboard?.writeText(soap);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="modal-header">
          <h2>🔍 {vendorName} API Submit — Dry Run</h2>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <div style={{ padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
            <strong style={{ color: '#b45309' }}>⚠ Dry-run preview only.</strong> No request has been sent to SanMar. This shows the exact PromoStandards <code>sendPO</code> payload that <em>would</em> be POSTed once live submission is enabled. Credentials are injected server-side and are not displayed here.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
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
                <span style={{ fontSize: 11, color: '#64748b' }}>POST → <code>ws.sanmar.com:8080/promostandards/POServiceBinding</code></span>
                <button className="btn btn-sm btn-secondary" onClick={copyXml}>{copied ? '✓ Copied' : '📋 Copy XML'}</button>
              </div>
              <pre style={{ background: '#0f172a', color: '#a5f3fc', padding: 12, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 420, margin: 0 }}>{soap}</pre>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span style={{ flex: 1, fontSize: 11, color: '#94a3b8' }}>Live submit will be enabled in a follow-up after payload review.</span>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
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
