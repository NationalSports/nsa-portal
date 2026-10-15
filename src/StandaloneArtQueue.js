import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fileUpload } from './utils';
import { ProofHistory } from './ArtRequestProofs';
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

const isOpen = status => ['requested', 'in_progress'].includes(status);
const uploadHint = type => type === 'web_logo'
  ? 'One transparent PNG of the logo only, exactly as this color way prints. It is saved for stores and future jobs.'
  : type === 'vectorize' ? 'Vector files only: SVG, AI, EPS or PDF.' : 'Finished art and mockups: PNG, JPG, WebP, SVG, AI, EPS, PDF or DST.';
// One line telling the artist what to do next, shown on the compact board card.
const nextStep = request => request.status === 'requested' ? 'Next: open it and click Start, or upload the finished file'
  : request.status === 'in_progress' ? ((request.result_files || []).length ? 'Next: open it and click Mark completed when done'
    : request.request_type === 'web_logo' ? 'Next: upload the logo PNG, then Mark completed' : 'Next: upload finished art / mocks, then Mark completed') : '';

export function ArtRequestCard({ request, supabase, onChanged, onOpenSource, onStagedChange, bare }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Files already saved on the request (from an earlier upload) are the starting list.
  const [uploadedFiles, setUploadedFiles] = useState(() => isOpen(request?.status) ? (request?.result_files || []) : []);
  const filesRef = useRef(uploadedFiles);
  const [unsaved, setUnsaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stage = next => { filesRef.current = next; setUploadedFiles(next); };
  useEffect(() => { onStagedChange?.(unsaved ? uploadedFiles.length : 0); }, [unsaved, uploadedFiles.length, onStagedChange]);
  const inputRef = useRef(null);
  const service = useMemo(() => createArtService(supabase), [supabase]);
  const status = request?.status || 'requested';
  const working = status === 'in_progress';
  const sourceLabel = request?.linked_so_id || request?.so_id ? 'Sales order' : request?.estimate_id ? 'Estimate · pre-approval' : 'Art Library';
  const sourceId = request?.linked_so_id || request?.so_id || request?.estimate_id || '';
  const colorWay = request?.color_way_label || request?.color_way_id;
  const results = isOpen(status) ? uploadedFiles : (request?.result_files || []);

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
    let staged = 0;
    try {
      for (const file of picked) {
        const url = await fileUpload(file, 'nsa-art-requests');
        if (!url) throw new Error(`Upload did not return a file URL for ${file.name}.`);
        // Stage each successful upload immediately. If a later file or the completion
        // transition fails, the artist can retry saving without uploading it again.
        stage(request.request_type === 'web_logo' ? [{ name: file.name, url }] : [...filesRef.current, { name: file.name, url }]);
        staged++;
      }
    } catch (e) {
      setError(e.message || 'File upload failed. Retry the upload.');
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
    if (!staged) return;
    if (await saveFiles(filesRef.current) && status === 'requested') await transition('in_progress');
  };
  // Save the current file list on the request right away; Mark completed is no longer needed to keep them.
  const saveFiles = async files => {
    setBusy(true);
    try {
      const saved = await service.saveFiles(request.id, files);
      setUnsaved(false); onChanged?.(saved); return true;
    } catch (e) {
      setUnsaved(true); setError(`${e.message || 'Could not save the uploaded files.'} Your files are still here — try again.`); return false;
    } finally { setBusy(false); }
  };
  const removeFile = i => { const next = filesRef.current.filter((_, j) => j !== i); stage(next); saveFiles(next); };
  const drop = e => { e.preventDefault(); setDragging(false); if (!busy) upload(e.dataTransfer?.files); };

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
  return <article style={{ ...(bare ? {} : { border: '1px solid #dbe3ef', borderRadius: 10, padding: 12 }), background: 'white', display: 'grid', gap: 8 }}>
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
    <ProofHistory proofs={request.portal_proofs} />
    {request.instructions && <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#334155', background: '#f8fafc', borderRadius: 7, padding: 9 }}><div style={labelStyle}>Instructions</div><div style={{ marginTop: 4 }}>{request.instructions}</div></div>}
    {(request.reference_files || []).length > 0 && <div><div style={labelStyle}>Reference files</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{request.reference_files.map(fileLink)}</div></div>}
    {request.source_art && onOpenSource && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}><span style={{ color: '#64748b' }}>Source artwork available</span><button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => onOpenSource?.(request.source_art, request)}>View source</button></div>}
    {results.length > 0 && <div style={{ padding: 8, background: '#f0fdf4', borderRadius: 7 }}><div style={labelStyle}>Finished files{isOpen(status) ? (unsaved ? ' · not saved yet' : ' · saved') : ''}</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{results.map((f, i) => isOpen(status)
      ? <span key={`${f.url}-${i}`} style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>{fileLink(f, i)}<button type="button" aria-label={`Remove ${f.name || 'file'}`} title="Remove this file" disabled={busy} onClick={() => removeFile(i)} style={{ border: 0, background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button></span>
      : fileLink(f, i))}</div>{unsaved && isOpen(status) && <button type="button" className="btn btn-sm btn-secondary" disabled={busy} style={{ marginTop: 6 }} onClick={() => saveFiles(filesRef.current)}>Retry saving files</button>}</div>}
    {isOpen(status) && <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}
      style={{ border: `2px dashed ${dragging ? '#1d4ed8' : '#93c5fd'}`, background: dragging ? '#dbeafe' : '#eff6ff', borderRadius: 10, padding: 14, display: 'grid', gap: 6, justifyItems: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#1e3a8a' }}>{request.request_type === 'web_logo' ? 'Upload the finished logo PNG' : 'Upload finished art & mockups'}</div>
      <div style={{ fontSize: 11, color: '#475569' }}>Drag files here or click the button. {uploadHint(request.request_type)}{status === 'requested' ? ' Uploading starts this request for you.' : ''}</div>
      <button type="button" className="btn btn-sm" disabled={busy} style={{ background: '#1d4ed8', color: 'white', border: 0 }} onClick={() => inputRef.current?.click()}>{busy ? 'Working…' : uploadedFiles.length ? (request.request_type==='web_logo'?'Replace finished PNG':'Add more files') : 'Upload finished files'}</button>
      <input ref={inputRef} hidden type="file" multiple={request.request_type!=='web_logo'} accept={acceptFor(request.request_type)} disabled={busy} onChange={e => upload(e.target.files)} />
    </div>}
    {error && <div role="alert" style={{ fontSize: 11, color: '#b91c1c', background: '#fef2f2', padding: 8, borderRadius: 6 }}>{error}</div>}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {status === 'requested' && <button type="button" className="btn btn-sm" disabled={busy} style={{ background: '#1d4ed8', color: 'white', border: 0 }} onClick={() => transition('in_progress')}>{busy ? 'Saving…' : 'Start'}</button>}
      {(working || uploadedFiles.length > 0) && isOpen(status) && <>
        <button type="button" className="btn btn-sm" disabled={busy || !uploadedFiles.length} style={{ background: '#166534', color: 'white', border: 0 }} onClick={complete}>{busy ? 'Saving…' : 'Mark completed'}</button>
        {!uploadedFiles.length && <span style={{ fontSize: 10, color: '#64748b' }}>Upload finished files to enable completion.</span>}
        {uploadedFiles.length > 0 && !unsaved && <span style={{ fontSize: 10, color: '#64748b' }}>Files are saved. Click Mark completed when the art is final.</span>}
      </>}
      {['requested', 'in_progress'].includes(status) && <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => transition('cancelled')}>Cancel request</button>}
      {sourceId && <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => onOpenSource?.(request.source_art || sourceId, request)}>Open {request.linked_so_id||request.so_id ? 'order' : 'estimate'}</button>}
    </div>
  </article>;
}

// Compact board card (matches the order art job cards); click opens the full request in a popup.
export function ArtRequestTile({ request, supabase, onChanged, onOpenSource }) {
  const [open, setOpen] = useState(false);
  const [staged, setStaged] = useState(0);
  const onStagedChange = React.useCallback(n => setStaged(n), []);
  if (!request) return null;
  const status = request.status || 'requested';
  const sourceId = request.linked_so_id || request.so_id || request.estimate_id || '';
  const step = nextStep(request);
  const confirmLeave = () => !(staged > 0 && isOpen(status)) || window.confirm('Some uploaded files did not save to this request. Close anyway and lose them?');
  const close = () => { if (confirmLeave()) setOpen(false); };
  const openSource = (...args) => { if (!confirmLeave()) return; setOpen(false); onOpenSource?.(...args); };
  return <>
    <div role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }}
      className="card" style={{ marginBottom: 6, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{request.customer_name || request.customer_id || 'Customer'}</span>
        <span style={{ fontSize: 9, fontWeight: 800, color: status === 'completed' ? '#166534' : status === 'cancelled' ? '#64748b' : '#92400e', background: status === 'completed' ? '#dcfce7' : status === 'cancelled' ? '#f1f5f9' : '#fef3c7', borderRadius: 6, padding: '1px 6px', flexShrink: 0 }}>{STATUS_LABELS[status] || status}</span>
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 2, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{request.art_name || 'Artwork request'}</span>
        <span style={{ fontSize: 8, fontWeight: 700, color: '#3730a3', background: '#eef2ff', borderRadius: 6, padding: '1px 5px', flexShrink: 0, whiteSpace: 'nowrap' }}>{TYPE_LABELS[request.request_type] || 'Art request'}</span>
      </div>
      <div style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[sourceId, request.requested_by_name && `by ${request.requested_by_name}`].filter(Boolean).join(' · ')}</div>
      {isOpen(status) && (request.result_files || []).length > 0 && <div style={{ fontSize: 10, color: '#166534', marginTop: 3 }}>📎 {request.result_files.length} file{request.result_files.length === 1 ? '' : 's'} uploaded</div>}
      {step && <div style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', marginTop: 4 }}>👉 {step}</div>}
    </div>
    {open && createPortal(<div className="modal-overlay" onClick={close}>
      <div className="modal" role="dialog" aria-label={request.art_name || 'Art request'} onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header"><h2 style={{ margin: 0 }}>🎨 {request.art_name || 'Artwork request'}</h2><button type="button" className="modal-close" aria-label="Close" onClick={close}>×</button></div>
        <div className="modal-body"><ArtRequestCard bare request={request} supabase={supabase} onChanged={onChanged} onOpenSource={openSource} onStagedChange={onStagedChange} /></div>
      </div>
    </div>, document.body)}
  </>;
}

export default ArtRequestCard;
