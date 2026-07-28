// DTF Orders — staff page for managing the weekly DTF transfer gang-sheet order.
// Submit artwork -> queue -> Wednesday batch -> supplier email -> receive/track.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Icon } from './components';
import { authFetch, fileUpload, _cloudinaryPdfThumb, _isImgUrl, _urlExt, openFile } from './utils';

const API = '/.netlify/functions/dtf-orders';

async function callDtf(action, body) {
  const res = await authFetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(body || {}) }),
  });
  let d;
  try { d = await res.json(); } catch { d = { ok: false, error: 'Bad response from server' }; }
  return d;
}

// ─── helpers ───

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  const months = Math.floor(days / 30);
  return months + 'mo ago';
}

function nextWednesday4pmLabel() {
  const now = new Date();
  // Wed 16:00 UTC anchor
  const target = new Date(now);
  const day = target.getUTCDay(); // 0=Sun..6=Sat, Wed=3
  let daysUntil = (3 - day + 7) % 7;
  target.setUTCDate(target.getUTCDate() + daysUntil);
  target.setUTCHours(16, 0, 0, 0);
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 7);
  return target.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function statusBadgeClass(status) {
  switch (status) {
    case 'draft': return 'badge-gray';
    case 'sent': return 'badge-blue';
    case 'shipped': return 'badge-purple';
    case 'received': return 'badge-green';
    case 'canceled': return 'badge-red';
    case 'queued': return 'badge-blue';
    case 'batched': return 'badge-amber';
    default: return 'badge-gray';
  }
}

function StatusBadge({ status }) {
  return <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>;
}

function StatTile({ label, value, sub }) {
  return (
    <div className="stat-card" style={{ minWidth: 140 }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

const PASTELS = ['#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe', '#fce7f3', '#e0f2fe', '#fee2e2', '#ecfccb'];
function pastelFor(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PASTELS[h % PASTELS.length];
}

// Renders a gang-sheet layout (preview or a stored batch layout) as inline SVG.
function GangSheetSvg({ layout, requestsById, maxHeight = 480 }) {
  if (!layout || !layout.sheet_width_in || !layout.sheet_length_in) {
    return <div className="empty" style={{ padding: 20 }}>No layout available.</div>;
  }
  const w = layout.sheet_width_in, l = layout.sheet_length_in;
  const placements = layout.placements || [];
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${w} ${l}`}
        style={{ width: '100%', maxHeight, height: 'auto', display: 'block', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}
        preserveAspectRatio="xMidYMid meet"
      >
        {placements.map((p, i) => {
          const req = requestsById ? requestsById[p.request_id] : null;
          const fill = pastelFor(p.request_id);
          const img = req && req.preview_url;
          const key = p.request_id + '_' + p.copy + '_' + i;
          return (
            <g key={key} transform={p.rotated ? `translate(${p.x + p.w},${p.y}) rotate(90)` : undefined}>
              <rect
                x={p.rotated ? 0 : p.x}
                y={p.rotated ? 0 : p.y}
                width={p.rotated ? p.h : p.w}
                height={p.rotated ? p.w : p.h}
                rx={0.1}
                fill={fill}
                stroke="#94a3b8"
                strokeWidth={0.05}
              />
              {img ? (
                <image
                  href={img}
                  x={(p.rotated ? 0 : p.x) + 0.05}
                  y={(p.rotated ? 0 : p.y) + 0.05}
                  width={(p.rotated ? p.h : p.w) - 0.1}
                  height={(p.rotated ? p.w : p.h) - 0.1}
                  preserveAspectRatio="xMidYMid meet"
                />
              ) : (
                <text
                  x={(p.rotated ? 0 : p.x) + (p.rotated ? p.h : p.w) / 2}
                  y={(p.rotated ? 0 : p.y) + (p.rotated ? p.w : p.h) / 2}
                  fontSize={0.3}
                  fill="#334155"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  clipPath="none"
                >
                  {(req && req.design_name) || p.request_id}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Submit form ───

function SubmitCard({ cust, nf, onSubmitted, defaultSheetWidth }) {
  const [uploading, setUploading] = useState(false);
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [designName, setDesignName] = useState('');
  const [widthIn, setWidthIn] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [lockAspect, setLockAspect] = useState(true);
  const [aspect, setAspect] = useState(null);
  const [qty, setQty] = useState('');
  const [outline, setOutline] = useState(false);
  const [notes, setNotes] = useState('');
  const [custQuery, setCustQuery] = useState('');
  const [custOpen, setCustOpen] = useState(false);
  const [selectedCust, setSelectedCust] = useState(null);
  const [soNum, setSoNum] = useState('');
  const [drag, setDrag] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const custMatches = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    if (!q) return [];
    return (cust || [])
      .filter(c => (c.name || '').toLowerCase().includes(q) || (c.alpha_tag || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [custQuery, cust]);

  const resetForm = () => {
    setFileUrl(''); setFileName(''); setPreviewUrl(null);
    setDesignName(''); setWidthIn(''); setHeightIn(''); setAspect(null);
    setQty(''); setOutline(false); setNotes('');
    setCustQuery(''); setSelectedCust(null); setSoNum('');
  };

  const handleFiles = async (files) => {
    const f = files && files[0];
    if (!f) return;
    setUploading(true);
    try {
      const url = await fileUpload(f, 'nsa-dtf-transfers');
      setFileUrl(url);
      setFileName(f.name);
      const base = (f.name || '').replace(/\.[^.]+$/, '');
      if (!designName) setDesignName(base);
      const ext = _urlExt(url) || (f.name || '').split('.').pop().toLowerCase();
      if (_isImgUrl(url, f) || (f.type && f.type.startsWith('image/'))) {
        setPreviewUrl(url);
        // read natural pixel dims, prefill inches at 300dpi
        try {
          const img = new Image();
          const dims = await new Promise((resolve, reject) => {
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = reject;
            img.src = url;
          });
          if (dims.w && dims.h) {
            const wIn = Math.round((dims.w / 300) * 10) / 10;
            const hIn = Math.round((dims.h / 300) * 10) / 10;
            setWidthIn(String(wIn));
            setHeightIn(String(hIn));
            setAspect(dims.w / dims.h);
          }
        } catch { /* dimension read failed, leave blank */ }
      } else if (['pdf', 'ai'].includes(ext)) {
        const thumb = _cloudinaryPdfThumb(url);
        setPreviewUrl(thumb || null);
      } else {
        setPreviewUrl(null);
      }
    } catch (e) {
      nf('Upload failed: ' + e.message, 'error');
    }
    setUploading(false);
  };

  const onWidthChange = (v) => {
    setWidthIn(v);
    if (lockAspect && aspect && v !== '') {
      const n = parseFloat(v);
      if (!isNaN(n)) setHeightIn(String(Math.round((n / aspect) * 10) / 10));
    }
  };
  const onHeightChange = (v) => {
    setHeightIn(v);
    if (lockAspect && aspect && v !== '') {
      const n = parseFloat(v);
      if (!isNaN(n)) setWidthIn(String(Math.round((n * aspect) * 10) / 10));
    }
  };
  const toggleLock = () => {
    const next = !lockAspect;
    setLockAspect(next);
    if (next) {
      const w = parseFloat(widthIn), h = parseFloat(heightIn);
      if (w > 0 && h > 0) setAspect(w / h);
    }
  };

  const qtyNum = parseInt(qty, 10);
  const wNum = parseFloat(widthIn), hNum = parseFloat(heightIn);
  const valid = !!fileUrl && designName.trim().length > 0 && wNum > 0 && hNum > 0 && Number.isInteger(qtyNum) && qtyNum >= 1;

  const doSubmit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    const d = await callDtf('submit', {
      design_name: designName.trim(),
      file_url: fileUrl,
      file_name: fileName,
      preview_url: previewUrl,
      width_in: wNum,
      height_in: hNum,
      qty: qtyNum,
      outline,
      notes: notes.trim(),
      customer_id: selectedCust ? selectedCust.id : null,
      so_id: soNum.trim() || null,
    });
    setSubmitting(false);
    if (d && d.ok) {
      nf("Added to this week's DTF order");
      resetForm();
      onSubmitted();
    } else {
      nf((d && d.error) || 'Failed to submit design', 'error');
    }
  };

  return (
    <div className="card" style={{ flex: '1 1 380px', minWidth: 340, alignSelf: 'flex-start' }}>
      <div className="card-header"><h2>Submit a transfer</h2></div>
      <div className="card-body">
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = '.ai,.png,.pdf,.eps,.svg,image/*';
            inp.onchange = () => handleFiles(inp.files);
            inp.click();
          }}
          style={{
            border: drag ? '2px dashed #3b82f6' : '2px dashed #d1d5db', borderRadius: 8,
            padding: previewUrl ? 10 : 20, textAlign: 'center', cursor: 'pointer',
            background: drag ? '#eff6ff' : '#fafafa', transition: 'all 0.15s', marginBottom: 14,
          }}
        >
          {uploading ? (
            <div style={{ fontSize: 13, color: '#3b82f6', fontWeight: 600, padding: 20 }}>Uploading…</div>
          ) : previewUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src={previewUrl} alt="" style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 6, background: '#fff', border: '1px solid #e2e8f0' }} />
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', wordBreak: 'break-all' }}>{fileName}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Click or drop to replace</div>
              </div>
            </div>
          ) : fileUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 64, height: 64, borderRadius: 6, background: '#fff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="file" size={22} />
              </div>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', wordBreak: 'break-all' }}>{fileName}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Click or drop to replace</div>
              </div>
            </div>
          ) : (
            <>
              <Icon name="upload" size={22} />
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 6 }}>Click or drag & drop artwork</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>.ai, .png, .pdf, .eps, .svg</div>
            </>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Design name</label>
          <input className="form-input" value={designName} onChange={e => setDesignName(e.target.value)} placeholder="e.g. Panthers Football 2026" />
        </div>

        <div className="form-row form-row-2" style={{ marginBottom: 14, alignItems: 'end' }}>
          <div>
            <label className="form-label">Width (in)</label>
            <input className="form-input" type="number" step="0.1" min="0" value={widthIn} onChange={e => onWidthChange(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">Height (in)</label>
              <input className="form-input" type="number" step="0.1" min="0" value={heightIn} onChange={e => onHeightChange(e.target.value)} />
            </div>
            <button
              type="button"
              className={`btn btn-sm ${lockAspect ? 'btn-primary' : 'btn-secondary'}`}
              title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
              onClick={toggleLock}
              style={{ marginBottom: 1 }}
            >🔗</button>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Qty</label>
          <input className="form-input" type="number" step="1" min="1" value={qty} onChange={e => setQty(e.target.value)} placeholder="e.g. 24" />
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>
            <input type="checkbox" checked={outline} onChange={e => setOutline(e.target.checked)} style={{ width: 15, height: 15 }} />
            Add white outline
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. print on light film, halftones OK…" />
        </div>

        <div className="form-group" style={{ position: 'relative' }}>
          <label className="form-label">Customer (optional)</label>
          {selectedCust ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#dbeafe', color: '#1e40af', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
              {selectedCust.name}{selectedCust.alpha_tag ? ' · ' + selectedCust.alpha_tag : ''}
              <button type="button" onClick={() => setSelectedCust(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1e40af', padding: 0, display: 'flex' }}><Icon name="x" size={12} /></button>
            </div>
          ) : (
            <>
              <input
                className="form-input"
                value={custQuery}
                onChange={e => { setCustQuery(e.target.value); setCustOpen(true); }}
                onFocus={() => setCustOpen(true)}
                onBlur={() => setTimeout(() => setCustOpen(false), 150)}
                placeholder="Search customer name or alpha tag…"
              />
              {custOpen && custMatches.length > 0 && (
                <div style={{ position: 'absolute', zIndex: 40, left: 0, right: 0, top: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 6px 18px #0002', maxHeight: 220, overflowY: 'auto' }}>
                  {custMatches.map(c => (
                    <div
                      key={c.id}
                      onMouseDown={() => { setSelectedCust(c); setCustQuery(''); setCustOpen(false); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}
                    >
                      <strong>{c.name}</strong>{c.alpha_tag ? <span style={{ color: '#94a3b8', marginLeft: 6, fontSize: 11 }}>{c.alpha_tag}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">SO # (optional)</label>
          <input className="form-input" value={soNum} onChange={e => setSoNum(e.target.value)} placeholder="e.g. SO12345" />
        </div>

        <button className="btn btn-primary" disabled={!valid || submitting} onClick={doSubmit} style={{ width: '100%', justifyContent: 'center' }}>
          <Icon name="plus" size={14} /> {submitting ? 'Adding…' : 'Add to this week’s order'}
        </button>
      </div>
    </div>
  );
}

// ─── Queue tab ───

function QueueTab({ data, cu, cust, nf, refresh }) {
  const requests = data.requests || [];
  const queued = requests.filter(r => r.status === 'queued');
  const preview = data.preview;
  const requestsById = useMemo(() => {
    const m = {};
    requests.forEach(r => { m[r.id] = r; });
    return m;
  }, [requests]);

  const totalPrints = queued.reduce((a, r) => a + (r.qty || 0), 0);
  const [cancelConfirm, setCancelConfirm] = useState(null);
  const [batching, setBatching] = useState(false);

  const doCancel = async (id) => {
    const d = await callDtf('cancel_request', { id });
    if (d && d.ok) { nf('Design removed from queue'); refresh(); }
    else nf((d && d.error) || 'Failed to cancel', 'error');
    setCancelConfirm(null);
  };

  const doBatch = async () => {
    if (queued.length === 0) return;
    if (!window.confirm(`Batch all ${queued.length} queued design${queued.length === 1 ? '' : 's'} (${totalPrints} prints) into a gang sheet now?`)) return;
    let send = false;
    if (data.settings && data.settings.supplier_email) {
      send = window.confirm('Also email the supplier now with this batch?');
    }
    setBatching(true);
    const d = await callDtf('build_batch', { send });
    setBatching(false);
    if (d && d.ok) {
      if (d.send && d.send.sent) nf('Batch ' + (d.batch ? d.batch.batch_number : '') + ' created and sent to supplier');
      else if (send && d.send && !d.send.sent) nf('Batch created, but the email did not go out (' + (d.send.reason || 'send failed') + ') — send it from the Batches tab', 'warn');
      else nf('Batch ' + (d.batch ? d.batch.batch_number : '') + ' created');
      refresh();
    } else {
      nf((d && d.error) || 'Failed to build batch', 'error');
    }
  };

  const coveragePct = preview && preview.sheet_width_in && preview.sheet_length_in
    ? Math.round((100 * (preview.total_area_sqin || 0)) / (preview.sheet_width_in * preview.sheet_length_in))
    : null;

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <SubmitCard cust={cust} nf={nf} onSubmitted={refresh} defaultSheetWidth={data.settings && data.settings.sheet_width_in} />

      <div style={{ flex: '2 1 480px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <div className="card-header">
            <h2>This week's order — {queued.length} design{queued.length === 1 ? '' : 's'}, {totalPrints} print{totalPrints === 1 ? '' : 's'}</h2>
            {queued.length > 0 && (
              <button className="btn btn-primary btn-sm" disabled={batching} onClick={doBatch}>
                <Icon name="package" size={13} /> {batching ? 'Batching…' : 'Batch now'}
              </button>
            )}
          </div>
          <div className="card-body" style={{ padding: queued.length ? 0 : undefined }}>
            {queued.length === 0 ? (
              <div className="empty">No transfers queued — drop artwork to get started.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th></th><th>Design</th><th>Size</th><th>Qty</th><th></th><th>Submitted</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {queued.map(r => {
                      const thumb = r.preview_url || (r.file_url && _isImgUrl(r.file_url) ? r.file_url : null);
                      const cust1 = cust.find(c => c.id === r.customer_id);
                      return (
                        <tr key={r.id}>
                          <td style={{ width: 40 }}>
                            {thumb ? (
                              <img src={thumb} alt="" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4, border: '1px solid #e2e8f0', background: '#f8fafc' }} />
                            ) : (
                              <div style={{ width: 32, height: 32, borderRadius: 4, border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                                <Icon name="file" size={14} />
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>{r.design_name}</div>
                            {(cust1 || r.so_id) && (
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                {cust1 ? (cust1.alpha_tag || cust1.name) : ''}{cust1 && r.so_id ? ' · ' : ''}{r.so_id || ''}
                              </div>
                            )}
                          </td>
                          <td>{r.width_in}″ &times; {r.height_in}″</td>
                          <td>{r.qty}</td>
                          <td>{r.outline ? <span className="badge badge-purple">outline</span> : null}</td>
                          <td style={{ fontSize: 11, color: '#64748b' }}>{r.submitted_by || ''}{r.submitted_by ? ' · ' : ''}{timeAgo(r.created_at)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-sm btn-secondary" title="Cancel" onClick={() => setCancelConfirm(r)}>
                              <Icon name="x" size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {preview && preview.unplaced && preview.unplaced.length > 0 && (
          <div className="card" style={{ borderColor: '#fcd34d' }}>
            <div className="card-header"><h2 style={{ color: '#92400e' }}><Icon name="alert" size={14} /> Won't fit on sheet</h2></div>
            <div className="card-body">
              {preview.unplaced.map((u, i) => {
                const r = requestsById[u.request_id];
                return <div key={i} style={{ fontSize: 13, color: '#92400e', marginBottom: 4 }}>{r ? r.design_name : u.request_id} — {u.reason}</div>;
              })}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <h2>Gang-sheet preview</h2>
            {preview && (
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
                {preview.sheet_width_in}″ &times; {preview.sheet_length_in}″ &middot; {preview.total_prints} prints
                {coveragePct != null ? ` · ${coveragePct}% coverage` : ''}
              </span>
            )}
          </div>
          <div className="card-body">
            {preview ? <GangSheetSvg layout={preview} requestsById={requestsById} /> : <div className="empty">Queue is empty — nothing to lay out yet.</div>}
          </div>
        </div>
      </div>

      {cancelConfirm && (
        <div className="modal-overlay" onClick={() => setCancelConfirm(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Cancel design</h2><button className="modal-close" onClick={() => setCancelConfirm(null)}>&times;</button></div>
            <div className="modal-body">Remove "{cancelConfirm.design_name}" from this week's DTF order?</div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCancelConfirm(null)}>Keep it</button>
              <button className="btn btn-danger" onClick={() => doCancel(cancelConfirm.id)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Batches tab ───

function printBatchWindow(batch, layoutHtmlEl, lines) {
  const w = window.open('', '_blank');
  if (!w) return;
  const rows = lines.map(r => `<tr><td>${r.design_name}</td><td>${r.width_in}&quot; x ${r.height_in}&quot;</td><td>${r.qty}</td><td>${r.outline ? 'Yes' : ''}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><title>${batch.batch_number}</title><style>
    body{font-family:-apple-system,Segoe UI,sans-serif;padding:24px;color:#0f172a}
    h1{font-size:20px;margin-bottom:4px} .sub{color:#64748b;font-size:13px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}
    th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #e2e8f0}
    th{background:#f1f5f9}
  </style></head><body>
    <h1>DTF Batch ${batch.batch_number}</h1>
    <div class="sub">${batch.total_prints || 0} prints &middot; ${batch.sheet_width_in || ''}&quot; x ${batch.sheet_length_in || ''}&quot;</div>
    ${layoutHtmlEl}
    <table><thead><tr><th>Design</th><th>Size</th><th>Qty</th><th>Outline</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 400);
}

function svgToHtmlString(layout, requestsById) {
  // Build a standalone SVG string (matching GangSheetSvg's rendering) for the print window.
  if (!layout) return '';
  const w = layout.sheet_width_in, l = layout.sheet_length_in;
  const parts = (layout.placements || []).map(p => {
    const req = requestsById[p.request_id];
    const fill = pastelFor(p.request_id);
    const rx = p.rotated ? p.x : p.x, ry = p.rotated ? p.y : p.y;
    const rw = p.rotated ? p.h : p.w, rh = p.rotated ? p.w : p.h;
    const img = req && req.preview_url;
    const body = img
      ? `<image href="${img}" x="${rx + 0.05}" y="${ry + 0.05}" width="${rw - 0.1}" height="${rh - 0.1}" preserveAspectRatio="xMidYMid meet"/>`
      : `<text x="${rx + rw / 2}" y="${ry + rh / 2}" font-size="0.3" fill="#334155" text-anchor="middle" dominant-baseline="middle">${(req && req.design_name) || p.request_id}</text>`;
    return `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="0.1" fill="${fill}" stroke="#94a3b8" stroke-width="0.05"/>${body}`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${l}" style="width:100%;max-width:800px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">${parts}</svg>`;
}

function BatchDetail({ batch, requests, requestsById }) {
  const lines = requests.filter(r => r.batch_id === batch.id);
  return (
    <>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th></th><th>Design</th><th>Size</th><th>Qty</th><th></th></tr></thead>
          <tbody>
            {lines.map(r => {
              const thumb = r.preview_url || (r.file_url && _isImgUrl(r.file_url) ? r.file_url : null);
              return (
                <tr key={r.id}>
                  <td style={{ width: 40 }}>{thumb ? <img src={thumb} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4, border: '1px solid #e2e8f0' }} /> : null}</td>
                  <td>{r.design_name}</td>
                  <td>{r.width_in}″ &times; {r.height_in}″</td>
                  <td>{r.qty}</td>
                  <td>{r.outline ? <span className="badge badge-purple">outline</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <GangSheetSvg layout={batch.layout} requestsById={requestsById} maxHeight={360} />
      <div style={{ marginTop: 10 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => printBatchWindow(batch, svgToHtmlString(batch.layout, requestsById), lines)}>
          <Icon name="file" size={13} /> Print layout
        </button>
      </div>
    </>
  );
}

function BatchesTab({ data, nf, refresh }) {
  const batches = [...(data.batches || [])].sort((a, b) => new Date(b.built_at || 0) - new Date(a.built_at || 0));
  const requests = data.requests || [];
  const requestsById = useMemo(() => {
    const m = {};
    requests.forEach(r => { m[r.id] = r; });
    return m;
  }, [requests]);
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(null);

  const supplierEmailSet = !!(data.settings && data.settings.supplier_email);

  const staleSent = batches.some(b => b.status === 'sent' && b.sent_at && (Date.now() - new Date(b.sent_at).getTime()) > 7 * 24 * 3600 * 1000);

  const doSend = async (batch) => {
    setBusy(batch.id);
    const d = await callDtf('send_batch', { batch_id: batch.id });
    setBusy(null);
    if (d && d.ok) { nf('Batch ' + batch.batch_number + ' sent to supplier'); refresh(); }
    else nf((d && d.error) || 'Failed to send batch', 'error');
  };
  const doReceive = async (batch) => {
    setBusy(batch.id);
    const d = await callDtf('mark_received', { batch_id: batch.id });
    setBusy(null);
    if (d && d.ok) { nf('Batch ' + batch.batch_number + ' marked received'); refresh(); }
    else nf((d && d.error) || 'Failed to mark received', 'error');
  };

  return (
    <div>
      {staleSent && (
        <div style={{ padding: '10px 14px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, color: '#92400e', fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
          <Icon name="clock" size={13} /> Awaiting shipment from supplier
        </div>
      )}
      <div className="card">
        <div className="card-header"><h2>Batches</h2></div>
        <div className="card-body" style={{ padding: 0 }}>
          {batches.length === 0 ? (
            <div className="empty">No batches yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Batch</th><th>Built</th><th>Prints</th><th>Sheet</th><th>Status</th><th>Tracking</th><th></th></tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <React.Fragment key={b.id}>
                      <tr onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                        <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{b.batch_number}</td>
                        <td>{b.built_at ? new Date(b.built_at).toLocaleDateString() : ''}</td>
                        <td>{b.total_prints || 0}</td>
                        <td>{b.sheet_width_in ? `${b.sheet_width_in}″ × ${b.sheet_length_in}″` : '—'}</td>
                        <td><StatusBadge status={b.status} /></td>
                        <td>
                          {b.tracking_url ? (
                            <a href={b.tracking_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#2563eb', fontSize: 12 }}>
                              {b.carrier || 'Track'}{b.tracking_number ? ' ' + b.tracking_number : ''}
                            </a>
                          ) : b.tracking_number ? (
                            <span style={{ fontSize: 12 }}>{b.carrier ? b.carrier + ' ' : ''}{b.tracking_number}</span>
                          ) : '—'}
                        </td>
                        <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {b.status === 'draft' && (
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={!supplierEmailSet || busy === b.id}
                              title={!supplierEmailSet ? 'Set the supplier email in Settings first' : undefined}
                              onClick={() => doSend(b)}
                              style={{ marginRight: 6 }}
                            >{busy === b.id ? 'Sending…' : 'Send to supplier'}</button>
                          )}
                          {(b.status === 'sent' || b.status === 'shipped') && (
                            <button className="btn btn-sm btn-secondary" disabled={busy === b.id} onClick={() => doReceive(b)} style={{ marginRight: 6 }}>
                              {busy === b.id ? 'Saving…' : 'Mark received'}
                            </button>
                          )}
                          <button className="btn btn-sm btn-secondary" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                            {expanded === b.id ? 'Hide' : 'View'}
                          </button>
                        </td>
                      </tr>
                      {expanded === b.id && (
                        <tr>
                          <td colSpan={7} style={{ background: '#f8fafc', padding: 16 }}>
                            <BatchDetail batch={b} requests={requests} requestsById={requestsById} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Settings tab ───

function SettingsTab({ data, nf, refresh }) {
  const s = data.settings || {};
  const [form, setForm] = useState({
    supplier_name: s.supplier_name || '',
    supplier_email: s.supplier_email || '',
    cc_email: s.cc_email || '',
    notify_email: s.notify_email || '',
    sheet_width_in: s.sheet_width_in || '',
    margin_in: s.margin_in || '',
    spacing_in: s.spacing_in || '',
    auto_send: !!s.auto_send,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      supplier_name: s.supplier_name || '',
      supplier_email: s.supplier_email || '',
      cc_email: s.cc_email || '',
      notify_email: s.notify_email || '',
      sheet_width_in: s.sheet_width_in || '',
      margin_in: s.margin_in || '',
      spacing_in: s.spacing_in || '',
      auto_send: !!s.auto_send,
    });

  }, [s.supplier_name, s.supplier_email, s.cc_email, s.notify_email, s.sheet_width_in, s.margin_in, s.spacing_in, s.auto_send]);

  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  const doSave = async () => {
    setSaving(true);
    const payload = {
      ...form,
      sheet_width_in: form.sheet_width_in === '' ? null : parseFloat(form.sheet_width_in),
      margin_in: form.margin_in === '' ? null : parseFloat(form.margin_in),
      spacing_in: form.spacing_in === '' ? null : parseFloat(form.spacing_in),
    };
    const d = await callDtf('save_settings', payload);
    setSaving(false);
    if (d && d.ok) { nf('Settings saved'); refresh(); }
    else nf((d && d.error) || 'Failed to save settings', 'error');
  };

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div className="card" style={{ flex: '1 1 420px', minWidth: 320 }}>
        <div className="card-header"><h2>Supplier & sheet settings</h2></div>
        <div className="card-body">
          <div className="form-row form-row-2">
            <div className="form-group">
              <label className="form-label">Supplier name</label>
              <input className="form-input" value={form.supplier_name} onChange={e => set({ supplier_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Supplier email</label>
              <input className="form-input" type="email" value={form.supplier_email} onChange={e => set({ supplier_email: e.target.value })} />
            </div>
          </div>
          <div className="form-row form-row-2">
            <div className="form-group">
              <label className="form-label">CC email</label>
              <input className="form-input" type="email" value={form.cc_email} onChange={e => set({ cc_email: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Notify email <span style={{ fontWeight: 400, color: '#94a3b8' }}>(shipped notifications)</span></label>
              <input className="form-input" type="email" value={form.notify_email} onChange={e => set({ notify_email: e.target.value })} />
            </div>
          </div>
          <div className="form-row form-row-3">
            <div className="form-group">
              <label className="form-label">Sheet width (in)</label>
              <input className="form-input" type="number" step="0.1" value={form.sheet_width_in} onChange={e => set({ sheet_width_in: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Margin (in)</label>
              <input className="form-input" type="number" step="0.1" value={form.margin_in} onChange={e => set({ margin_in: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Spacing (in)</label>
              <input className="form-input" type="number" step="0.1" value={form.spacing_in} onChange={e => set({ spacing_in: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>
              <input type="checkbox" checked={form.auto_send} onChange={e => set({ auto_send: e.target.checked })} style={{ width: 15, height: 15 }} />
              Auto-send batches to supplier
            </label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              Automatically email the supplier when the Wednesday batch builds. When off, batches wait as drafts for review.
            </div>
          </div>
          <button className="btn btn-primary" disabled={saving} onClick={doSave}>
            <Icon name="save" size={14} /> {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      <div className="card" style={{ flex: '1 1 300px', minWidth: 280, alignSelf: 'flex-start' }}>
        <div className="card-header"><h2>How it works</h2></div>
        <div className="card-body" style={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            <li>Staff submit artwork all week — it queues into a shared gang sheet.</li>
            <li>Every Wednesday the queue automatically batches into one order.</li>
            <li>The batch is emailed to the supplier (immediately if auto-send is on, or after a staff review otherwise).</li>
            <li>The supplier marks the batch shipped with tracking from their portal link.</li>
            <li>Once transfers arrive, mark the batch received here.</li>
          </ol>
          {data.vendor_portal_configured === false && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, color: '#92400e', fontSize: 12, fontWeight: 600 }}>
              Supplier portal token not set — add VENDOR_DTF_TOKEN in Netlify env to enable the supplier's mark-shipped page.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── main component ───

export default function DtfOrders({ cu, cust, nf }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('queue');
  const isAdmin = cu && (cu.role === 'admin' || cu.role === 'super_admin');

  const refresh = async () => {
    const d = await callDtf('list');
    if (d && d.ok) {
      setData(d);
    } else {
      nf((d && d.error) || 'Failed to load DTF orders', 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();

  }, []);

  useEffect(() => {
    if (!isAdmin && tab === 'settings') setTab('queue');

  }, [isAdmin]);

  if (loading && !data) {
    return <div className="empty">Loading DTF orders…</div>;
  }

  if (data && data.enabled === false) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🧵</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>DTF Orders isn't set up yet</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>The DTF migration hasn't been applied to this database yet. Ask an admin to run it to enable weekly transfer batching.</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const requests = data.requests || [];
  const queued = requests.filter(r => r.status === 'queued');
  const totalPrints = queued.reduce((a, r) => a + (r.qty || 0), 0);
  const preview = data.preview;
  const batches = [...(data.batches || [])].sort((a, b) => new Date(b.built_at || 0) - new Date(a.built_at || 0));
  const lastBatch = batches[0];

  return (
    <div>
      <div className="stats-row">
        <StatTile label="Queued prints" value={totalPrints} sub={queued.length + ' design' + (queued.length === 1 ? '' : 's')} />
        <StatTile label="Est. sheet" value={preview ? `${preview.sheet_width_in}″ × ${preview.sheet_length_in}″` : '—'} />
        <StatTile label="Next auto batch" value={nextWednesday4pmLabel()} />
        <div className="stat-card" style={{ minWidth: 140 }}>
          <div className="stat-label">Last batch</div>
          {lastBatch ? (
            <>
              <div className="stat-value" style={{ fontSize: 16, fontFamily: 'monospace' }}>{lastBatch.batch_number}</div>
              <div style={{ marginTop: 2 }}><StatusBadge status={lastBatch.status} /></div>
            </>
          ) : (
            <div className="stat-value" style={{ fontSize: 16 }}>—</div>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>Queue{queued.length ? <span className="count">{queued.length}</span> : null}</button>
        <button className={`tab ${tab === 'batches' ? 'active' : ''}`} onClick={() => setTab('batches')}>Batches{batches.length ? <span className="count">{batches.length}</span> : null}</button>
        {isAdmin && <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Settings</button>}
      </div>

      {tab === 'queue' && <QueueTab data={data} cu={cu} cust={cust || []} nf={nf} refresh={refresh} />}
      {tab === 'batches' && <BatchesTab data={data} nf={nf} refresh={refresh} />}
      {tab === 'settings' && isAdmin && <SettingsTab data={data} nf={nf} refresh={refresh} />}
    </div>
  );
}
