import React, { useEffect, useRef, useState } from 'react';
import * as SHOWCASE from '../lib/showcaseSettings';

export default function ShowcaseImageReview({ item, busy, error, onClose, onAction }) {
  const dialog = useRef(null);
  const asset = item.asset || {};
  const [notes, setNotes] = useState(asset.showcase_settings?.revision_notes || '');
  const working = ['queued', 'generating'].includes(asset.status);
  const afterUrl = asset.showcase_image_url || asset.approved_showcase_image_url;
  const canApprove = asset.status === 'review' && !!asset.showcase_image_url && !asset.needs_regeneration;

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  const panel = (label, url, empty) => <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{label}</div>
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, aspectRatio: '1', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" title={`Open full-size ${label.toLowerCase()} image`} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
        <img src={url} alt={`${item.name} — ${label}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </a> : <span style={{ padding: 24, color: '#64748b', textAlign: 'center', fontSize: 13 }}>{empty}</span>}
    </div>
  </div>;

  return <dialog ref={dialog} aria-labelledby="showcase-review-title" onCancel={(event) => { event.preventDefault(); onClose(); }}
    style={{ width: 'min(1100px, 92vw)', maxHeight: '92vh', padding: 0, border: '1px solid #cbd5e1', borderRadius: 16, color: '#0f172a', boxShadow: '0 24px 80px rgba(15,23,42,.3)' }}>
    <div style={{ padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid #e2e8f0' }}>
      <div style={{ flex: 1 }}>
        <div id="showcase-review-title" style={{ fontSize: 17, fontWeight: 800 }}>{item.name} · Before / After</div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Check artwork, decoration texture, product color and hero angle. Click either image to inspect it at full size.</div>
      </div>
      <button type="button" className="btn btn-secondary" onClick={onClose} autoFocus aria-label="Close image comparison">Close</button>
    </div>
    <div style={{ padding: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))', gap: 16 }}>
        {panel('Before · Standard image', asset.standard_image_url || item.standard_image_url, 'Add a Standard product image first.')}
        {panel(asset.showcase_image_url ? 'After · New hero image' : 'After · Currently approved hero', afterUrl, working ? 'Your new hero image is generating…' : 'Generate a hero image to compare it here.')}
      </div>
      {asset.needs_regeneration && <p style={{ fontSize: 12, color: '#b45309' }}>Generate a new image to apply the saved decoration finish or review notes.</p>}
      {(error || asset.error_details) && <p role="alert" style={{ fontSize: 12, color: '#b91c1c' }}>{error || asset.error_details}</p>}
      {item.kind !== 'bundle' && <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, fontSize: 12, fontWeight: 700 }}>
        Hero decoration
        <select value={asset.showcase_settings?.decoration_type || 'auto'} disabled={busy || working}
          onChange={(event) => onAction('save_settings', { showcase_settings: { decoration_type: event.target.value, revision_notes: notes } })}
          style={{ font: 'inherit', border: '1px solid #cbd5e1', borderRadius: 6, padding: 6, background: '#fff' }}>
          {SHOWCASE.DECORATION_FINISHES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>}
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginTop: 16 }}>
        Changes for the next image (optional)
        <textarea value={notes} maxLength={1000} disabled={busy || working} onChange={(event) => setNotes(event.target.value)}
          placeholder="For example: lighter twill depth, cleaner stitching, stronger fabric lighting…"
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 66, marginTop: 6, border: '1px solid #cbd5e1', borderRadius: 8, padding: 10, font: 'inherit', fontWeight: 400 }} />
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {working ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onAction('cancel')}>Cancel generation</button>
          : <button type="button" className="btn btn-secondary" disabled={busy || !item.standard_image_url || item.kind === 'bundle'}
            onClick={() => onAction('generate', { showcase_settings: { decoration_type: asset.showcase_settings?.decoration_type || 'auto', revision_notes: notes } })}>Generate New Image</button>}
        {asset.status === 'review' && !!asset.showcase_image_url && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onAction('reject')}>Reject</button>}
        <button type="button" className="btn btn-primary" disabled={busy || !canApprove} onClick={() => onAction('approve')}>Approve Image</button>
      </div>
    </div>
  </dialog>;
}
