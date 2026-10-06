import React, { useState } from 'react';
import { logoDetailUrl } from './lib/logoDetail';
import { fileDisplayName, _isImgUrl, _isPdfUrl, _cloudinaryPdfThumb, openFile } from './utils';
import { cloudinaryPreviewUrl } from './lib/cloudinaryPreview';
import './PriorArtReviewPanel.css';

const urlOf = f => typeof f === 'string' ? f : f?.url || '';
const imageOf = f => {
  const url = urlOf(f);
  return _isImgUrl(url, f) ? url : _isPdfUrl(url, f) ? _cloudinaryPdfThumb(url) : '';
};
const artworkOf = art => {
  const ways = art?.color_ways || [];
  const logos = [art?.web_logo_url, ...(art?.web_logos || []).map(urlOf), ...ways.map(w => logoDetailUrl(art, w.id))].filter(Boolean);
  const files = [art?.preview_url, ...(art?.prod_files || []), ...(art?.files || [])].filter(Boolean);
  return [...logos, ...files].find(imageOf) || files[0] || null;
};

export default function PriorArtReviewPanel({ artFiles = [], garments = [], priorMocks = {}, accepted, mockReady, onConfirm, onRequestUpdate, onSendToCoach }) {
  const [showUpdate, setShowUpdate] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const art = artFiles[0];
  const proof = artworkOf(art);
  const proofUrl = urlOf(proof);
  const source = art?.reused_from_so;
  const key = (art?.name || '').trim().toLowerCase() + '||' + (art?.deco_type || '');
  const previousMock = (priorMocks[key] || []).flatMap(g => g.files || []).find(f => imageOf(f));
  const act = async fn => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return <section className="prior-art-review" aria-label="Previous art review">
    <div className="prior-art-steps" aria-label="Art setup steps">
      <span className={accepted ? 'done' : 'active'}>1 · Review previous art</span>
      <span className={accepted ? (mockReady ? 'done' : 'active') : ''}>2 · Set garment mock</span>
      <span className={accepted && mockReady ? 'active' : ''}>3 · Send to coach</span>
    </div>
    <div className="prior-art-layout">
      <div className="prior-art-reference">
        <div className="prior-art-eyebrow">Previous artwork {source ? '· ' + source : ''}</div>
        <h3>{art?.name || 'Artwork for this job'}</h3>
        <div className="prior-art-preview">
          {imageOf(proof) ? <button type="button" onClick={() => openFile(proofUrl)} aria-label="Open previous artwork"><img src={cloudinaryPreviewUrl(imageOf(proof), 900)} alt={art?.name || 'Previous artwork'} /></button>
            : <div className="prior-art-no-preview"><strong>Artwork file on record</strong><span>{proof ? fileDisplayName(proof) : 'No preview image attached'}</span>{proofUrl && <button type="button" onClick={() => openFile(proofUrl)}>Open artwork file ↗</button>}</div>}
        </div>
        {!!art?.color_ways?.length && <div className="prior-art-versions">{art.color_ways.map((w, i) => <span key={w.id || i}>{w.garment_color || w.name || 'Version ' + (i + 1)}{w.inks?.length ? ' · ' + w.inks.join(', ') : ''}</span>)}</div>}
        {previousMock && <div className="prior-art-old-mock"><img src={cloudinaryPreviewUrl(imageOf(previousMock), 160)} alt="Previous garment mock, reference only" /><span>Previous garment mock · reference only</span></div>}
      </div>
      <div className="prior-art-decision">
        <div className="prior-art-eyebrow">This job</div>
        <h3>{accepted ? 'Art selected for this job' : 'Does this art work for these garments?'}</h3>
        <div className="prior-art-garments">{garments.map((g, i) => <div key={g.item_idx ?? i}><strong>{g.name || g.sku}</strong><span>{[g.sku, g.color].filter(Boolean).join(' · ')}</span></div>)}</div>
        {!accepted ? <>
          <p>The previous design is here for review. Its garment mock and approval have not been applied to this job.</p>
          <div className="prior-art-actions"><button type="button" className="prior-art-primary" disabled={busy} onClick={() => act(onConfirm)}>Use this art</button><button type="button" className="prior-art-secondary" disabled={busy} onClick={() => setShowUpdate(v => !v)}>Request an update</button></div>
          {showUpdate && <div className="prior-art-update"><label htmlFor="prior-art-update-note">What needs to change?</label><textarea id="prior-art-update-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Colors, size, placement, or design changes…" rows={3} /><button type="button" disabled={busy || !note.trim()} onClick={() => act(() => onRequestUpdate(note.trim()))}>Continue to artist request</button></div>}
        </> : <>
          <p>{mockReady ? 'The garment mock is ready. Review it below, then send this proof to the coach.' : 'Choose or upload a mock for the garment below. The previous garment mock is reference only.'}</p>
          {mockReady && <button type="button" className="prior-art-primary" disabled={busy} onClick={onSendToCoach}>Send to Coach →</button>}
          <button type="button" className="prior-art-text-action" disabled={busy} onClick={() => setShowUpdate(v => !v)}>Need an art change instead?</button>
          {showUpdate && <div className="prior-art-update"><label htmlFor="prior-art-update-note">What needs to change?</label><textarea id="prior-art-update-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Colors, size, placement, or design changes…" rows={3} /><button type="button" disabled={busy || !note.trim()} onClick={() => act(() => onRequestUpdate(note.trim()))}>Continue to artist request</button></div>}
        </>}
      </div>
    </div>
  </section>;
}
