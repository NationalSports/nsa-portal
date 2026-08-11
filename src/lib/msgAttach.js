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
  const [open, setOpen] = React.useState(false);
  const fs = compact ? 10 : 11;
  return <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: items.length || busy ? 6 : 0 }}>
    {open && <MsgAttachModal items={items} setItems={setItems} busy={busy} setBusy={setBusy} nf={nf} onClose={() => setOpen(false)}/>}
    <button type="button" disabled={busy} onClick={() => setOpen(true)}
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
// Drag state + handlers, shared by the surface-wide zone and the attach dialog.
const useMsgDrag = (setItems, setBusy, nf) => {
  const [over, setOver] = React.useState(false);
  // Dragging across a child element fires dragleave on the parent, so count enters
  // and exits instead of clearing on the first leave — otherwise the target flickers.
  const depth = React.useRef(0);
  // Zones nest — the attach dialog sits inside the composer's surface-wide zone — so
  // every handler stops the event. Without this a single drop is handled by the inner
  // zone and again by the outer one, and the file uploads twice.
  const handlers = {
    onDragEnter: (e) => { if (!msgDragHasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current += 1; setOver(true) },
    onDragOver: (e) => { if (!msgDragHasFiles(e)) return; e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy' },
    onDragLeave: (e) => { if (!msgDragHasFiles(e)) return; e.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) },
    onDrop: (e) => {
      if (!msgDragHasFiles(e)) return;
      e.preventDefault(); e.stopPropagation(); depth.current = 0; setOver(false);
      attachMsgFiles(Array.from(e.dataTransfer.files || []), setItems, setBusy, nf, true);
    },
  };
  return [over, handlers];
};

export const MsgDropZone = ({ setItems, setBusy, nf, className, style, children, label = 'Drop to attach' }) => {
  const [over, handlers] = useMsgDrag(setItems, setBusy, nf);
  return <div className={className} style={{ position: 'relative', ...(style || {}) }} {...handlers}>
    {children}
    {over && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, background: 'rgba(239,246,255,0.94)', border: '2px dashed #3b82f6', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, pointerEvents: 'none' }}>
      <span style={{ fontSize: 28 }}>{'📎'}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>{label}</span>
      <span style={{ fontSize: 11, color: '#3b82f6' }}>Images and PDFs, up to {MSG_ATTACH_MAX_MB}MB each</span>
    </div>}
  </div>;
};

// The attach dialog the 📎 button opens — a dashed drop box like the rest of the
// app's uploads, with browse as the fallback rather than the only way in. Files
// attach as they land, so closing it is just closing it; nothing is pending.
export const MsgAttachModal = ({ items = [], setItems, busy, setBusy, nf, onClose }) => {
  const [over, handlers] = useMsgDrag(setItems, setBusy, nf);
  const browse = () => pickMsgFiles((files) => attachMsgFiles(files, setItems, setBusy, nf, false));
  return <div onClick={onClose}
    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <div onClick={e => e.stopPropagation()}
      style={{ background: 'white', borderRadius: 12, padding: 20, width: '100%', maxWidth: 460, boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Attach files</span>
        <button type="button" onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 20, lineHeight: 1, color: '#64748b', cursor: 'pointer', padding: '0 4px' }}>{'×'}</button>
      </div>
      <div {...handlers} onClick={browse}
        style={{ padding: 32, border: '2px dashed ' + (over ? '#3b82f6' : '#d1d5db'), borderRadius: 8, textAlign: 'center', cursor: 'pointer', background: over ? '#eff6ff' : '#f8fafc', transition: 'all 0.2s' }}>
        <div style={{ fontSize: 30, marginBottom: 6 }}>{'📎'}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: over ? '#1e40af' : '#334155' }}>{over ? 'Drop to attach' : 'Drag files here'}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>or <span style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>browse</span> your computer</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Images and PDFs, up to {MSG_ATTACH_MAX_MB}MB each</div>
      </div>
      {busy && <div style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, marginTop: 10 }}>Uploading…</div>}
      {items.length > 0 && <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 6 }}>Attached ({items.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
          {items.map((f, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: '#f8fafc', fontSize: 12 }}>
            <span>{_isPdfUrl(f.url, f) ? '📄' : '🖼'}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155' }}>{f.name || 'file'}</span>
            <button type="button" onClick={() => setItems(prev => prev.filter((_, j) => j !== i))}
              style={{ border: 'none', background: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>{'×'}</button>
          </div>)}
        </div>
      </div>}
      <button type="button" onClick={onClose} disabled={busy}
        style={{ marginTop: 14, width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: busy ? '#e2e8f0' : '#1e40af', color: busy ? '#94a3b8' : 'white', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>
        {items.length > 0 ? `Done — ${items.length} attached` : 'Done'}
      </button>
    </div>
  </div>;
};
