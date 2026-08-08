/* eslint-disable */
import React, { useState, useEffect, useCallback } from 'react';

// Public, token-gated DTF supplier portal. Rendered standalone by App.js
// (outside the logged-in app shell) when the URL has ?dtfvendor=TOKEN.
// All API calls use plain fetch (not authFetch) with the token in a header.

const NAVY = '#1e3a5f';
const NAVY_DARK = '#0f172a';
const API = '/.netlify/functions/dtf-orders';

const fmtDate = (s) => {
  if (!s) return '';
  const dt = new Date(s);
  return isNaN(dt) ? '' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const fmtDateShort = (s) => {
  if (!s) return '';
  const dt = new Date(s);
  return isNaN(dt) ? '' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Pastel tints cycled by request_id so same-request placements share a color.
const TINTS = ['#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe', '#fee2e2', '#e0f2fe', '#fce7f3', '#ecfccb'];
const tintFor = (key, map) => {
  if (!map.has(key)) map.set(key, TINTS[map.size % TINTS.length]);
  return map.get(key);
};

async function callApi(token, body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vendor-token': token || '' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

function LayoutSvg({ layout }) {
  if (!layout || !layout.sheet_width_in || !layout.sheet_length_in) return null;
  const W = layout.sheet_width_in;
  const L = layout.sheet_length_in;
  const placements = Array.isArray(layout.placements) ? layout.placements : [];
  const tintMap = new Map();
  return (
    <svg viewBox={`0 0 ${W} ${L}`} style={{ width: '100%', height: 'auto', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6 }}>
      <rect x="0" y="0" width={W} height={L} fill="#fff" />
      {placements.map((p, i) => {
        const key = p.request_id != null ? String(p.request_id) : `p${i}`;
        const fill = tintFor(key, tintMap);
        // p.x/y/w/h are already in the FINAL placed orientation (the packer
        // swaps w/h when it rotates) — `rotated` is a flag for the operator
        // that the art itself prints turned 90°, not a transform to apply.
        const w = p.w || 0;
        const h = p.h || 0;
        return (
          <g key={i}>
            <rect
              x={p.x || 0}
              y={p.y || 0}
              width={w}
              height={h}
              fill={fill}
              stroke="#94a3b8"
              strokeWidth={W / 250}
            />
            <text
              x={(p.x || 0) + w / 2}
              y={(p.y || 0) + h / 2}
              fontSize={Math.max(W / 60, 1)}
              fill="#334155"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {(p.copy != null ? `#${p.copy}` : '') + (p.rotated ? ' ⟳' : '')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function buildPrintHtml(batch) {
  const rows = (batch.lines || []).map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${(l.design_name || '').replace(/</g, '&lt;')}</td>
      <td>${(l.width_in || '')}&quot; x ${(l.height_in || '')}&quot;</td>
      <td>${l.qty || ''}</td>
      <td>${l.outline ? 'YES' : '-'}</td>
    </tr>`).join('');

  let svgHtml = '';
  if (batch.layout && batch.layout.sheet_width_in && batch.layout.sheet_length_in) {
    const W = batch.layout.sheet_width_in;
    const L = batch.layout.sheet_length_in;
    const tintMap = new Map();
    const rects = (batch.layout.placements || []).map((p, i) => {
      const key = p.request_id != null ? String(p.request_id) : `p${i}`;
      const fill = tintFor(key, tintMap);
      // Placed orientation is already baked into w/h — no rotate transform
      // (matches LayoutSvg above); `rotated` just annotates the label.
      const w = p.w || 0, h = p.h || 0;
      return `<g><rect x="${p.x || 0}" y="${p.y || 0}" width="${w}" height="${h}" fill="${fill}" stroke="#94a3b8" stroke-width="${W / 250}" /><text x="${(p.x || 0) + w / 2}" y="${(p.y || 0) + h / 2}" font-size="${Math.max(W / 60, 1)}" fill="#334155" text-anchor="middle" dominant-baseline="middle">${(p.copy != null ? '#' + p.copy : '') + (p.rotated ? ' (rot)' : '')}</text></g>`;
    }).join('');
    svgHtml = `<svg viewBox="0 0 ${W} ${L}" style="width:100%;height:auto;border:1px solid #cbd5e1"><rect x="0" y="0" width="${W}" height="${L}" fill="#fff" />${rects}</svg>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Batch ${batch.batch_number}</title>
  <style>
    body { font-family: -apple-system, Arial, sans-serif; padding: 24px; color: #0f172a; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #64748b; margin-bottom: 20px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 12px; text-align: left; }
    th { background: #f1f5f9; }
  </style></head>
  <body>
    <h1>Batch ${batch.batch_number}</h1>
    <div class="sub">${batch.total_prints || (batch.lines || []).length} prints &middot; ${batch.sheet_width_in || ''}&quot; x ${batch.sheet_length_in || ''}&quot; roll</div>
    ${svgHtml}
    <table>
      <thead><tr><th>#</th><th>Design</th><th>Size</th><th>Qty</th><th>White outline</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <script>window.onload = function(){ window.print(); };</script>
  </body></html>`;
}

function openPrintSheet(batch) {
  const html = buildPrintHtml(batch);
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function ManifestTable({ lines }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
            <th style={{ padding: '6px 8px' }}>#</th>
            <th style={{ padding: '6px 8px' }}></th>
            <th style={{ padding: '6px 8px' }}>Design</th>
            <th style={{ padding: '6px 8px' }}>Size</th>
            <th style={{ padding: '6px 8px' }}>Qty</th>
            <th style={{ padding: '6px 8px' }}>White outline</th>
            <th style={{ padding: '6px 8px' }}>File</th>
          </tr>
        </thead>
        <tbody>
          {(lines || []).map((l, i) => (
            <tr key={l.id || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px' }}>{i + 1}</td>
              <td style={{ padding: '8px' }}>
                {l.preview_url ? (
                  <img
                    src={l.preview_url}
                    alt=""
                    style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 4, border: '1px solid #e2e8f0', background: '#fff' }}
                  />
                ) : null}
              </td>
              <td style={{ padding: '8px' }}>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{l.design_name || 'Untitled'}</div>
                {l.notes ? <div style={{ fontSize: 11, color: '#94a3b8' }}>{l.notes}</div> : null}
              </td>
              <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                {l.width_in || '?'}&quot; x {l.height_in || '?'}&quot;
              </td>
              <td style={{ padding: '8px' }}>{l.qty}</td>
              <td style={{ padding: '8px' }}>
                {l.outline ? <span className="badge badge-blue">YES</span> : <span style={{ color: '#cbd5e1' }}>-</span>}
              </td>
              <td style={{ padding: '8px' }}>
                {l.file_url ? (
                  <a href={l.file_url} download={l.file_name || true} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
                    Download
                  </a>
                ) : (
                  <span style={{ color: '#cbd5e1' }}>-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShipForm({ batch, token, onShipped }) {
  const [carrier, setCarrier] = useState('UPS');
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    if (!tracking.trim()) { setError('Tracking number is required.'); return; }
    if (!window.confirm(`Mark batch ${batch.batch_number} as shipped via ${carrier}, tracking ${tracking.trim()}?`)) return;
    setSubmitting(true);
    setError('');
    try {
      const { status, data } = await callApi(token, {
        action: 'vendor_mark_shipped',
        batch_id: batch.id,
        carrier,
        tracking_number: tracking.trim(),
        note: note.trim() || undefined,
      });
      if (status === 200 && data && data.ok) {
        setSuccess(true);
        onShipped && onShipped();
      } else {
        setError((data && data.error) || 'Could not mark as shipped. Please try again.');
      }
    } catch (e) {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div style={{ background: '#dcfce7', color: '#166534', borderRadius: 8, padding: '12px 16px', fontWeight: 600, fontSize: 13 }}>
        Batch {batch.batch_number} marked as shipped. Thank you!
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 8, fontSize: 14 }}>Ready to ship?</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <select
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          disabled={submitting}
          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
        >
          <option value="UPS">UPS</option>
          <option value="FedEx">FedEx</option>
          <option value="USPS">USPS</option>
          <option value="Other">Other</option>
        </select>
        <input
          type="text"
          placeholder="Tracking number"
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          disabled={submitting}
          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, flex: '1 1 180px', minWidth: 160 }}
        />
        <input
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={submitting}
          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, flex: '1 1 180px', minWidth: 160 }}
        />
        <button className="btn btn-primary" onClick={submit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Mark shipped'}
        </button>
      </div>
      {error ? <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}

function OpenBatchCard({ batch, token, onChanged }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: NAVY_DARK }}>
            {batch.batch_number}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Sent {fmtDate(batch.sent_at)} &middot; {batch.total_prints || (batch.lines || []).length} prints
            {batch.sheet_width_in && batch.sheet_length_in ? ` · est. ${batch.sheet_width_in}″ x ${batch.sheet_length_in}″ roll` : ''}
          </div>
        </div>
        <span className="badge badge-blue">Open</span>
      </div>
      <div className="card-body">
        <ManifestTable lines={batch.lines} />

        {batch.layout ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Gang sheet layout
            </div>
            <LayoutSvg layout={batch.layout} />
          </div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => openPrintSheet(batch)}>
            Print layout sheet
          </button>
        </div>

        <div style={{ marginTop: 20, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
          <ShipForm batch={batch} token={token} onShipped={onChanged} />
        </div>
      </div>
    </div>
  );
}

function ShippedTable({ batches }) {
  if (!batches.length) return null;
  return (
    <div className="card">
      <div className="card-header"><h2>Recently shipped</h2></div>
      <div className="card-body" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
              <th style={{ padding: '6px 8px' }}>Batch</th>
              <th style={{ padding: '6px 8px' }}>Shipped</th>
              <th style={{ padding: '6px 8px' }}>Carrier / Tracking</th>
              <th style={{ padding: '6px 8px' }}>Prints</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '8px', fontFamily: 'monospace', fontWeight: 600 }}>{b.batch_number}</td>
                <td style={{ padding: '8px', color: '#64748b' }}>{fmtDateShort(b.shipped_at)}</td>
                <td style={{ padding: '8px' }}>{b.carrier || '-'} {b.tracking_number || ''}</td>
                <td style={{ padding: '8px' }}>{b.total_prints || (b.lines || []).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DtfVendorPortal({ token }) {
  const [state, setState] = useState({ loading: true, error: null, blocked: null, supplierName: '', batches: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { status, data } = await callApi(token, { action: 'vendor_list' });
      if (status === 401) {
        setState({ loading: false, error: null, blocked: 'invalid', supplierName: '', batches: [] });
        return;
      }
      if (status === 503) {
        setState({ loading: false, error: null, blocked: 'unconfigured', supplierName: '', batches: [] });
        return;
      }
      if (status === 200 && data && data.ok) {
        setState({ loading: false, error: null, blocked: null, supplierName: data.supplier_name || '', batches: data.batches || [] });
        return;
      }
      setState({ loading: false, error: 'Could not load orders. Please try again.', blocked: null, supplierName: '', batches: [] });
    } catch (e) {
      setState({ loading: false, error: 'Network error — please try again.', blocked: null, supplierName: '', batches: [] });
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const shell = (children) => (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <div style={{ background: NAVY, color: '#fff', padding: '18px 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.3 }}>NSA &mdash; National Sports Apparel</div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>DTF Supplier Portal</div>
          </div>
          {state.supplierName ? (
            <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, background: 'rgba(255,255,255,0.08)', padding: '6px 12px', borderRadius: 6 }}>
              {state.supplierName}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px 60px' }}>
        {children}
      </div>
    </div>
  );

  if (state.blocked === 'invalid') {
    return shell(
      <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: NAVY_DARK, marginBottom: 8 }}>Invalid or expired link</div>
        <div style={{ color: '#64748b' }}>Please contact NSA for a new link.</div>
      </div>
    );
  }

  if (state.blocked === 'unconfigured') {
    return shell(
      <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: NAVY_DARK, marginBottom: 8 }}>Portal not configured</div>
        <div style={{ color: '#64748b' }}>Please contact NSA for assistance.</div>
      </div>
    );
  }

  if (state.loading) {
    return shell(
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>Loading orders…</div>
    );
  }

  if (state.error) {
    return shell(
      <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 8, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>{state.error}</span>
        <button className="btn btn-secondary btn-sm" onClick={load}>Retry</button>
      </div>
    );
  }

  const open = state.batches.filter((b) => b.status === 'sent');
  const shipped = state.batches
    .filter((b) => b.status === 'shipped')
    .sort((a, b) => new Date(b.shipped_at || 0) - new Date(a.shipped_at || 0));

  return shell(
    <>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: NAVY_DARK, marginBottom: 12 }}>Open orders</h2>
        {open.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '36px 20px', color: '#64748b' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: NAVY_DARK, marginBottom: 4 }}>All caught up</div>
            <div>No open DTF orders right now.</div>
          </div>
        ) : (
          open.map((b) => <OpenBatchCard key={b.id} batch={b} token={token} onChanged={load} />)
        )}
      </div>

      <ShippedTable batches={shipped} />
    </>
  );
}
