import React, { useMemo, useRef, useState } from 'react';
import { fileUpload } from './utils';
import { createArtService } from './lib/standaloneArtRequests';

const TYPE_LABELS = { web_logo: 'Web logo', vectorize: 'Vectorize artwork', create_logo: 'Create logo' };
const STATUS_LABELS = { requested: 'Requested', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
const ART_ACCEPT = '.png,.jpg,.jpeg,.webp,.svg,.ai,.eps,.pdf,.dst';
const acceptFor = type => type === 'web_logo' ? '.png' : type === 'vectorize' ? '.svg,.ai,.eps,.pdf' : ART_ACCEPT;
const validFor = (type, file) => {
  const ext = String(file?.name || '').split('.').pop().toLowerCase();
  if (type === 'web_logo') return ext === 'png';
  if (type === 'vectorize') return ['svg', 'ai', 'eps', 'pdf'].includes(ext);
  return ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ai', 'eps', 'pdf', 'dst'].includes(ext);
};
const labelStyle = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 800, color: '#64748b' };
const fileLink = (file, i) => <a key={`${file.url}-${i}`} href={file.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontSize: 11 }}>{file.name || `File ${i + 1}`}</a>;

export function ArtRequestCard({ request, supabase, onChanged, onOpenSource }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const inputRef = useRef(null);
  const service = useMemo(() => createArtService(supabase), [supabase]);
  const status = request?.status || 'requested';
  const working = status === 'in_progress';
  const sourceLabel = request?.linked_so_id || request?.so_id ? 'Sales order' : request?.estimate_id ? 'Estimate · pre-approval' : 'Art Library';
  const sourceId = request?.linked_so_id || request?.so_id || request?.estimate_id || '';
  const colorWay = request?.color_way_label || request?.color_way_id;
  const results = uploadedFiles.length ? uploadedFiles : (request?.result_files || []);

  const upload = async fileList => {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    if (request.request_type === 'web_logo' && picked.length !== 1) { setError('Upload one PNG per color way.'); return; }
    const emptyFile = picked.find(f => !f.size);
    if (emptyFile) { setError(`${emptyFile.name} is empty. Choose a non-empty finished file.`); return; }
    const invalid = picked.find(f => !validFor(request.request_type, f));
    if (invalid) {
      setError(request.request_type === 'web_logo' ? 'Web logo results must be PNG files.' : request.request_type === 'vectorize' ? 'Vectorized artwork must be SVG, AI, EPS, or PDF.' : 'Choose supported art files (PNG, JPG, WebP, SVG, AI, EPS, PDF, or DST).');
      return;
    }
    setBusy(true); setError('');
    try {
      for (const file of picked) {
        const url = await fileUpload(file, 'nsa-art-requests');
        if (!url) throw new Error(`Upload did not return a file URL for ${file.name}.`);
        // Stage each successful upload immediately. If a later file or the completion
        // transition fails, the artist can retry saving without uploading it again.
        setUploadedFiles(current => request.request_type === 'web_logo' ? [{ name: file.name, url }] : [...current, { name: file.name, url }]);
      }
    } catch (e) {
      setError(e.message || 'File upload failed. Retry the upload.');
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const transition = async (nextStatus, files = []) => {
    setBusy(true); setError('');
    try {
      const result = await service.transition(request.id, nextStatus, files);
      if (result === false) throw new Error('The request update was not saved. Try again.');
      onChanged?.(result);
    } catch (e) { setError(e.message || 'Could not update this art request.'); }
    finally { setBusy(false); }
  };
  const complete = () => {
    if (!uploadedFiles.length) { setError('Upload at least one finished file before completing this request.'); return; }
    transition('completed', uploadedFiles);
  };

  if (!request) return null;
  return <article style={{ border: '1px solid #dbe3ef', borderRadius: 10, padding: 12, background: 'white', display: 'grid', gap: 8 }}>
    <header style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
      <strong style={{ color: '#0f172a', fontSize: 14 }}>{request.art_name || 'Artwork request'}</strong>
      <span style={{ fontSize: 10, fontWeight: 800, color: '#3730a3', background: '#eef2ff', borderRadius: 999, padding: '3px 8px' }}>{TYPE_LABELS[request.request_type] || request.request_type || 'Art request'}</span>
      <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: status === 'completed' ? '#166534' : status === 'cancelled' ? '#64748b' : '#92400e', background: status === 'completed' ? '#dcfce7' : status === 'cancelled' ? '#f1f5f9' : '#fef3c7', borderRadius: 999, padding: '3px 8px' }}>{STATUS_LABELS[status] || status}</span>
    </header>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: '#475569' }}>
      {request.customer_id && <span><b>Customer</b> · {request.customer_name || request.customer_id}</span>}
      <span><b>{sourceLabel}</b>{sourceId ? ` · ${sourceId}` : ''}</span>
      {!request.estimate_id&&!request.so_id&&request.source_key&&request.source_key!=='library'&&<span>Originally {request.source_key} · document removed</span>}
      {colorWay && <span><b>Color way</b> · {colorWay}</span>}
      {request.assigned_artist && <span><b>Artist</b> · {request.assigned_artist_name || request.assigned_artist}</span>}
      {request.requested_by_name && <span><b>Requested by</b> · {request.requested_by_name}</span>}
    </div>
    {request.instructions && <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#334155', background: '#f8fafc', borderRadius: 7, padding: 9 }}><div style={labelStyle}>Instructions</div><div style={{ marginTop: 4 }}>{request.instructions}</div></div>}
    {(request.reference_files || []).length > 0 && <div><div style={labelStyle}>Reference files</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{request.reference_files.map(fileLink)}</div></div>}
    {request.source_art && onOpenSource && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}><span style={{ color: '#64748b' }}>Source artwork available</span><button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => onOpenSource?.(request.source_art, request)}>View source</button></div>}
    {working && request.request_type==='web_logo'&&<p style={{fontSize:12,color:'#475569',margin:0}}>Upload one transparent PNG of the logo only, exactly as this color way prints. It will be saved for stores and future jobs.</p>}
    {results.length > 0 && <div style={{ padding: 8, background: '#f0fdf4', borderRadius: 7 }}><div style={labelStyle}>Finished files</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{results.map(fileLink)}</div></div>}
    {error && <div role="alert" style={{ fontSize: 11, color: '#b91c1c', background: '#fef2f2', padding: 8, borderRadius: 6 }}>{error}</div>}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {status === 'requested' && <button type="button" className="btn btn-sm" disabled={busy} style={{ background: '#1d4ed8', color: 'white', border: 0 }} onClick={() => transition('in_progress')}>{busy ? 'Saving…' : 'Start'}</button>}
      {working && <>
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Working…' : uploadedFiles.length ? (request.request_type==='web_logo'?'Replace finished PNG':'Add finished files') : 'Upload finished files'}</button>
        <input ref={inputRef} hidden type="file" multiple={request.request_type!=='web_logo'} accept={acceptFor(request.request_type)} disabled={busy} onChange={e => upload(e.target.files)} />
        <button type="button" className="btn btn-sm" disabled={busy || !uploadedFiles.length} style={{ background: '#166534', color: 'white', border: 0 }} onClick={complete}>{busy ? 'Saving…' : 'Mark completed'}</button>
        {!uploadedFiles.length && <span style={{ fontSize: 10, color: '#64748b' }}>Upload finished files to enable completion.</span>}
      </>}
      {['requested', 'in_progress'].includes(status) && <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => transition('cancelled')}>Cancel request</button>}
      {sourceId && <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => onOpenSource?.(request.source_art || sourceId, request)}>Open {request.linked_so_id||request.so_id ? 'order' : 'estimate'}</button>}
    </div>
  </article>;
}

export default ArtRequestCard;
