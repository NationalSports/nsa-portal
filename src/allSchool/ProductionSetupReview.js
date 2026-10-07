import { DecoOverlay } from '../lib/decoOverlay';
import PersonalizationOverlay from '../lib/personalizationOverlay';
import React, { useState } from 'react';
export const productionSetupError = (item, transfers = [], art = []) => {
  if (!item.product_id || !item.sku) return 'Link the exact blank garment and SKU first.';
  if (!item.image_url) return 'Create and save this offering’s garment mockup in its Catalog art editor before approving production.';
  const codes = [...new Set([...(item.transfer_codes || []), item.transfer_code].filter(Boolean))];
  for (const code of codes) {
    const design = transfers.find((t) => t.code === code);
    if (!design?.production_file?.bucket || !design?.production_file?.path || !/\.ai$/i.test(design.production_file.name || design.production_file.path) || !(Number(design.width_in) > 0) || !(Number(design.height_in) > 0)) return `Decoration ${design?.label || code} needs its exact production .ai file and print dimensions.`;
  }
  for (const decoration of item.decorations || []) {
    if (!decoration || ['perso_name', 'perso_number'].includes(decoration.kind) || decoration.transfer_code && codes.includes(decoration.transfer_code)) continue;
    if (!decoration.art_id && !decoration.art_file_id && !decoration.art_url) return 'Every decoration needs its linked, approved production artwork before approval.';
    const file = art.find((a) => a.id === (decoration.art_id || decoration.art_file_id));
    const sources = [...(file?.prod_files || []), ...(file?.files || [])];
    if (!file || !['approved', 'art_complete'].includes(file.status) || !sources.some((f) => (typeof f === 'string' ? [f] : [f.name, f.url]).filter(Boolean).some((value) => /\.(ai|eps|pdf|dst)(\?|$)/i.test(value)))) return 'Every nonstock logo needs approved production art in Art & Logos.';
    if ((decoration.type || file.deco_type) === 'dtf') return 'Choose the exact DTF decoration-stock design for this logo before approval.';
  }
  if (item.takes_name) {
    const t = item.personalization_template;
    if (!t?.font || !t?.print_color || !t?.placement || !(Number(t.width_in) > 0) || !(Number(t.height_in) > 0) || !t.production_file?.bucket || !t.production_file?.path || !/\.ai$/i.test(t.production_file.name || t.production_file.path) || !Number.isFinite(Number(t.unit_cost)) || Number(t.unit_cost) < 0) return 'Name personalization needs its exact .ai template, font, color, dimensions, placement and unit cost.';
  }
  if (item.takes_number) {
    const sets = item.num_transfer_sets?.length ? item.num_transfer_sets : item.num_transfer_size ? [`${item.num_transfer_size}|${item.num_transfer_color || ''}`] : [];
    if (!sets.length) {
      const t = item.personalization_template?.number_template;
      if (!t?.font || !t?.print_color || !t?.placement || !(Number(t.width_in) > 0) || !(Number(t.height_in) > 0) || !t.production_file?.bucket || !t.production_file?.path || !/\.ai$/i.test(t.production_file.name || t.production_file.path) || !Number.isFinite(Number(t.unit_cost)) || Number(t.unit_cost) < 0) return 'Custom numbers need their own exact .ai template, font, print color, dimensions, placement and unit cost.';
    }
    for (const set of sets) {
      const [size, color] = set.split('|');
      for (let digit = 0; digit <= 9; digit++) {
        const matches = transfers.filter((t) => t.kind === 'number' && String(t.digit) === String(digit) && (t.tsize || t.size || '') === size && (t.color || '') === color);
        if (matches.length !== 1) return `Number set ${set} needs one exact stock record for digit ${digit}.`;
        const t = matches[0];
        if ((t.decoration_type || 'dtf') === 'dtf' && (!t.production_file?.bucket || !t.production_file?.path || !/\.ai$/i.test(t.production_file.name || t.production_file.path) || !(Number(t.width_in) > 0) || !(Number(t.height_in) > 0))) return `DTF digit ${digit} in ${set} needs its exact .ai file and dimensions in Inventory.`;
      }
    }
  }
  return '';
};
export default function ProductionSetupReview({ item, stock, transfers, art, staffId, onSave, onClose }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const blocked = productionSetupError(item, transfers, art);
  const approve = async () => {
    if (blocked || !staffId) return setError(blocked || 'A signed-in staff identity is required for approval.');
    if (!window.confirm('Approve this exact garment, artwork, placement and personalization setup for production? Changes to the setup will require approval again.')) return;
    setBusy(true);
    try { const ok = await onSave(item.id, { production_approved_at: new Date().toISOString(), production_approved_by: String(staffId) }); if (ok !== false) onClose(); } finally { setBusy(false); }
  };
  return <div role="dialog" aria-label="Review exact production setup" className="card" style={{ padding: 20 }}><h3 style={{ marginTop: 0 }}>Review production setup · {item.display_name || stock?.name || item.sku}</h3><p style={{ fontSize: 13 }}>Blank: <b>{item.sku}</b> · {stock?.color || item.variant_label || 'Catalog color'} · Offered sizes: {(item.sizes_offered || stock?.available_sizes || []).join(', ') || 'Catalog size scale'}</p><div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
      {['front', ...((item.takes_name || item.takes_number || (item.decorations || []).some((d) => d.side === 'back')) ? ['back'] : [])].map((side) => {
        const image = side === 'front' ? item.image_url || stock?.image_front_url : item.image_back_url || stock?.image_back_url;
        return <figure key={side} style={{ margin: 0, width: 240 }}><div style={{ position: 'relative', aspectRatio: '4/5', background: '#f1f5f9', borderRadius: 8, overflow: 'hidden' }}>{image ? <img src={image} alt={`Exact ${side} garment mockup`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : <div style={{ padding: 24 }}>Back garment image not supplied</div>}<DecoOverlay decorations={item.decorations} side={side} colorName={stock?.color} />{side === 'back' && <PersonalizationOverlay takesName={item.takes_name} takesNumber={item.takes_number} decorations={item.decorations} />}</div><figcaption style={{ fontSize: 12, marginTop: 5 }}>{side === 'front' ? 'Front placement' : 'Back / personalized text placement reference'}</figcaption></figure>;
      })}
    </div><div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>{(item.decorations || []).filter((d) => d.art_url).map((d, i) => <figure key={i} style={{ margin: 0 }}><img src={d.art_url} alt={`Production logo at ${d.placement || d.side || 'front'}`} style={{ width: 120, height: 120, objectFit: 'contain', background: '#f8fafc' }} /><figcaption style={{ fontSize: 12 }}>{d.placement || d.side || 'front'} · {d.type || 'Library method'}{d.transfer_code && ` · ${d.transfer_code}`}</figcaption></figure>)}</div><ul>{[...(item.transfer_codes || []), ...(item.transfer_code ? [item.transfer_code] : [])].map((code) => { const t = transfers.find((row) => row.code === code); return <li key={code}>{t?.label || code} · {t?.width_in} × {t?.height_in} in · {t?.production_file?.name || 'Production file missing'} · {t?.application_method || 'heat_press'}</li>; })}</ul>{item.takes_name && <p style={{ fontSize: 13 }}>Name template (use the .ai template for exact font/color; the mock shows placement): {item.personalization_template?.font || 'Missing'} · {item.personalization_template?.print_color} · {item.personalization_template?.width_in} × {item.personalization_template?.height_in} in · {item.personalization_template?.placement} · {item.personalization_template?.production_file?.name || 'File missing'}</p>}{item.takes_number && <p style={{ fontSize: 13 }}>Numbers: {(item.num_transfer_sets || []).join(', ') || (item.personalization_template?.number_template ? `${item.personalization_template.number_template.font} · ${item.personalization_template.number_template.print_color} · ${item.personalization_template.number_template.width_in} × ${item.personalization_template.number_template.height_in} in · ${item.personalization_template.number_template.placement} · ${item.personalization_template.number_template.production_file?.name || 'File missing'}` : 'Custom number template missing')}</p>}{item.production_approved_at && <p style={{ fontSize: 12, color: '#15803d' }}>Approved {new Date(item.production_approved_at).toLocaleString()} by {item.production_approved_by}</p>}{(blocked || error) && <p role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{error || blocked}</p>}<button className="btn btn-primary" disabled={busy || !!blocked || !staffId} onClick={approve}>Approve current setup</button> <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Close review</button></div>;
}
