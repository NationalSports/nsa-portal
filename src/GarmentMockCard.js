import React, { useRef, useState } from 'react';
import { fileDisplayName, _isImgUrl, _cloudinaryPdfThumb, openFile } from './utils';
import './GarmentMockCard.css';

const urlOf = f => typeof f === 'string' ? f : f?.url || '';

// One preview per slot. Selecting a candidate never changes approval or saves it.
// Artist-facing rules for the logo detail, behind the "?" next to its label.
const LOGO_HELP = [
  'The logo on its own, exactly as this color way prints: the real ink / thread colors, no garment, no mockup.',
  'Export a PNG with a TRANSPARENT background (not white or black). We paint the garment color behind it.',
  'One logo per color way. A white-ink version and a navy-ink version are two separate uploads.',
  'Front and back designs each have their own card — upload a logo detail on each.',
  'Shown to the coach, on the production sheet and used as the webstore logo. Required before Send for approval.',
];

// Does this image have any see-through pixels? A PNG exported with a solid white box would sit on
// the garment color as a white rectangle. Returns true when it can't tell (SVG, no canvas).
async function hasTransparency(file) {
  if (!/\.(png|webp)$/i.test(file.name) || typeof document === 'undefined') return true;
  let url = '';
  try {
    url = URL.createObjectURL(file);
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const w = Math.max(1, Math.min(img.naturalWidth, 300));
    const h = Math.max(1, Math.round(img.naturalHeight * w / (img.naturalWidth || 1)));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return true;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  } catch (e) { return true; }
  finally { if (url) URL.revokeObjectURL(url); }
}

// The logo detail panel: the design's transparent logo PNG painted on the garment color, so the
// close-up reads the way it will print. `logo` = { url, bg, colorName, onUpload, onRemove };
// without onUpload it is read-only.
function LogoDetailPane({ logo, busy }) {
  const input = useRef(null);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [drag, setDrag] = useState(false);
  const run = async fn => {
    setError('');
    try { const ok = await fn(); if (ok === false) setError('Could not save the logo detail. Please try again.'); }
    catch (e) { setError(e.message || 'Could not save the logo detail. Please try again.'); }
  };
  const upload = async files => {
    if (!files.length || !logo.onUpload) return;
    const f = files[0];
    if (!/\.(png|webp|svg)$/i.test(f.name)) { setError('Logo detail must be a PNG with a transparent background — not a JPG or PDF.'); return; }
    if (!(await hasTransparency(f))) { setError('This PNG has a solid background. Re-export it with a transparent background so it sits on the garment color.'); return; }
    run(() => logo.onUpload([f]));
  };
  const drop = logo.onUpload ? {
    onDragOver: e => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: e => { e.preventDefault(); setDrag(false); if (!busy) upload(Array.from(e.dataTransfer.files)); },
  } : {};
  return <div className="mock-panel">
    <div className="panel-label">
      <span>Logo detail</span>
      <button type="button" className="help-btn" aria-expanded={help} aria-label="What is a logo detail?" onClick={() => setHelp(h => !h)}>?</button>
    </div>
    {help && <div className="logo-help" role="note"><ul>{LOGO_HELP.map(t => <li key={t}>{t}</li>)}</ul></div>}
    <div className={'panel-frame logo-frame' + (drag ? ' dragging' : '')} style={{ background: logo.bg || '#e5e7eb' }} {...drop}>
      {logo.url ? <button type="button" className="frame-open" onClick={() => openFile(logo.url)} aria-label="Open full size logo detail"><img src={logo.url} alt="Logo detail" /></button>
        : <span className="logo-empty">{logo.onUpload ? <>Drop the transparent logo PNG here<br /><small>or use Upload logo PNG</small></> : 'No logo detail yet'}</span>}
    </div>
    <div className="panel-meta">{logo.colorName ? 'Shown on ' + logo.colorName : 'Shown on the garment color'}</div>
    {error && <p role="alert" className="mock-error">{error}</p>}
    {logo.onUpload && <div className="panel-actions">
      <button type="button" disabled={busy} onClick={() => input.current.click()}>{logo.url ? 'Replace logo' : 'Upload logo PNG'}</button>
      {logo.url && logo.onRemove && <button type="button" className="mock-remove" disabled={busy} onClick={() => { if (window.confirm('Remove this logo detail?')) run(() => logo.onRemove(logo.url)); }}>Remove</button>}
      <input ref={input} type="file" hidden accept=".png,.webp,.svg" onChange={e => { upload(Array.from(e.target.files)); e.target.value = ''; }} />
    </div>}
  </div>;
}

export default function GarmentMockCard({ label, sub, mocks, candidates, suggest = false, busy, onUse, onRemove, onUpload, uploadLabel = 'Upload', accept = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.ai,.eps,.svg', logo = null, children = null }) {
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const choosingExisting = choosing || mocks.length === 0;
  const pool = choosingExisting ? candidates : mocks;
  const showCandidate = choosing || (suggest && mocks.length === 0);
  const files = choosingExisting && !showCandidate ? [] : pool;
  const file = files.find(f => urlOf(f) === selected) || files[0];
  const url = urlOf(file);
  const thumb = f => _isImgUrl(urlOf(f)) ? urlOf(f) : _cloudinaryPdfThumb(urlOf(f));
  const run = async fn => {
    setError('');
    try { const ok = await fn(); if (ok !== false) { setChoosing(false); setSelected(''); } else { setError('Could not save this mock. Please try again.'); } }
    catch (e) { setError('Could not save this mock. Please try again.'); }
  };
  const status = !mocks.length ? 'Needs mock' : logo && !logo.url ? 'Needs logo detail' : 'Mock saved';
  return <section className="garment-mock-card" aria-label={label + ' mock'} aria-busy={busy}>
    <header><div><strong>{label || 'Garment mock'}</strong>{sub && <small>{sub}</small>}</div><span className={status === 'Mock saved' ? 'mock-tag saved' : 'mock-tag'}>{status}</span></header>
    <div className={logo ? 'mock-panels two' : 'mock-panels'}>
      <div className="mock-panel">
        {logo && <div className="panel-label"><span>On the garment</span></div>}
        <div className={'panel-frame mock-preview' + (drag ? ' dragging' : '')} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) onUpload(Array.from(e.dataTransfer.files)); }}>
          {file ? <button type="button" className="frame-open mock-open" onClick={() => openFile(url)} aria-label="Open full size mock">
            {thumb(file) ? <img src={thumb(file)} alt={fileDisplayName(file)} /> : <span className="mock-document">PDF / image<br /><small>{fileDisplayName(file)}</small></span>}
            <span className="mock-enlarge">Open full size ↗</span>
          </button> : <div className="mock-empty"><strong>Add a mock for this garment</strong><span>Use an image already attached, or upload one.</span><span>Drag and drop works here too.</span></div>}
        </div>
        {files.length > 1 && <div className="mock-thumbnails" aria-label="Choose an image">{files.map((f, i) => <button type="button" key={urlOf(f)} disabled={busy} aria-label={'Select image ' + (i + 1) + ': ' + fileDisplayName(f)} aria-pressed={urlOf(f) === url} onClick={() => setSelected(urlOf(f))}>{thumb(f) ? <img src={thumb(f)} alt="" /> : <span>PDF</span>}</button>)}</div>}
        <div className="panel-meta" title={file ? fileDisplayName(file) : ''}>{file ? fileDisplayName(file) : 'No mock yet'}</div>
        {file && choosingExisting && <p className="panel-hint">Check the garment, color and placement, then use this mock.</p>}
        {file && choosingExisting && file.requires_mock_review && <p className="panel-hint">From {file.source_art_name}. Confirm this image also matches the artwork for this job.</p>}
        {error && <p role="alert" className="mock-error">{error}</p>}
        <div className="panel-actions">
          {file && choosingExisting && <button type="button" className="mock-primary" disabled={busy} onClick={() => run(() => onUse(file))}>{busy ? 'Saving…' : 'Use this mock'}</button>}
          {!choosing && candidates.length > 0 && !(suggest && !mocks.length) && <button type="button" disabled={busy} onClick={() => { setChoosing(true); setSelected(''); }}>Use existing image</button>}
          <button type="button" disabled={busy} onClick={() => input.current.click()}>{uploadLabel}</button>
          {choosing && <button type="button" disabled={busy} onClick={() => { setChoosing(false); setSelected(''); }}>Cancel</button>}
          {file && !choosingExisting && <button type="button" className="mock-remove" disabled={busy} onClick={() => { if (window.confirm('Remove this mock from this garment slot?')) run(() => onRemove(url)); }}>Remove</button>}
          <input ref={input} type="file" hidden multiple accept={accept} onChange={e => { if (e.target.files.length) run(() => onUpload(Array.from(e.target.files))); e.target.value = ''; }} />
        </div>
      </div>
      {logo && <LogoDetailPane logo={logo} busy={busy} />}
    </div>
    {children}
  </section>;
}

const SIZE_ORDER = ['YXS', 'YS', 'YM', 'YL', 'YXL', 'XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL', '6XL', 'OSFA'];
const _sizeRank = s => { const i = SIZE_ORDER.indexOf(String(s).toUpperCase()); return i < 0 ? SIZE_ORDER.length : i; };

// The garments one shared mock covers, with each garment's size quantities and a combined total.
// rows = [{ key, label, sizes: { M: 2, ... } }]
export function MockCoversTable({ rows }) {
  const list = (rows || []).filter(Boolean);
  if (list.length < 2) return null;
  const qty = v => Number(v) || 0;
  const sizes = [...new Set(list.flatMap(r => Object.keys(r.sizes || {}).filter(sz => qty(r.sizes[sz]) > 0)))]
    .sort((a, b) => _sizeRank(a) - _sizeRank(b));
  const total = r => sizes.reduce((n, sz) => n + qty(r.sizes?.[sz]), 0);
  return <div className="mock-covers">
    <h5>🔗 This mock covers {list.length} garments</h5>
    <div style={{ overflowX: 'auto' }}><table>
      <thead><tr><th>Garment</th>{sizes.map(sz => <th key={sz}>{sz}</th>)}<th>Total</th></tr></thead>
      <tbody>
        {list.map(r => <tr key={r.key}><td>{r.label}</td>{sizes.map(sz => <td key={sz} className={qty(r.sizes?.[sz]) ? 'qty' : 'zero'}>{qty(r.sizes?.[sz]) || '—'}</td>)}<td className="qty">{total(r)}</td></tr>)}
        <tr className="total"><td>All garments</td>{sizes.map(sz => <td key={sz}>{list.reduce((n, r) => n + qty(r.sizes?.[sz]), 0) || '—'}</td>)}<td>{list.reduce((n, r) => n + total(r), 0)}</td></tr>
      </tbody>
    </table></div>
  </div>;
}
