import React, { useState } from 'react';
import { uploadProductionArtwork } from './productionArtwork';
const blankSpec = () => ({ font: '', print_color: '', width_in: '', height_in: '', placement: 'upper_back', max_length: 20, uppercase: true, supplier_id: '', unit_cost: 0 });
const validSpec = (spec, file) => spec.font?.trim() && spec.print_color?.trim() && spec.placement?.trim() && Number(spec.width_in) > 0 && Number(spec.height_in) > 0 && Number(spec.max_length) >= 1 && Number.isFinite(Number(spec.unit_cost)) && Number(spec.unit_cost) >= 0 && (file || spec.production_file?.path && spec.production_file?.bucket);
const saveSpec = (s, production_file) => ({ ...s, width_in: Number(s.width_in), height_in: Number(s.height_in), max_length: Math.max(1, Math.floor(Number(s.max_length))), unit_cost: Number(s.unit_cost) || 0, supplier_id: s.supplier_id?.trim() || null, production_file });
export default function PersonalizationTemplate({ item, onSave, onClose }) {
  const current = item.personalization_template || {};
  const hasDigitStock = !!(item.num_transfer_sets?.length || item.num_transfer_size);
  const [mode, setMode] = useState(item.takes_number && !hasDigitStock && !item.takes_name ? 'numbers' : 'names');
  const [nameSpec, setNameSpec] = useState(() => ({ ...blankSpec(), ...current }));
  const [numberSpec, setNumberSpec] = useState(() => ({ ...blankSpec(), max_length: 4, ...(current.number_template || (item.takes_number && !hasDigitStock && !item.takes_name ? current : {})) }));
  const [namesEnabled, setNamesEnabled] = useState(!!item.takes_name);
  const [numbersEnabled, setNumbersEnabled] = useState(!!item.takes_number && !hasDigitStock);
  const [nameFile, setNameFile] = useState(null); const [numberFile, setNumberFile] = useState(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const spec = mode === 'names' ? nameSpec : numberSpec;
  const setSpec = mode === 'names' ? setNameSpec : setNumberSpec;
  const field = (key, label, type = 'text') => <label style={{ fontSize: 12, display: 'grid', gap: 5 }}>{label}<input className="form-input" type={type} value={spec[key] ?? ''} min={type === 'number' ? key === 'unit_cost' ? 0 : 1 : undefined} step={type === 'number' ? '.01' : undefined} onChange={(e) => setSpec((s) => ({ ...s, [key]: e.target.value }))} /></label>;
  const submit = async () => {
    if (namesEnabled && !validSpec(nameSpec, nameFile)) return setError('Names need their own font, print color, placement, dimensions, nonnegative unit cost, text limit and production .ai template.');
    if (numbersEnabled && !validSpec(numberSpec, numberFile)) return setError('Custom numbers need their own font, print color, placement, dimensions, nonnegative unit cost, text limit and production .ai template.');
    setBusy(true); setError('');
    try {
      const nameArt = nameFile ? await uploadProductionArtwork(nameFile) : nameSpec.production_file || null;
      const numberArt = numberFile ? await uploadProductionArtwork(numberFile) : numberSpec.production_file || null;
      const { number_template: previousNumber, ...nameOnly } = nameSpec;
      const { number_template: ignoredNested, ...numberOnly } = numberSpec;
      const template = { ...saveSpec(nameOnly, nameArt), number_template: saveSpec(numberOnly, numberArt) };
      const fields = { takes_name: namesEnabled, takes_number: numbersEnabled || (hasDigitStock && !!item.takes_number), personalization_template: template };
      if (numbersEnabled) { fields.num_transfer_sets = []; fields.num_transfer_size = null; fields.num_transfer_color = null; }
      const ok = await onSave(item.id, fields);
      if (ok === false) throw new Error('Template was not saved.');
      onClose();
    } catch (e) { setError(e.message || 'Could not save template.'); } finally { setBusy(false); }
  };
  return <div role="dialog" aria-label="Personalization production templates" className="card" style={{ padding: 20 }}>
    <h3 style={{ marginTop: 0 }}>Personalization templates · {item.display_name || item.sku}</h3>
    <p style={{ color: '#64748b', fontSize: 13 }}>Names and custom numbers have separate exact .ai templates and print specifications. Customer text is supplied in the production manifest; source files are preserved.</p>
    <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}><label style={{ fontSize: 13 }}><input type="checkbox" checked={namesEnabled} onChange={(e) => setNamesEnabled(e.target.checked)} /> Enable names</label><label style={{ fontSize: 13 }}><input type="checkbox" checked={numbersEnabled} onChange={(e) => setNumbersEnabled(e.target.checked)} /> Enable custom DTF numbers</label></div>
    {hasDigitStock && <p style={{ fontSize: 12, color: '#64748b' }}>This offering currently uses stocked digits. Enabling custom DTF numbers replaces that number-set selection. Leaving custom numbers off preserves the existing digit-stock choice.</p>}
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}><button className={`btn btn-sm ${mode === 'names' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('names')}>Edit names</button><button className={`btn btn-sm ${mode === 'numbers' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('numbers')}>Edit custom numbers</button></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>{field('font', 'Font')}{field('print_color', 'Print color')}{field('width_in', 'Print width (in)', 'number')}{field('height_in', 'Print height (in)', 'number')}{field('placement', 'Placement')}{field('max_length', 'Maximum text length', 'number')}{field('unit_cost', 'DTF cost per print ($)', 'number')}{field('supplier_id', 'Supplier override (existing vendor name)')}<label style={{ fontSize: 12 }}>Production .ai template<input key={mode} type="file" accept=".ai" onChange={(e) => (mode === 'names' ? setNameFile : setNumberFile)(e.target.files?.[0] || null)} />{spec.production_file && <div style={{ marginTop: 6 }}>Current: {spec.production_file.name}</div>}{(mode === 'names' ? nameFile : numberFile) && <div>Selected: {(mode === 'names' ? nameFile : numberFile).name}</div>}</label><label style={{ fontSize: 12 }}><input type="checkbox" checked={!!spec.uppercase} onChange={(e) => setSpec((s) => ({ ...s, uppercase: e.target.checked }))} /> Uppercase text</label></div>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}<div style={{ marginTop: 14 }}><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save personalization templates'}</button> <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button></div>
  </div>;
}
