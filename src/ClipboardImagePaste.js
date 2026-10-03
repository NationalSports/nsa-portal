import React, {useEffect, useRef, useState} from 'react';
const supported = type => type === 'image/png' || type === 'image/jpeg';
const namedImage = blob => new File([blob], 'clipboard-image.' + (blob.type === 'image/jpeg' ? 'jpg' : 'png'), {type: blob.type});

export default function ClipboardImagePaste({onUpload, disabled}) {
  const [reading, setReading] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const paste = event => {
      if (disabled || reading || event.target?.closest?.('input,textarea,[contenteditable=""],[contenteditable="true"],[role="textbox"]')) return;
      for (const item of Array.from(event.clipboardData?.items || [])) {
        if (item.kind !== 'file' || !supported(item.type)) continue;
        const file = item.getAsFile();
        if (file) { event.preventDefault(); setMessage(''); onUpload(namedImage(file)); return; }
      }
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [disabled, reading, onUpload]);
  async function readClipboard() {
    setMessage('');
    if (!navigator.clipboard?.read) { setMessage('Press ⌘V on Mac or Ctrl+V on Windows to paste an image.'); return; }
    setReading(true);
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find(supported);
        if (!type) continue;
        const blob = await item.getType(type);
        if (active.current) onUpload(namedImage(blob));
        return;
      }
      if (active.current) setMessage('No PNG or JPG image found. Copy the image itself, then paste again.');
    } catch (_) {
      if (active.current) setMessage('Clipboard access was unavailable. Click outside a text field and press ⌘V on Mac or Ctrl+V on Windows.');
    } finally { if (active.current) setReading(false); }
  }
  return <div style={{marginTop:12}}>
    <button type="button" className="btn btn-secondary" disabled={disabled || reading} onClick={readClipboard}>{reading ? 'Reading clipboard…' : 'Paste image'}</button>
    <span style={{marginLeft:8,fontSize:12,color:'#64748b'}}>Or press ⌘V / Ctrl+V while this tool is open, outside a text field.</span>
    {message && <p role="status" style={{fontSize:12,color:'#475569'}}>{message}</p>}
  </div>;
}
