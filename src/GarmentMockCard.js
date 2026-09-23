import React, { useRef, useState } from 'react';
import { fileDisplayName, _isImgUrl, _cloudinaryPdfThumb, openFile } from './utils';
import './GarmentMockCard.css';

const urlOf = f => typeof f === 'string' ? f : f?.url || '';

// One preview per slot. Selecting a candidate never changes approval or saves it.
// The logo detail pane: the design's transparent logo PNG painted on the garment color, so the
// close-up reads the way it will print. `logo` = { url, bg, colorName, onUpload, onRemove };
// without onUpload it is read-only.
function LogoDetailPane({ logo, busy }) {
  const input = useRef(null);
  const [error, setError] = useState('');
  const run = async fn => {
    setError('');
    try { const ok = await fn(); if (ok === false) setError('Could not save the logo detail. Please try again.'); }
    catch (e) { setError(e.message || 'Could not save the logo detail. Please try again.'); }
  };
  const upload = files => {
    if (!files.length || !logo.onUpload) return;
    if (files.some(f => !/\.(png|webp|svg)$/i.test(f.name))) { setError('Use a PNG with a transparent background.'); return; }
    run(() => logo.onUpload(files.slice(0, 1)));
  };
  return <div className="logo-detail">
    <div className="logo-detail-head"><strong>Logo detail</strong>{logo.colorName && <small>on {logo.colorName}</small>}</div>
    <div className="logo-detail-swatch" style={{ background: logo.bg || '#e5e7eb' }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) upload(Array.from(e.dataTransfer.files)); }}>
      {logo.url ? <button type="button" className="logo-detail-open" onClick={() => openFile(logo.url)} aria-label="Open full size logo detail"><img src={logo.url} alt="Logo detail" /></button>
        : <span className="logo-detail-empty">{logo.onUpload ? 'Add the logo as a transparent PNG' : 'No logo detail yet'}</span>}
    </div>
    {error && <p role="alert" className="mock-error">{error}</p>}
    {logo.onUpload && <div className="logo-detail-actions">
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
  return <section className="garment-mock-card" aria-label={label + ' mock'} aria-busy={busy}>
    <header><div><strong>{label || 'Garment mock'}</strong>{sub && <small>{sub}</small>}</div><span className={mocks.length && !(logo && !logo.url) ? 'mock-tag saved' : 'mock-tag'}>{!mocks.length ? 'Needs mock' : logo && !logo.url ? 'Needs logo detail' : 'Mock saved'}</span></header>
    <div className={logo ? 'mock-body with-logo' : 'mock-body'}>
    <div className="mock-preview" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) onUpload(Array.from(e.dataTransfer.files)); }}>
      {file ? <button type="button" className="mock-open" onClick={() => openFile(url)} aria-label="Open full size mock">
        {thumb(file) ? <img src={thumb(file)} alt={fileDisplayName(file)} /> : <span className="mock-document">PDF / image<br /><small>{fileDisplayName(file)}</small></span>}
        <span className="mock-enlarge">Open full size ↗</span>
      </button> : <div className="mock-empty"><strong>Add a mock for this garment</strong><span>Use an image already attached, or upload one.</span><span>Drag and drop works here too.</span></div>}
    </div>
    {logo && <LogoDetailPane logo={logo} busy={busy} />}
    </div>
    {files.length > 1 && <div className="mock-thumbnails" aria-label="Choose an image">{files.map((f, i) => <button type="button" key={urlOf(f)} disabled={busy} aria-label={'Select image ' + (i + 1) + ': ' + fileDisplayName(f)} aria-pressed={urlOf(f) === url} onClick={() => setSelected(urlOf(f))}>{thumb(f) ? <img src={thumb(f)} alt="" /> : <span>PDF</span>}</button>)}</div>}
    <div className="mock-card-footer">
      {file && <div className="mock-file-name" title={fileDisplayName(file)}>{fileDisplayName(file)}</div>}
      {file && choosingExisting && <p>Check the garment, color and placement, then use this mock.</p>}
      {file && choosingExisting && file.requires_mock_review && <p>From {file.source_art_name}. Confirm this image also matches the artwork for this job.</p>}
      {error && <p role="alert" className="mock-error">{error}</p>}
      <div className="mock-actions">
        {file && choosingExisting && <button type="button" className="mock-primary" disabled={busy} onClick={() => run(() => onUse(file))}>{busy ? 'Saving…' : 'Use this mock'}</button>}
        {!choosing && candidates.length > 0 && !(suggest && !mocks.length) && <button type="button" disabled={busy} onClick={() => { setChoosing(true); setSelected(''); }}>Use existing image</button>}
        <button type="button" disabled={busy} onClick={() => input.current.click()}>{uploadLabel}</button>
        {choosing && <button type="button" disabled={busy} onClick={() => { setChoosing(false); setSelected(''); }}>Cancel</button>}
        {file && !choosingExisting && <button type="button" className="mock-remove" disabled={busy} onClick={() => { if (window.confirm('Remove this mock from this garment slot?')) run(() => onRemove(url)); }}>Remove</button>}
      </div>
      <input ref={input} type="file" hidden multiple accept={accept} onChange={e => { if (e.target.files.length) run(() => onUpload(Array.from(e.target.files))); e.target.value = ''; }} />
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
