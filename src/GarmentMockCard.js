import React, { useRef, useState } from 'react';
import { fileDisplayName, _isImgUrl, _cloudinaryPdfThumb, openFile } from './utils';
import './GarmentMockCard.css';

const urlOf = f => typeof f === 'string' ? f : f?.url || '';

// One preview per slot. Selecting a candidate never changes approval or saves it.
export default function GarmentMockCard({ label, sub, mocks, candidates, suggest = false, busy, onUse, onRemove, onUpload, accept = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.ai,.eps,.svg' }) {
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
    <header><div><strong>{label || 'Garment mock'}</strong>{sub && <small>{sub}</small>}</div><span className={mocks.length ? 'mock-tag saved' : 'mock-tag'}>{mocks.length ? 'Mock saved' : 'Needs mock'}</span></header>
    <div className="mock-preview" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) onUpload(Array.from(e.dataTransfer.files)); }}>
      {file ? <button type="button" className="mock-open" onClick={() => openFile(url)} aria-label="Open full size mock">
        {thumb(file) ? <img src={thumb(file)} alt={fileDisplayName(file)} /> : <span className="mock-document">PDF / image<br /><small>{fileDisplayName(file)}</small></span>}
        <span className="mock-enlarge">Open full size ↗</span>
      </button> : <div className="mock-empty"><strong>Add a mock for this garment</strong><span>Use an image already attached, or upload one.</span><span>Drag and drop works here too.</span></div>}
    </div>
    {files.length > 1 && <div className="mock-thumbnails" aria-label="Choose an image">{files.map((f, i) => <button type="button" key={urlOf(f)} disabled={busy} aria-label={'Select image ' + (i + 1) + ': ' + fileDisplayName(f)} aria-pressed={urlOf(f) === url} onClick={() => setSelected(urlOf(f))}>{thumb(f) ? <img src={thumb(f)} alt="" /> : <span>PDF</span>}</button>)}</div>}
    <div className="mock-card-footer">
      {file && <div className="mock-file-name" title={fileDisplayName(file)}>{fileDisplayName(file)}</div>}
      {file && choosingExisting && <p>Check the garment, color and placement, then use this mock.</p>}
      {error && <p role="alert" className="mock-error">{error}</p>}
      <div className="mock-actions">
        {file && choosingExisting && <button type="button" className="mock-primary" disabled={busy} onClick={() => run(() => onUse(file))}>{busy ? 'Saving…' : 'Use this mock'}</button>}
        {!choosing && candidates.length > 0 && !(suggest && !mocks.length) && <button type="button" disabled={busy} onClick={() => { setChoosing(true); setSelected(''); }}>Use existing image</button>}
        <button type="button" disabled={busy} onClick={() => input.current.click()}>Upload</button>
        {choosing && <button type="button" disabled={busy} onClick={() => { setChoosing(false); setSelected(''); }}>Cancel</button>}
        {file && !choosingExisting && <button type="button" className="mock-remove" disabled={busy} onClick={() => { if (window.confirm('Remove this mock from this garment slot?')) run(() => onRemove(url)); }}>Remove</button>}
      </div>
      <input ref={input} type="file" hidden multiple accept={accept} onChange={e => { if (e.target.files.length) run(() => onUpload(Array.from(e.target.files))); e.target.value = ''; }} />
    </div>
  </section>;
}
