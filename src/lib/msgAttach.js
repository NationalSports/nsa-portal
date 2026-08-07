// Image / PDF attachments for internal messages.
//
// Files go to Cloudinary through the same `fileUpload` path art files use, and the
// resulting [{url,name,type,size}] list is stored on messages.attachments (jsonb).
// Every staff surface that renders a message renders <MsgAttachments/>; the ones
// that compose also render <MsgAttachBar/> above the send button.
import React from 'react';
import { fileUpload, openFile, _isImgUrl, _isPdfUrl, _cloudinaryPdfThumb } from '../utils';

export const MSG_ATTACH_ACCEPT = 'image/*,application/pdf,.pdf';
export const MSG_ATTACH_MAX_MB = 25;

// Normalized read — attachments may be absent (older rows) or a stray non-array.
export const msgAttachments = (m) => {
  const a = m && m.attachments;
  return Array.isArray(a) ? a.filter(f => f && f.url) : [];
};

const _isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const _isImgFile = (f) => (f.type || '').startsWith('image/');

// Cloudinary delivery transform so a 6MB phone photo doesn't ship full-size into a
// thread. Untransformed (non-Cloudinary) URLs pass through unchanged.
const _cloudFit = (u, w) => {
  if (!u || typeof u !== 'string' || !u.includes('/image/upload/')) return u;
  return u.replace('/image/upload/', `/image/upload/c_limit,w_${w},q_auto,f_auto/`);
};

// Opens the OS picker and hands back the chosen File list.
export const pickMsgFiles = (onFiles) => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = MSG_ATTACH_ACCEPT; inp.multiple = true;
  inp.onchange = () => { const files = Array.from(inp.files || []); if (files.length) onFiles(files) };
  inp.click();
};

// Pasted screenshots (Cmd/Ctrl+V in the reply box) come through as clipboard files.
export const msgPasteFiles = (e) => {
  const items = Array.from(e?.clipboardData?.items || []);
  return items.filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
};

// Uploads images/PDFs and returns {uploaded, skipped}. Anything rejected (wrong type,
// too big, upload error) is named in `skipped` so the caller can surface it.
export const uploadMsgFiles = async (files) => {
  const ok = [], skipped = [];
  Array.from(files || []).forEach(f => {
    if (!_isImgFile(f) && !_isPdfFile(f)) { skipped.push(`${f.name} (images and PDFs only)`); return }
    if (f.size > MSG_ATTACH_MAX_MB * 1024 * 1024) { skipped.push(`${f.name} (over ${MSG_ATTACH_MAX_MB}MB)`); return }
    ok.push(f);
  });
  const results = await Promise.allSettled(ok.map(f => fileUpload(f, 'nsa-messages')
    .then(url => ({ url, name: f.name, type: f.type || (_isPdfFile(f) ? 'application/pdf' : ''), size: f.size }))));
  const uploaded = [];
  results.forEach((r, i) => { if (r.status === 'fulfilled') uploaded.push(r.value); else skipped.push(`${ok[i].name} (upload failed)`) });
  return { uploaded, skipped };
};

// The one attach path — picker, paste, and drop all land here. Uploads, appends what
// succeeded, and names anything skipped so nothing disappears quietly.
const attachMsgFiles = (files, setItems, setBusy, nf, announce) => {
  const list = Array.from(files || []);
  if (!list.length) return;
  setBusy(true);
  uploadMsgFiles(list).then(({ uploaded, skipped }) => {
    if (uploaded.length) { setItems(prev => [...prev, ...uploaded]); if (announce && nf) nf(uploaded.length + ' file(s) attached') }
    if (skipped.length && nf) nf('Skipped: ' + skipped.join(', '), 'error');
  }).catch(e => { if (nf) nf('Upload failed: ' + (e.message || e), 'error') })
    .finally(() => setBusy(false));
};

// Read-only strip under a message bubble. Images show as thumbnails, PDFs as a
// first-page render (Cloudinary) or a labeled tile; both open in a new tab on click.
export const MsgAttachments = ({ items, size = 84 }) => {
  const list = Array.isArray(items) ? items.filter(f => f && f.url) : [];
  if (!list.length) return null;
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
    {list.map((f, i) => {
      const isImg = _isImgUrl(f.url, f);
      const isPdf = _isPdfUrl(f.url, f);
      const thumb = isImg ? _cloudFit(f.url, size * 3) : (isPdf ? _cloudinaryPdfThumb(f.url) : null);
      return <div key={i} title={f.name || ''} onClick={e => { e.stopPropagation(); openFile(f) }}
        style={{ width: size, height: size, borderRadius: 6, border: '1px solid #e2e8f0', overflow: 'hidden', position: 'relative', background: '#f8fafc', cursor: 'pointer', flexShrink: 0 }}>
        {thumb ? <img src={thumb} alt={f.name || ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={e => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex' }} /> : null}
        <div style={{ display: thumb ? 'none' : 'flex', width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: '#64748b' }}>
          <span style={{ fontSize: 18 }}>{isPdf ? '📄' : '📎'}</span>
          <span style={{ fontSize: 9, fontWeight: 700 }}>{isPdf ? 'PDF' : 'FILE'}</span>
        </div>
        {isPdf && <div style={{ position: 'absolute', top: 2, left: 2, background: '#dc2626', color: 'white', fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3 }}>PDF</div>}
        {f.name && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 8, padding: '1px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>}
      </div>;
    })}
  </div>;
};

// Composer control: attach button + pending-file chips. `items`/`setItems` and
// `busy`/`setBusy` are owned by the caller so its send handler can read the pending
// files and disable Send while an upload is in flight.
export const MsgAttachBar = ({ items = [], setItems, busy, setBusy, nf, compact }) => {
  const add = (files) => attachMsgFiles(files, setItems, setBusy, nf, false);
  const fs = compact ? 10 : 11;
  return <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: items.length || busy ? 6 : 0 }}>
    <button type="button" disabled={busy} onClick={() => pickMsgFiles(add)}
      style={{ fontSize: fs, padding: compact ? '3px 8px' : '4px 10px', borderRadius: 10, border: '1px solid #e2e8f0', background: 'white', color: busy ? '#94a3b8' : '#475569', cursor: busy ? 'default' : 'pointer', fontWeight: 600 }}>
      {busy ? 'Uploading…' : '📎 Attach'}
    </button>
    {items.map((f, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: fs, padding: '2px 6px', borderRadius: 10, background: '#eff6ff', color: '#1e40af', fontWeight: 600, maxWidth: 180 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{_isPdfUrl(f.url, f) ? '📄' : '🖼'} {f.name || 'file'}</span>
      <button type="button" onClick={() => setItems(prev => prev.filter((_, j) => j !== i))}
        style={{ border: 'none', background: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>{'×'}</button>
    </span>)}
    {items.length > 0 && <span style={{ fontSize: 9, color: '#94a3b8' }}>{items.length} attached</span>}
  </div>;
};

// Handler for onPaste on a composer input — attaches pasted screenshots.
export const makeMsgPasteHandler = (setItems, setBusy, nf) => (e) => {
  const files = msgPasteFiles(e);
  if (!files.length) return;
  e.preventDefault();
  attachMsgFiles(files, setItems, setBusy, nf, true);
};

// True only for a drag carrying actual files — dragging selected text or an image
// already on the page shouldn't light up the composer.
export const msgDragHasFiles = (e) => Array.from(e?.dataTransfer?.types || []).includes('Files');

// Drop target. Wraps a composer surface and takes over its element (className/style
// pass straight through) so callers don't gain a layout layer; dropping images or
// PDFs anywhere inside attaches them to the message being written.
export const MsgDropZone = ({ setItems, setBusy, nf, className, style, children, label = 'Drop to attach' }) => {
  const [over, setOver] = React.useState(false);
  // Dragging across a child element fires dragleave on the parent, so count enters
  // and exits instead of clearing on the first leave — otherwise the overlay flickers.
  const depth = React.useRef(0);
  const onDragEnter = (e) => { if (!msgDragHasFiles(e)) return; e.preventDefault(); depth.current += 1; setOver(true) };
  const onDragOver = (e) => { if (!msgDragHasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy' };
  const onDragLeave = (e) => { if (!msgDragHasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) };
  const onDrop = (e) => {
    if (!msgDragHasFiles(e)) return;
    e.preventDefault(); depth.current = 0; setOver(false);
    attachMsgFiles(Array.from(e.dataTransfer.files || []), setItems, setBusy, nf, true);
  };
  return <div className={className} style={{ position: 'relative', ...(style || {}) }}
    onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {children}
    {over && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, background: 'rgba(239,246,255,0.94)', border: '2px dashed #3b82f6', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, pointerEvents: 'none' }}>
      <span style={{ fontSize: 28 }}>{'📎'}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>{label}</span>
      <span style={{ fontSize: 11, color: '#3b82f6' }}>Images and PDFs, up to {MSG_ATTACH_MAX_MB}MB each</span>
    </div>}
  </div>;
};
