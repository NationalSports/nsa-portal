import { hasSchoolMockup, methodSetupError, STOCK_METHODS } from './methodReadiness.shared';
import React, { useEffect, useState } from 'react';
import { logoOptionsForItem } from './adminHelpers';
import ProductionSetupReview from './ProductionSetupReview';

export default function SchoolLogoOptionsEditor({ item, catalog = [], logoOptions = [], firstLogoByStyle = {}, onSetFirst, transfers = [], art = [], stockByWp = {}, staffId, selectedLogoId, onCreate, onUpdate, onSaveItem, onEdit }) {
  const [open, setOpen] = useState(false);
  const [currentName, setCurrentName] = useState(item.school_design_label || 'Original logo');
  const [newName, setNewName] = useState('');
  const [logoId, setLogoId] = useState(selectedLogoId || '');
  const [designCode, setDesignCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [labelEdits, setLabelEdits] = useState({});
  const [reviewItem, setReviewItem] = useState(null);
  useEffect(() => { if (selectedLogoId) { setLogoId(selectedLogoId); setDesignCode(''); setNewName(logoOptions.find((row) => row.id === selectedLogoId)?.name?.slice(0, 80) || ''); } }, [selectedLogoId]);
  const choices = logoOptionsForItem(catalog, item);
  const defaultChoice = choices.find(({ key, colors }) => key === firstLogoByStyle[item.school_style_group_id] && colors.every((color) => color.active !== false))?.key || choices.find(({ colors }) => colors.some((color) => color.active !== false))?.key;
  const readyDesigns = transfers.filter((row) => row.kind === 'design' && STOCK_METHODS.includes(row.decoration_type || 'dtf') && row.application_method);
  const selectedLogo = logoOptions.find((row) => row.id === logoId);
  const nonDtf = selectedLogo?.deco_type === 'embroidery';
  const productionFiles = [...(selectedLogo?.prod_files || []), ...(selectedLogo?.files || [])];
  const readyArt = nonDtf && productionFiles.some((file) => /\.dst(?:\?|$)/i.test(typeof file === 'string' ? file : file.url || '') || (file?.url && /\.dst$/i.test(file.name || '')));
  const add = async () => {
    const stock = readyDesigns.find((row) => row.code === designCode);
    const logo = logoOptions.find((row) => row.id === logoId);
    if (!currentName.trim() || !newName.trim() || !logo?.url) return setMessage('Name both logos and choose the artwork.');
    if (choices.some((choice) => choice.row.school_design_label?.trim().toLowerCase() === newName.trim().toLowerCase())) return setMessage('This item already has a logo choice with that name.');
    setBusy(true);
    try {
      const createdId = await onCreate(item, currentName.trim(), newName.trim(), stock || null, logo);
      if (!createdId) return setMessage('The logo choice could not be saved. Check the store message above and try again.');
      setMessage('Logo choice added. Save its mockup to add it to the store. Production requirements are checked at launch.');
      setOpen(false);
      setNewName(''); setLogoId(''); setDesignCode('');
      onEdit?.(createdId, 'art');
    } finally { setBusy(false); }
  };
  return <section aria-label="Logo choices for this item" style={{ border: '1px solid #dbe3ef', borderRadius: 12, padding: 16, marginBottom: 18, background: '#fff' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div><h3 style={{ margin: 0, fontSize: 17 }}>Logo choices for this item</h3><p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Saved mockups appear in the store automatically. Choose which logo shows first here. Drag the color thumbnails under the garment preview to choose that logo’s first color.</p></div>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => { if (!open && !newName.trim() && selectedLogo?.name) setNewName(selectedLogo.name.slice(0, 80)); setOpen((value) => !value); }}>{open ? 'Cancel' : '+ Add logo option'}</button>
    </div>
    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      {choices.map(({ key, row, colors }) => { const visualReady = colors.every(hasSchoolMockup); const live = colors.every((color) => color.active !== false); const nextReview = colors.find((color) => methodSetupError(color, transfers, art)); return <div key={key} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '7px 9px', background: '#f1f5f9', borderRadius: 7, fontSize: 12 }}>
        <input aria-label={`Name for ${row.school_design_label || 'original logo'}`} className="form-input" style={{ width: 175 }} value={labelEdits[key] ?? row.school_design_label ?? 'Original logo'} onChange={(e) => setLabelEdits((edits) => ({ ...edits, [key]: e.target.value }))} />
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy || !labelEdits[key]?.trim() || labelEdits[key].trim() === row.school_design_label} onClick={async () => { setBusy(true); try { if (await onUpdate(row, { school_design_label: labelEdits[key].trim() })) { setMessage('Logo name updated for every color.'); setLabelEdits((edits) => { const next = { ...edits }; delete next[key]; return next; }); } } finally { setBusy(false); } }}>Save name</button>
        <span style={{ color: '#64748b' }}>{colors.length} color{colors.length === 1 ? '' : 's'} · {live ? 'shown in store' : visualReady ? 'hidden' : 'save mockup'}</span>
        {choices.length > 1 && (key === defaultChoice ? <b style={{ color: '#166534' }}>Shows first</b> : <button type="button" className="btn btn-sm btn-secondary" disabled={busy || !visualReady || !live || !onSetFirst} title={!visualReady || !live ? 'Save the mockup and show this choice first' : ''} onClick={async () => { setBusy(true); try { if (await onSetFirst(row)) setMessage('This logo now shows first on the customer preview. Its first color leads the image.'); else setMessage('Save the mockup for this logo choice first.'); } finally { setBusy(false); } }}>Show first</button>)}
        {nextReview && onSaveItem && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setReviewItem(nextReview)}>Launch requirements</button>}
        {row.id !== item.id && <button type="button" className="btn btn-sm btn-secondary" onClick={() => onEdit?.(row.id, 'art')}>Edit mockups</button>}
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy || (!visualReady && !live)} onClick={async () => { setBusy(true); try { if (await onUpdate(row, { active: !live })) setMessage(live ? 'Logo choice hidden from shoppers.' : 'Logo choice is live for shoppers.'); } finally { setBusy(false); } }}>{live ? 'Hide from store' : 'Show in store'}</button>
      </div>; })}
    </div>
    {open && <div style={{ marginTop: 15, padding: 14, background: '#f8fafc', borderRadius: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
        <label style={{ fontSize: 12 }}>Current logo name<input className="form-input" value={currentName} maxLength={80} onChange={(e) => setCurrentName(e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>New logo name<input className="form-input" value={newName} maxLength={80} placeholder="Arched Serra" onChange={(e) => setNewName(e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>New web logo<select className="form-select" value={logoId} onChange={(e) => { setLogoId(e.target.value); setDesignCode(''); const selected = logoOptions.find((row) => row.id === e.target.value); if (!newName.trim() && selected?.name) setNewName(selected.name.slice(0, 80)); }}><option value="">Choose saved logo…</option>{logoOptions.filter((logo) => logo.deco_type !== 'screen_print').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        {!nonDtf && <label style={{ fontSize: 12 }}>Production inventory (optional now)<select className="form-select" value={designCode} onChange={(e) => setDesignCode(e.target.value)}><option value="">Choose exact DTF design…</option>{readyDesigns.map((row) => <option key={row.id} value={row.code}>{row.label} · {row.production_file?.name || row.decoration_type || 'Design'}</option>)}</select></label>}
      </div>
      {logoOptions.find((row) => row.id === logoId)?.url && <img src={logoOptions.find((row) => row.id === logoId).url} alt="Selected new logo" style={{ width: 110, height: 85, objectFit: 'contain', background: '#fff', marginTop: 10 }} />}
      {nonDtf && <p style={{ fontSize: 12, color: readyArt ? '#166534' : '#b91c1c' }}>{readyArt ? 'Embroidery file attached.' : 'Attach the embroidery DST file before launching the store.'}</p>}
      {!nonDtf && (!logoOptions.length || !readyDesigns.length) && <p style={{ fontSize: 12, color: '#64748b' }}>Inventory and application details can be completed before store launch.</p>}
      <p style={{ fontSize: 12, color: '#64748b' }}>Copies this item’s colors and prices. Save the mockup to add this choice to the store automatically.</p>
      <button type="button" className="btn btn-sm btn-primary" disabled={busy || !currentName.trim() || !newName.trim() || !logoId} onClick={add}>{busy ? 'Adding…' : 'Create logo choice'}</button>
    </div>}
    {message && <p role="status" style={{ fontSize: 12, color: '#334155', marginBottom: 0 }}>{message}</p>}
    {reviewItem && <div style={{ marginTop: 14 }}><ProductionSetupReview key={reviewItem.id} item={catalog.find((row) => row.id === reviewItem.id) || reviewItem} stock={stockByWp[reviewItem.id]} transfers={transfers} art={art} staffId={staffId} onSave={onSaveItem} onClose={() => setReviewItem(null)} /></div>}
  </section>;
}
