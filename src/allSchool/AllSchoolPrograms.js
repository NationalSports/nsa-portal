import ProductionSetupReview from './ProductionSetupReview';
import PersonalizationTemplate from './PersonalizationTemplate';
import React, { useState } from 'react';
import { cloudUpload } from '../utils';
import { normalizeAllSchoolSettings, validateAllSchoolSettings, coreOfferingCopies, applySportDesign } from './adminHelpers';
const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export default function AllSchoolPrograms({ store, catalog, stockByWp = {}, transfers = [], logoOptions = [], artLibrary = [], staffId, onSaveSettings, onUpdateItem, onCopyOfferings }) {
  const [settings, setSettings] = useState(() => normalizeAllSchoolSettings(store.all_school_settings));
  const [selected, setSelected] = useState([]); const [target, setTarget] = useState('');
  const [artMode, setArtMode] = useState('keep'); const [designCode, setDesignCode] = useState(''); const [logoId, setLogoId] = useState('');
  const [personalizationItem, setPersonalizationItem] = useState(null); const [approvalItem, setApprovalItem] = useState(null);
  const [preview, setPreview] = useState(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const programs = normalizeAllSchoolSettings(store.all_school_settings).programs;
  const orderedPrograms = [...settings.programs].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const sportsDirty = JSON.stringify(settings.programs) !== JSON.stringify(programs);
  const changeProgram = (id, patch) => setSettings((s) => ({ ...s, programs: s.programs.map((p) => p.id === id ? { ...p, ...patch } : p) }));
  const moveProgram = (id, offset) => setSettings((s) => { const list = [...s.programs].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)); const from = list.findIndex((p) => p.id === id); const to = from + offset; if (from < 0 || to < 0 || to >= list.length) return s; [list[from], list[to]] = [list[to], list[from]]; return { ...s, programs: list.map((p, i) => ({ ...p, sort_order: i })) }; });
  const uploadProgramImage = async (id, file) => { if (!file) return; setBusy(true); try { const url = await cloudUpload(file, 'nsa-webstores'); changeProgram(id, { image_url: url }); setMessage('Image ready. Save sports to publish it.'); } catch (error) { setMessage(`Thumbnail upload failed: ${error.message}`); } finally { setBusy(false); } };
  const persist = async () => {
    const error = validateAllSchoolSettings(settings); if (error) return setMessage(error);
    const removed = programs.filter((p) => !settings.programs.some((next) => next.id === p.id));
    if (removed.some((p) => catalog.some((c) => (c.school_program_ids || []).includes(p.id)))) return setMessage('Remove product assignments before deleting a sport, or disable the sport instead.');
    setBusy(true); try { const ok = await onSaveSettings(settings); if (ok) setMessage('Sports saved.'); } finally { setBusy(false); }
  };
  const core = catalog.filter((c) => c.kind === 'single' && !c.school_template_id && !(c.school_program_ids || []).length);
  const previewCopy = () => {
    setMessage('');
    if (!programs.some((p) => p.id === target)) return setMessage('Save a sport, then choose it as the destination.');
    let rows = coreOfferingCopies(core.filter((c) => selected.includes(c.id)), target, store.id, catalog);
    if (artMode === 'replace') {
      const stock = transfers.find((t) => t.code === designCode); const logo = logoOptions.find((l) => l.id === logoId);
      if (!stock?.production_file?.path || !stock?.production_file?.bucket || !/\.ai$/i.test(stock.production_file.name || stock.production_file.path) || !(Number(stock.width_in) > 0) || !(Number(stock.height_in) > 0)) return setMessage('Choose a saved DTF design with its exact .ai file and dimensions. Configure it in Inventory → Decoration stock first.');
      if (!logo?.url) return setMessage('Choose an existing web logo from Art & Logos for the sport design preview.');
      rows = applySportDesign(rows, stock, logo);
    }
    setPreview(rows);
  };
  const replaceOfferingDesign = async (item) => {
    const stock = transfers.find((t) => t.code === designCode); const logo = logoOptions.find((l) => l.id === logoId);
    if (artMode !== 'replace' || !stock?.production_file?.path || !stock?.production_file?.bucket || !(Number(stock.width_in) > 0) || !(Number(stock.height_in) > 0) || !logo?.url) return setMessage('Choose the exact saved sport production design and web logo above before applying it to an existing offering.');
    if (!window.confirm(`Replace the artwork on ${item.display_name || item.sku} with ${stock.label} (${stock.production_file.name}, ${stock.width_in} × ${stock.height_in} in)? Old mockup images are cleared; price and personalization are preserved. All colors in this card receive this exact design.`)) return;
    const next = applySportDesign([item], stock, logo)[0];
    setBusy(true);
    try { const ok = await onUpdateItem(item.id, { transfer_codes: next.transfer_codes, transfer_code: null, decorations: next.decorations, image_url: null, image_back_url: null }); if (ok !== false) setMessage('Exact sport design applied. Review its placement in Art & Logos.'); } finally { setBusy(false); }
  };
  const confirmCopy = async () => { setBusy(true); try { const ok = await onCopyOfferings(preview); if (ok) { setPreview(null); setSelected([]); setMessage('Sport offerings created. Open them in Catalog to customize artwork and pricing.'); } } finally { setBusy(false); } };
  const name = (c) => c.display_name || stockByWp[c.id]?.name || c.sku || 'Item';
  return <div style={{ display: 'grid', gap: 20 }}>
    {message && <div role="status" style={{ padding: 12, background: '#f1f5f9', borderRadius: 8 }}>{message}</div>}
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div><h3 style={{ margin: 0 }}>Categories</h3><p style={{ fontSize: 13, color: '#64748b', margin: '5px 0 0' }}>Add a sport by name. Its tile uses school-colored text until you add a photo.</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setSettings((s) => ({ ...s, programs: [...s.programs, { id: crypto.randomUUID(), name: '', slug: '', image_url: '', sort_order: s.programs.length, enabled: true }] }))}>+ Add category</button><button className="btn btn-primary" disabled={busy || !sportsDirty} onClick={persist}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      </div>
      {sportsDirty && <p role="status" style={{ color: '#a16207', fontSize: 12, margin: '12px 0' }}>Unsaved category changes</p>}
      <div style={{ display: 'grid', gap: 14, marginTop: 15 }}>
      {orderedPrograms.map((p, i) => <div key={p.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 16, padding: 14, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}>
        <div style={{ position: 'relative', aspectRatio: '4/3', overflow: 'hidden', borderRadius: 6, background: store.primary_color || '#123976', color: '#fff' }}>
          {p.image_url ? <img src={p.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 8, fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontStyle: 'italic', fontSize: 'clamp(28px,3vw,48px)', lineHeight: .95, textAlign: 'center', textTransform: 'uppercase', overflowWrap: 'anywhere' }}>{p.name || 'SPORT'}</span>}
          <b style={{ position: 'absolute', bottom: 8, left: 10, fontSize: 12, textTransform: 'uppercase', textShadow: '0 1px 3px #000' }}>{p.name || 'New sport'}</b>
        </div>
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Category name<input className="form-input" value={p.name} placeholder="Football" onChange={(e) => changeProgram(p.id, { name: e.target.value, slug: !p.slug || p.slug === slug(p.name) ? slug(e.target.value) : p.slug })} /></label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>Upload photo<input className="form-input" type="file" accept="image/*" aria-label={`Upload ${p.name || 'sport'} thumbnail`} disabled={busy} onChange={async (e) => { const file = e.target.files?.[0]; await uploadProgramImage(p.id, file); e.target.value = ''; }} /></label>
            {p.image_url && <button type="button" className="btn btn-sm btn-secondary" onClick={() => changeProgram(p.id, { image_url: '' })}>Use styled text</button>}
            <span style={{ fontSize: 11, color: '#64748b' }}>{p.image_url ? 'Photo tile · 4:3 crop' : 'Automatic text tile'}</span>
          </div>
          <details style={{ fontSize: 12 }}><summary style={{ cursor: 'pointer' }}>More options</summary><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}><label>Image URL<input className="form-input" value={p.image_url || ''} placeholder="Optional" onChange={(e) => changeProgram(p.id, { image_url: e.target.value })} /></label><label>URL slug<input className="form-input" value={p.slug || ''} onChange={(e) => changeProgram(p.id, { slug: slug(e.target.value) })} /></label></div></details>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-secondary" title="Move up" aria-label={`Move ${p.name || 'sport'} up`} disabled={i === 0} onClick={() => moveProgram(p.id, -1)}>↑</button><button className="btn btn-sm btn-secondary" title="Move down" aria-label={`Move ${p.name || 'sport'} down`} disabled={i === orderedPrograms.length - 1} onClick={() => moveProgram(p.id, 1)}>↓</button>
            <label style={{ marginLeft: 7, fontSize: 12 }}><input type="checkbox" checked={p.enabled !== false} onChange={(e) => changeProgram(p.id, { enabled: e.target.checked })} /> Show on store</label>
            <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setSettings((s) => ({ ...s, programs: s.programs.filter((row) => row.id !== p.id) }))}>Remove</button>
          </div>
        </div>
      </div>)}
      </div>
      {!orderedPrograms.length && <p style={{ fontSize: 13, color: '#64748b' }}>No categories yet. Add one to create its storefront tile.</p>}
    </div>
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ marginTop: 0 }}>Core assortment → sport offerings</h3>
      <p style={{ fontSize: 13, color: '#64748b' }}>Copy selected School Spirit products to a sport. The blank garment stays linked to the same inventory; each sport gets separate decoration, price, and personalization settings. Existing sport copies are skipped. Source products are preserved. To update an existing offering, choose the exact sport design below, then use its collection-table artwork control.</p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}><select className="form-select" value={target} onChange={(e) => { setTarget(e.target.value); setPreview(null); }}><option value="">Choose saved sport…</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="btn btn-secondary" disabled={!selected.length || busy} onClick={previewCopy}>Preview {selected.length} selected</button></div>
      <div style={{ padding: 12, background: '#f8fafc', borderRadius: 10, marginBottom: 12 }}>
        <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>Artwork for the new offerings<select className="form-select" value={artMode} onChange={(e) => { setArtMode(e.target.value); setPreview(null); }}><option value="keep">Keep the source artwork; customize in Art & Logos after copying</option><option value="replace">Use an exact sport DTF design + existing web logo</option></select></label>
        {artMode === 'replace' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Saved sport production design<select className="form-select" value={designCode} onChange={(e) => { setDesignCode(e.target.value); setPreview(null); }}><option value="">Choose decoration stock…</option>{transfers.filter((t) => t.kind === 'design' && (t.decoration_type || 'dtf') === 'dtf').map((t) => <option key={t.id} value={t.code}>{t.label} · {t.production_file?.name || 'production file missing'}</option>)}</select></label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Existing web logo for the preview<select className="form-select" value={logoId} onChange={(e) => { setLogoId(e.target.value); setPreview(null); }}><option value="">Choose from Art & Logos…</option>{logoOptions.map((logo) => <option key={logo.id} value={logo.id}>{logo.name}</option>)}</select></label>
          {logoOptions.find((logo) => logo.id === logoId)?.url && <img src={logoOptions.find((logo) => logo.id === logoId).url} alt="Selected sport web logo" style={{ width: 100, height: 100, objectFit: 'contain', background: '#fff', borderRadius: 8 }} />}
          <p style={{ fontSize: 12, color: '#64748b' }}>The selected design replaces source front/back art on each copy. Source mockup images are cleared so old art cannot remain baked in. Review fit and placement in Art & Logos before opening the store. Production uses the exact selected .ai file.</p>
        </div>}
      </div>
      {core.map((c) => <label key={c.id} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '5px 0' }}><input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, c.id] : s.filter((id) => id !== c.id))} />{name(c)} · {c.sku} · ${Number(c.retail_price || 0).toFixed(2)}</label>)}
      {!core.length && <p>Add School Spirit items in Catalog first.</p>}
      {preview && <div role="dialog" aria-label="Confirm sport offering copies" style={{ padding: 16, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, marginTop: 12 }}><b>{preview.length} new offerings for {programs.find((p) => p.id === target)?.name}</b><p style={{ fontSize: 13 }}>Prices are copied exactly. Artwork is shown below; review each new offering in Catalog and Art & Logos before opening the store.</p><ul>{preview.map((c) => <li key={c.school_template_id}>{c.display_name || c.sku} · {c.transfer_codes?.join(', ') || 'source artwork'} · {c.decorations?.length || 0} decoration(s) · ${Number(c.retail_price || 0).toFixed(2)}</li>)}</ul><button className="btn btn-primary" disabled={busy || !preview.length} onClick={confirmCopy}>Create these offerings</button> <button className="btn btn-secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button></div>}
    </div>
    <div className="card" style={{ padding: 20, overflowX: 'auto' }}>
      <h3 style={{ marginTop: 0 }}>Collection assignments</h3>
      <p style={{ fontSize: 13, color: '#64748b' }}>Assignments save immediately for the whole color card. No selected sport means School Spirit. “All sports” displays the same offering in every collection.</p>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}><thead><tr><th style={{ textAlign: 'left' }}>Offering</th><th>Personalization</th><th>Artwork</th><th>Production</th><th>All sports</th>{programs.map((p) => <th key={p.id}>{p.name}</th>)}</tr></thead><tbody>{catalog.map((c) => <tr key={c.id}><td style={{ padding: '10px 0' }}>{name(c)}<div style={{ fontSize: 11, color: '#64748b' }}>{c.sku}{c.school_template_id ? ' · sport copy' : ''}</div></td><td><button className="btn btn-sm btn-secondary" onClick={() => setPersonalizationItem(c)}>{c.personalization_template ? 'Edit templates' : 'Set up personalization'}</button></td><td><button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => replaceOfferingDesign(c)}>Use selected sport design</button></td><td><button className="btn btn-sm btn-secondary" onClick={() => setApprovalItem(c)}>{c.production_approved_at ? 'Review approved' : 'Review setup'}</button></td><td style={{ textAlign: 'center' }}><input aria-label={`Show ${name(c)} in all sports`} type="checkbox" checked={!!c.school_shared} onChange={(e) => onUpdateItem(c.id, { school_shared: e.target.checked })} /></td>{programs.map((p) => <td key={p.id} style={{ textAlign: 'center' }}><input aria-label={`${name(c)} in ${p.name}`} type="checkbox" checked={(c.school_program_ids || []).includes(p.id)} onChange={(e) => onUpdateItem(c.id, { school_program_ids: e.target.checked ? [...new Set([...(c.school_program_ids || []), p.id])] : (c.school_program_ids || []).filter((id) => id !== p.id) })} /></td>)}</tr>)}</tbody></table>
    </div>
    {approvalItem && <ProductionSetupReview key={approvalItem.id} item={approvalItem} stock={stockByWp[approvalItem.id]} transfers={transfers} art={artLibrary} staffId={staffId} onSave={onUpdateItem} onClose={() => setApprovalItem(null)} />}
    {personalizationItem && <PersonalizationTemplate key={personalizationItem.id} item={personalizationItem} onSave={onUpdateItem} onClose={() => setPersonalizationItem(null)} />}
  </div>;
}
