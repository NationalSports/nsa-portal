import React, { useState } from 'react';
import { uploadProductionArtwork } from './productionArtwork';
export const DECORATION_TYPES = [['dtf', 'DTF'], ['screen_print_transfer', 'Screen-print transfer'], ['chenille', 'Chenille'], ['embroidered_patch', 'Embroidered patch'], ['woven_patch', 'Woven patch'], ['sublimation_patch', 'Sublimated patch']];
export const APPLICATION_METHODS = [['heat_press', 'Heat press'], ['sew_on', 'Sew on'], ['heat_press_and_sew', 'Heat press + sew'], ['adhesive', 'Adhesive']];
export default function DecorationStockForm({ onAdd, onClose, initialValue }) {
  const [f, setF] = useState({ label: '', on_hand: 0, low_stock_threshold: 10, decoration_type: 'dtf', application_method: 'heat_press', supplier_id: '', width_in: '', height_in: '', artwork_version: '', application_instructions: '', ...(initialValue || {}) });
  const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (key, value) => setF((s) => ({ ...s, [key]: value }));
  const submit = async () => {
    if (!f.label.trim()) return;
    if (!Number.isInteger(Number(f.low_stock_threshold)) || Number(f.low_stock_threshold) < 0) return setError('Low-stock threshold must be a whole number of zero or more.');
    setBusy(true); setError('');
    try {
      const production_file = file ? await uploadProductionArtwork(file) : f.production_file || null;
      const code = `${f.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${crypto.randomUUID().slice(0, 8)}`;
      const result = await onAdd({ ...f, code: initialValue?.code || code, label: f.label.trim(), low_stock_threshold: Number(f.low_stock_threshold), kind: initialValue?.kind || 'design', on_hand: Math.max(0, Number(f.on_hand) || 0), supplier_id: f.supplier_id.trim() || null, width_in: Number(f.width_in) > 0 ? Number(f.width_in) : null, height_in: Number(f.height_in) > 0 ? Number(f.height_in) : null, artwork_version: f.artwork_version.trim() || null, production_file });
      if (result === false) throw new Error('Decoration stock was not saved. Please retry.');
      onClose();
    } catch (e) { setError(e.message || 'Could not save decoration stock.'); } finally { setBusy(false); }
  };
  const field = (key, label, type = 'text') => <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>{label}<input className="form-input" type={type} min={type === 'number' ? '0' : undefined} step={type === 'number' ? '.01' : undefined} value={f[key]} onChange={(e) => set(key, e.target.value)} /></label>;
  return <div className="card" style={{ padding: 16, marginBottom: 12 }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
    {field('label', 'Decoration stock name')}{field('on_hand', 'On hand', 'number')}{field('low_stock_threshold', 'Alert when available stock is below', 'number')}
    <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Inventory type<select className="form-select" value={f.decoration_type} onChange={(e) => set('decoration_type', e.target.value)}>{DECORATION_TYPES.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Application method<select className="form-select" value={f.application_method} onChange={(e) => set('application_method', e.target.value)}>{APPLICATION_METHODS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    {field('supplier_id', 'DTF supplier (existing vendor name)')}{field('width_in', 'Print width (in)', 'number')}{field('height_in', 'Print height (in)', 'number')}{field('artwork_version', 'Artwork version')}
    <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Production .ai file<input type="file" accept=".ai" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
    <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Application instructions<textarea className="form-input" value={f.application_instructions} onChange={(e) => set('application_instructions', e.target.value)} placeholder="Temperature, time, pressure, stitching…" /></label>
  </div>{f.production_file && <div style={{ marginTop: 10, fontSize: 12 }}>Production file: {f.production_file.name}</div>}<p style={{ fontSize: 12, color: '#64748b' }}>DTF requests require an exact .ai file and print dimensions. Files stay private and are fingerprinted to preserve the production version.</p>{error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}<button className="btn btn-primary" disabled={busy || !f.label.trim()} onClick={submit}>{busy ? 'Saving…' : initialValue ? 'Save decoration stock' : 'Add decoration stock'}</button> <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button></div>;
}
