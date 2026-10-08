import React from 'react';

export const artInventoryCode = (art) => `store-art-${encodeURIComponent(String(art.id))}`;
export const inventoryTypeForArt = (art) => {
  const type = String(art.decoration_type || art.deco_type || '').toLowerCase();
  if (['twill', 'patch', 'chenille', 'embroidered_patch', 'woven_patch', 'sublimation_patch', 'screen_print_transfer'].includes(type)) return type;
  // Existing library entries sometimes describe twill as DTF or screen print.
  if (/\btwill\b/i.test(art.name || '')) return 'twill';
  if (/\bpatch\b/i.test(art.name || '')) return 'patch';
  return 'dtf';
};
export const inventorySeedForArt = (art) => ({
  code: artInventoryCode(art), label: art.name || 'Store artwork',
  decoration_type: inventoryTypeForArt(art), application_method: art.application_method || 'heat_press',
  on_hand: 0, low_stock_threshold: 10,
  width_in: art.width_in || '', height_in: art.height_in || '',
  artwork_version: art.artwork_version || '',
  ...(art.production_file?.bucket && art.production_file?.path && art.production_file?.sha256 ? { production_file: art.production_file } : {}),
});
export default function StoreArtInventoryOptions({ artwork = [], transfers = [], onSelect }) {
  const unique = [...new Map(artwork.filter((art) => art?.id).map((art) => [art.id, art])).values()];
  if (!unique.length) return null;
  return <section className="card" style={{ padding: 16, marginBottom: 12 }} aria-label="Store artwork inventory options">
    <strong>Store artwork</strong>
    <p style={{ fontSize: 12, color: '#64748b', margin: '5px 0 12px' }}>Choose a logo to add its inventory details. Keep on hand at zero if you order as needed.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{unique.map((art) => {
      const saved = transfers.find((row) => row.kind === 'design' && row.code === artInventoryCode(art));
      return <button key={art.id} onClick={() => onSelect(art, saved)} style={{ width: 160, padding: 10, border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff', cursor: 'pointer', textAlign: 'left' }}>
        {art.url && <img src={art.url} alt="" style={{ width: '100%', height: 85, objectFit: 'contain' }} />}
        <div style={{ fontWeight: 700, marginTop: 6 }}>{art.name || 'Store artwork'}</div>
        <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{saved ? `${Number(saved.on_hand) || 0} on hand · Edit inventory` : '+ Add to inventory'}</div>
      </button>;
    })}</div>
  </section>;
}
