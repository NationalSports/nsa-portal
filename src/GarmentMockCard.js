import React, { useEffect, useRef, useState } from 'react';
import { fileDisplayName, _isImgUrl, _cloudinaryPdfThumb, openFile } from './utils';
import { sizeProgressCell } from './JobGarmentProgress';
import { cloudinaryPreviewUrl } from './lib/cloudinaryPreview';
import './GarmentMockCard.css';

const urlOf = f => typeof f === 'string' ? f : f?.url || '';

// One preview per slot. Selecting a candidate never changes approval or saves it.
// Artist-facing rules for the logo detail, behind the "?" next to its label.
const LOGO_HELP = [
  'The logo on its own, exactly as this color way prints: the real ink / thread colors, no garment, no mockup.',
  'Export a PNG with a TRANSPARENT background (not white or black). We paint the garment color behind it.',
  'One logo per color way. A white-ink version and a navy-ink version are two separate uploads.',
  'Front and back designs each have their own card — upload a logo detail on each.',
  'Artist: required before Send to Rep for Approval. Reps can still send the garment mock to the coach.',
  'Saving changes this job. You will be asked before updating reusable Art Library artwork.',
];

// Does this image have any see-through pixels? A PNG exported with a solid white box would sit on
// the garment color as a white rectangle. Returns true when it can't tell (SVG, no canvas).
async function hasTransparency(file) {
  if (typeof document === 'undefined') return false;
  let url = '';
  try {
    url = URL.createObjectURL(file);
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, 300 / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let transparent=false, visible=false;
    for (let i = 3; i < d.length; i += 4) { if(d[i]<250)transparent=true; if(d[i]>128)visible=true; }
    return transparent && visible;
  } catch (e) { throw new Error('Could not read this PNG. Export it again and retry.'); }
  finally { if (url) URL.revokeObjectURL(url); }
}

// Read an image's pixels (downscaled). Resolves null when it can't be read (no canvas, or the
// host blocks cross-origin reads) — callers then keep their default.
function readPixels(url, max = 120) {
  return new Promise(resolve => {
    if (!url || typeof document === 'undefined') return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = Math.max(1, Math.min(img.naturalWidth, max));
        const h = Math.max(1, Math.round(img.naturalHeight * w / (img.naturalWidth || 1)));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(ctx.getImageData(0, 0, w, h).data);
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
const _lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
// Does a real share of this logo print white/near-white (white text, outlines)? Those parts
// disappear on a light background even when most of the logo is colored.
async function logoHasWhite(url) {
  const d = await readPixels(url);
  if (!d) return null;
  let white = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { n++; if (_lum(d[i], d[i + 1], d[i + 2]) > 225) white++; }
  return n ? white / n > 0.05 : null;
}
const _hexLum = hex => { const m = String(hex || '').replace('#', '').match(/.{2}/g); if (!m || m.length < 3) return 128; const [r, g, b] = m.map(x => parseInt(x, 16)); return 0.299 * r + 0.587 * g + 0.114 * b; };

// Why a file can't be a logo detail, or '' when it can.
export async function logoFileProblem(f) {
  if (!/\.png$/i.test(f.name) || (f.type && f.type !== 'image/png')) return 'Logo detail must be a PNG with a transparent background — not a JPG, PDF, SVG or WebP.';
  if (f.size > 10 * 1024 * 1024) return 'Choose a PNG smaller than 10 MB.';
  try { if (!(await hasTransparency(f))) return 'Transparency could not be verified. Re-export this PNG with a transparent background and retry.'; }
  catch (e) { return e.message; }
  return '';
}

// Production files can contain print separations or opaque proofs, so verify an existing PNG
// before making it the customer-visible logo detail. A blocked image read is not evidence of
// transparency.
export async function logoUrlProblem(file) {
  if (!/\.png(?:[?#]|$)/i.test(file?.name || '') && !/\.png(?:[?#]|$)/i.test(file?.url || '')) return 'Choose a PNG production file for the logo detail.';
  const pixels = await readPixels(file.url, 300);
  if (!pixels) return 'Could not verify transparency in this PNG. Upload the original in Logo Detail instead.';
  let transparent = false, visible = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 250) transparent = true;
    if (pixels[i] > 128) visible = true;
  }
  return transparent && visible ? '' : 'This PNG does not have a transparent background. Upload a transparent logo PNG instead.';
}

// Small logo-detail tiles, one per garment color a shared mock covers. A tile whose color way has
// no logo detail yet can be uploaded right here (its garment has no card of its own).
// tiles = [{ key, url, bg, label, onUpload? }]
export function LogoDetailTiles({ tiles, title = 'Logo detail on each garment color' }) {
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [colorWays, setColorWays] = useState({});
  if (!tiles || !tiles.length) return null;
  const upload = async (t, files) => {
    if (!files.length || !t.onUpload) return;
    const bad = await logoFileProblem(files[0]);
    if (bad) { setError(bad); return; }
    setError(''); setBusyKey(t.key);
    try { if ((await t.onUpload([files[0]])) === false) setError('Could not save the logo detail. Please try again.'); }
    catch (e) { setError(e.message || 'Could not save the logo detail. Please try again.'); }
    finally { setBusyKey(''); }
  };
  return <div className="mock-covers" aria-label={title}>
    <h5>{title}</h5>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{tiles.map(t => <div key={t.key} style={{ width: 170, textAlign: 'center' }}>
      <div style={{ height: 90, borderRadius: 8, border: '1px solid #dbe2ea', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
        {t.url ? <img src={t.url} alt="" onClick={() => openFile(t.url)} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'zoom-in' }} />
        : t.needsColorWay ? <span style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', borderRadius: 6, padding: 6, fontWeight: 700 }}>Choose artwork color way first</span>
        : t.onUpload ? <label className="tile-upload">{busyKey === t.key ? 'Saving…' : 'Upload logo PNG'}<input type="file" hidden accept=".png" disabled={!!busyKey} onChange={e => { upload(t, Array.from(e.target.files)); e.target.value = ''; }} /></label>
          : <span className="tile-upload">Needs logo detail</span>}
      </div>
      <div style={{ fontSize: 10.5, color: '#475569', marginTop: 4 }}>{t.label}</div>
      {t.needsColorWay && <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
        <select aria-label={'Artwork color way for ' + t.label} value={colorWays[t.key] || ''} disabled={!!busyKey} onChange={e => setColorWays(v => ({ ...v, [t.key]: e.target.value }))} style={{ width: '100%', fontSize: 11 }}>
          <option value="">Choose color way…</option>
          {(t.colorWays || []).map(c => <option key={c.id} value={c.id}>{c.label}{c.colors ? ' — ' + c.colors : ''}</option>)}
        </select>
        <button type="button" disabled={!!busyKey || !colorWays[t.key]} onClick={async () => {
          setError(''); setBusyKey(t.key);
          try { if (await t.onChooseColorWay(colorWays[t.key]) !== true) setError('Could not save the artwork color way. Please try again.'); }
          catch (e) { setError(e.message || 'Could not save the artwork color way. Please try again.'); }
          finally { setBusyKey(''); }
        }}>{busyKey === t.key ? 'Saving…' : 'Save color way'}</button>
      </div>}
    </div>)}</div>
    {error && <p role="alert" className="mock-error" style={{ marginTop: 6 }}>{error}</p>}
  </div>;
}

// The logo detail panel: the design's transparent logo PNG painted on the garment color, so the
// close-up reads the way it will print. `logo` = { url, bg, colorName, onUpload, onRemove };
// without onUpload it is read-only.
function LogoDetailPane({ logo: sourceLogo, busy: parentBusy }) {
  const [saving, setSaving] = useState(false);
  const uploadLock = useRef(false);
  const busy = parentBusy || saving;
  const [selectedColorWay, setSelectedColorWay] = useState('');
  const [editingVersion, setEditingVersion] = useState(false);
  const [assignmentUnconfirmed, setAssignmentUnconfirmed] = useState(false);
  const [allGarments, setAllGarments] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [versionColors, setVersionColors] = useState('');
  const newVersionId = useRef(null);
  const choosingVersion = sourceLogo.needsColorWay || editingVersion || assignmentUnconfirmed;
  const selected = sourceLogo.colorWays?.find(c => c.id === selectedColorWay);
  // A dropdown selection is only a draft. Never upload against an unpersisted assignment.
  const logo = sourceLogo;
  const assigned = sourceLogo.colorWays?.find(c => c.id === sourceLogo.colorWayId);
  const input = useRef(null);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [drag, setDrag] = useState(false);
  const [bgMode, setBgMode] = useState(null);
  const [hasWhite, setHasWhite] = useState(null);
  const assign = async () => {
    if (!sourceLogo.onAssign || busy || uploadLock.current) return;
    if (allGarments && !window.confirm('Use this same artwork version for all garments using this artwork on this order? If another garment already uses a different version, nothing is changed. Reversible sides remain separate.')) return;
    uploadLock.current = true; setSaving(true); setAssignmentUnconfirmed(true); setError('');
    try {
      const ok = await sourceLogo.onAssign({ colorWayId: selectedColorWay, allGarments,
        ...(selectedColorWay === '__new' ? { newVersion: { id: newVersionId.current || (newVersionId.current = 'cw' + crypto.randomUUID()), label: versionName, inks: versionColors.split(',') } } : {}) });
      if (ok !== true) { setError('Artwork assignment was not saved. Retry before uploading.'); return; }
      setAssignmentUnconfirmed(false); setEditingVersion(false); setSelectedColorWay(''); setAllGarments(false); setVersionName(''); setVersionColors('');
      newVersionId.current = null;
    } catch (e) { setError(e.message || 'Could not save the artwork assignment.'); }
    finally { uploadLock.current = false; setSaving(false); }
  };
  useEffect(() => { let live = true; setHasWhite(null); logoHasWhite(logo.url).then(v => { if (live) setHasWhite(v); }); return () => { live = false; }; }, [logo.url]);
  // A shared mock can depict a different garment. Its pixels and artwork-version label
  // must never override the actual garment color (or disguise an unknown one).
  const fromGarment = logo.bgSource ? logo.bgSource === 'garment' : logo.bgKnown !== false;
  const bg = logo.bg || '#94a3b8';
  const bgName = fromGarment ? logo.colorName || 'Garment' : 'Neutral preview';
  const bgNote = fromGarment ? (logo.colorName ? 'Shown on ' + logo.colorName : 'Shown on the garment color')
    : 'Garment color ' + (logo.colorName ? '(' + logo.colorName + ') ' : '') + 'not recognized — neutral preview, not the garment color';
  // The detail shows how the logo PRINTS, so it stays on the garment color even when that hides
  // white ink — and says so, because white ink on a light garment is worth a second look.
  const mode = bgMode || 'garment';
  const whiteWarning = fromGarment && mode === 'garment' && hasWhite === true && _hexLum(bg) > 200;
  const run = async fn => {
    setError('');
    try { const ok = await fn(); if (ok === false) setError('Could not save the logo detail. Please try again.'); }
    catch (e) { setError(e.message || 'Could not save the logo detail. Please try again.'); }
  };
  const useProductionPng = async file => {
    if (busy || uploadLock.current) return;
    uploadLock.current = true; setSaving(true); setError('');
    try {
      const bad = await logoUrlProblem(file);
      if (bad) { setError(bad); return; }
      if (await logo.onUseProductionPng(file) === false) setError('Could not save the logo detail. Please try again.');
    } catch (e) { setError(e.message || 'Could not save the logo detail. Please try again.'); }
    finally { uploadLock.current = false; setSaving(false); }
  };
  const upload = async files => {
    if (!files.length || !logo.onUpload || busy || uploadLock.current) return;
    if (choosingVersion) { setError('Save the artwork choice before uploading the logo PNG.'); return; }
    if (logo.needsColorWay) { setError('Choose a color way below before uploading the logo PNG.'); return; }
    uploadLock.current = true; setSaving(true);
    try {
      const f = files[0];
      const bad = await logoFileProblem(f);
      if (bad) { setError(bad); return; }
      await run(() => logo.onUpload([f]));
    } finally { uploadLock.current = false; setSaving(false); }
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
    <div className={'panel-frame logo-frame bg-' + mode + (drag ? ' dragging' : '')} style={mode === 'garment' ? { background: bg } : undefined} {...drop}>
      {logo.url ? <button type="button" className="frame-open" onClick={() => openFile(logo.url)} aria-label="Open full size logo detail"><img src={logo.url} alt="Logo detail" /></button>
        : <span className="logo-empty">{logo.blockedReason ? 'Decoration missing on the sales order' : logo.needsColorWay ? 'Choose and save an artwork version below' : logo.onUpload ? <>Drop the transparent logo PNG here<br /><small>or use Upload logo PNG</small></> : 'No logo detail yet'}</span>}
    </div>
    {logo.url && <div className="bg-switch" role="group" aria-label="Logo background">
      {[['garment', bgName], ['checker', 'Checkered'], ['dark', 'Dark']].map(([k, lbl]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setBgMode(k)}>{lbl}</button>)}
    </div>}
    <div className="panel-meta">{mode === 'garment' ? bgNote : mode === 'checker' ? 'Checkered = transparent areas' : 'Shown on dark'}</div>
    {whiteWarning && <p className="logo-warning">White parts of this logo won't show on {bgName === 'Mock color' ? 'this garment' : bgName}. Check the color way — use Dark to see them.</p>}
    {error && <p role="alert" className="mock-error">{error}</p>}
    {sourceLogo.onAssign && choosingVersion && <div className="artwork-version-picker">
      <label>Artwork version
        <select aria-label="Artwork version" value={selectedColorWay} disabled={busy} onChange={e => { setSelectedColorWay(e.target.value); setError(''); }}>
          <option value="">Choose artwork…</option>
          {(sourceLogo.colorWays || []).map(c => <option key={c.id} value={c.id}>{c.label}{c.colors ? ' — ' + c.colors : ''}</option>)}
          <option value="__new">Add a different artwork version…</option>
        </select>
      </label>
      <p className="panel-hint">This is the artwork version name, not the garment color. The same artwork can be used on different garment colors.</p>
      {selected && <p className="panel-hint">Ink / thread colors: {selected.colors || 'Not specified — check the artwork.'}</p>}
      {selectedColorWay === '__new' && <>
        <label>Version name<input aria-label="Artwork version name" value={versionName} disabled={busy} onChange={e => setVersionName(e.target.value)} placeholder="e.g. Full-color Bulldog" /></label>
        <label>Ink / thread colors<input aria-label="Artwork version colors" value={versionColors} disabled={busy} onChange={e => setVersionColors(e.target.value)} placeholder="e.g. Royal, White, Grey, Black" /></label>
        <p className="panel-hint">Creates a separate version on this order. Existing logos and production files are not copied to it.</p>
      </>}
      <label className="artwork-version-shared"><input type="checkbox" checked={allGarments} disabled={busy} onChange={e => setAllGarments(e.target.checked)} />Same artwork for all garments using this design on this order{sourceLogo.side ? ' (Side ' + sourceLogo.side + ')' : ''}</label>
      <div className="panel-actions"><button type="button" className="mock-primary" disabled={busy || !selectedColorWay || (selectedColorWay === '__new' && (!versionName.trim() || !versionColors.trim()))} onClick={assign}>Save artwork choice</button>
        {editingVersion && !assignmentUnconfirmed && <button type="button" disabled={busy} onClick={() => { setEditingVersion(false); setSelectedColorWay(''); setAllGarments(false); }}>Cancel</button>}</div>
    </div>}
    {!choosingVersion && assigned && <p className="panel-hint">Artwork: <strong>{assigned.label}</strong>{assigned.colors && <> · Ink / thread: {assigned.colors}</>}</p>}
    {logo.onUpload && !logo.url && !choosingVersion && <p className="panel-hint">Artist next step: upload the transparent logo PNG. Saving artwork does not approve it.</p>}
    {!logo.url && !choosingVersion && !!logo.productionPngs?.length && !!logo.onUseProductionPng && <div className="production-logo-options">
      <p className="panel-hint">Already uploaded under Production Files? Choose a transparent PNG for this artwork version:</p>
      {logo.productionPngs.map(file => <button key={file.url} type="button" disabled={busy} onClick={() => useProductionPng(file)}>Use {file.name} as logo detail</button>)}
    </div>}
    {logo.blockedReason && <p role="alert" className="mock-error">{logo.blockedReason}</p>}
    {logo.needsColorWay && !sourceLogo.onAssign && !logo.blockedReason && <p className="panel-hint">Choose the artwork version in Art Library → Apply to items first.</p>}
    {logo.onUpload && <div className="panel-actions">
      <button type="button" disabled={busy || choosingVersion} onClick={() => input.current.click()}>{logo.url ? 'Replace logo' : 'Upload logo PNG'}</button>
      {!choosingVersion && sourceLogo.onAssign && <button type="button" onClick={() => { setSelectedColorWay(sourceLogo.colorWayId || ''); setEditingVersion(true); }} disabled={busy}>Change artwork version</button>}
      {logo.url && logo.onRemove && <button type="button" className="mock-remove" disabled={busy || choosingVersion} onClick={() => { if (window.confirm('Remove this logo detail?')) run(() => logo.onRemove(logo.url)); }}>Remove</button>}
      <input ref={input} type="file" hidden accept=".png" onChange={e => { upload(Array.from(e.target.files)); e.target.value = ''; }} />
    </div>}
  </div>;
}

export default function GarmentMockCard({ label, sub, mocks, candidates, suggest = false, busy, onUse, onRemove, onUpload, onSendToArtist, uploadLabel = 'Upload', accept = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.ai,.eps,.svg', logo = null, children = null }) {
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loadedPreview, setLoadedPreview] = useState('');
  const [previewError, setPreviewError] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const choosingExisting = choosing || mocks.length === 0;
  const pool = choosingExisting ? candidates : mocks;
  const showCandidate = choosing || (suggest && mocks.length === 0);
  const files = choosingExisting && !showCandidate ? [] : pool;
  const file = files.find(f => urlOf(f) === selected) || files[0];
  const url = urlOf(file);
  const thumb = (f, width = 1600) => _isImgUrl(urlOf(f)) ? cloudinaryPreviewUrl(urlOf(f), width) : _cloudinaryPdfThumb(urlOf(f));
  const previewUrl = file ? thumb(file) : '';
  useEffect(() => { setLoadedPreview(''); setPreviewError(false); }, [previewUrl]);
  const run = async fn => {
    setError('');
    try { const ok = await fn(); if (ok !== false) { setChoosing(false); setSelected(''); } else { setError('Could not save this mock. Please try again.'); } }
    catch (e) { setError('Could not save this mock. Please try again.'); }
  };
  const status = logo?.blockedReason ? 'Missing decoration' : !mocks.length ? 'Needs mock' : logo && !logo.url ? 'Needs logo detail' : 'Mock saved';
  return <section className="garment-mock-card" aria-label={label + ' mock'} aria-busy={busy}>
    <header><div><strong>{label || 'Garment mock'}</strong>{sub && <small>{sub}</small>}</div><span className={status === 'Mock saved' ? 'mock-tag saved' : 'mock-tag'}>{status}</span></header>
    <div className={logo ? 'mock-panels two' : 'mock-panels'}>
      <div className="mock-panel">
        {logo && <div className="panel-label"><span>On the garment</span></div>}
        <div className={'panel-frame mock-preview' + (drag ? ' dragging' : '')} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) onUpload(Array.from(e.dataTransfer.files)); }}>
          {file ? <button type="button" className="frame-open mock-open" onClick={() => openFile(url)} aria-label="Open full size mock">
            {previewUrl ? <><img src={previewUrl} alt={fileDisplayName(file)} decoding="async" onLoad={() => setLoadedPreview(previewUrl)} onError={() => setPreviewError(true)} />{loadedPreview !== previewUrl && !previewError && <span className="mock-loading" role="status">Loading mock…</span>}{previewError && <span className="mock-loading" role="alert">Preview could not load · open full size ↗</span>}</> : <span className="mock-document">PDF / image<br /><small>{fileDisplayName(file)}</small></span>}
            <span className="mock-enlarge">Open full size ↗</span>
          </button> : <div className="mock-empty"><strong>Add a mock for this garment</strong><span>Use an image already attached, or upload one.</span><span>Drag and drop works here too.</span></div>}
        </div>
        {files.length > 1 && <div className="mock-thumbnails" aria-label="Choose an image">{files.map((f, i) => <button type="button" key={urlOf(f)} disabled={busy} aria-label={'Select image ' + (i + 1) + ': ' + fileDisplayName(f)} aria-pressed={urlOf(f) === url} onClick={() => setSelected(urlOf(f))}>{thumb(f, 240) ? <img src={thumb(f, 240)} alt="" loading="lazy" /> : <span>PDF</span>}</button>)}</div>}
        <div className="panel-meta" title={file ? fileDisplayName(file) : ''}>{file ? fileDisplayName(file) : 'No mock yet'}</div>
        {file && choosingExisting && <p className="panel-hint">Check the garment, color and placement, then use this mock.</p>}
        {file && choosingExisting && file.requires_mock_review && <p className="panel-hint">From {file.source_art_name}. Confirm this image also matches the artwork for this job.</p>}
        {error && <p role="alert" className="mock-error">{error}</p>}
        <div className="panel-actions">
          {file && choosingExisting && <button type="button" className="mock-primary" disabled={busy} onClick={() => run(() => onUse(file))}>{busy ? 'Saving…' : 'Use this mock'}</button>}
          {onSendToArtist && <button type="button" className="mock-artist" disabled={busy} title="None of these mocks are right — pick an artist to build a new mock for this garment" onClick={onSendToArtist}>🎨 Send to Artist</button>}
          {!choosing && candidates.length > 0 && !(suggest && !mocks.length) && <button type="button" disabled={busy} onClick={() => { setChoosing(true); setSelected(''); }}>{mocks.length ? 'Change mock' : 'Use existing image'}</button>}
          <button type="button" disabled={busy} onClick={() => input.current.click()}>{uploadLabel}</button>
          {choosing && <button type="button" disabled={busy} onClick={() => { setChoosing(false); setSelected(''); }}>Cancel</button>}
          {file && !choosingExisting && <button type="button" className="mock-remove" disabled={busy} onClick={() => { if (window.confirm('Remove this mock from this garment slot?')) run(() => onRemove(url)); }}>Remove</button>}
          <input ref={input} type="file" hidden multiple accept={accept} onChange={e => { if (e.target.files.length) run(() => onUpload(Array.from(e.target.files))); e.target.value = ''; }} />
        </div>
      </div>
      {logo && <LogoDetailPane logo={logo} busy={busy} mockUrl={mocks.length ? urlOf(mocks[0]) : ''} />}
    </div>
    {children}
  </section>;
}

const SIZE_ORDER = ['YXS', 'YS', 'YM', 'YL', 'YXL', 'XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL', '6XL', 'OSFA'];
const _sizeRank = s => { const i = SIZE_ORDER.indexOf(String(s).toUpperCase()); return i < 0 ? SIZE_ORDER.length : i; };

// The garments one shared mock covers, listed together: each garment's size quantities and a
// combined total. With received / shipped maps (from garmentProgress) each size cell is tinted by
// its progress and Received / Shipped columns are added. rows = [{ key, label, sizes, received?,
// shipped?, onView? }]
export function MockCoversTable({ rows }) {
  const list = (rows || []).filter(Boolean);
  if (list.length < 2) return null;
  const qty = v => Number(v) || 0;
  const sizes = [...new Set(list.flatMap(r => Object.keys(r.sizes || {}).filter(sz => qty(r.sizes[sz]) > 0)))]
    .sort((a, b) => _sizeRank(a) - _sizeRank(b));
  const total = r => sizes.reduce((n, sz) => n + qty(r.sizes?.[sz]), 0);
  const progress = list.some(r => r.received || r.shipped);
  const sum = (r, m) => sizes.reduce((n, sz) => n + Math.min(qty(r.sizes?.[sz]), qty(r[m]?.[sz])), 0);
  const cell = (r, sz) => {
    const n = qty(r.sizes?.[sz]);
    if (!n) return <td key={sz} className="zero">—</td>;
    if (!progress) return <td key={sz} className="qty">{n}</td>;
    const c = sizeProgressCell(n, r.received?.[sz], r.shipped?.[sz]);
    return <td key={sz} className="qty" title={sz + ': ' + c.title + '. ' + c.status}><span className="cover-cell" style={{ background: c.background, color: c.color }}>{n}</span></td>;
  };
  return <div className="mock-covers">
    <h5>🔗 This mock covers {list.length} garments</h5>
    <div style={{ overflowX: 'auto' }}><table>
      <thead><tr><th>Garment</th>{sizes.map(sz => <th key={sz}>{sz}</th>)}<th>Total</th>{progress && <><th>Received</th><th>Shipped</th></>}{list.some(r => r.onView) && <th />}</tr></thead>
      <tbody>
        {list.map(r => <tr key={r.key}><td>{r.label}</td>{sizes.map(sz => cell(r, sz))}<td className="qty">{total(r)}</td>
          {progress && <><td>{sum(r, 'received')}/{total(r)}</td><td>{sum(r, 'shipped')}/{total(r)}</td></>}
          {list.some(x => x.onView) && <td>{r.onView && <button type="button" className="cover-link" onClick={r.onView} title="Open this garment's line on the sales order">SO →</button>}</td>}</tr>)}
        <tr className="total"><td>All garments</td>{sizes.map(sz => <td key={sz}>{list.reduce((n, r) => n + qty(r.sizes?.[sz]), 0) || '—'}</td>)}<td>{list.reduce((n, r) => n + total(r), 0)}</td>
          {progress && <><td>{list.reduce((n, r) => n + sum(r, 'received'), 0)}/{list.reduce((n, r) => n + total(r), 0)}</td><td>{list.reduce((n, r) => n + sum(r, 'shipped'), 0)}/{list.reduce((n, r) => n + total(r), 0)}</td></>}
          {list.some(r => r.onView) && <td />}</tr>
      </tbody>
    </table></div>
  </div>;
}
