const norm = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

const sortedObject = (value) => {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = sortedObject(value[key]);
    return out;
  }, {});
};

const stableSignature = (value) => JSON.stringify(sortedObject(value));

// A sourcing SKU can legitimately appear in several colors. Color therefore stays
// in the identity while product_id does not: stale/duplicate catalog ids must not
// split one SKU/color into several purchasing lines.
export const storeSkuColorKey = (sku, color) => `${norm(sku)}\u00a7${norm(color)}`;

export const webstoreSourcingKey = (sku, color, vendorId) => `${storeSkuColorKey(sku, color)}\u00a7${norm(vendorId)}`;

// A webstore SO line is both a sourcing line and a production instruction. Two
// stale catalog ids may collapse only when the art, personalization, and transfer
// treatment are equivalent; otherwise combining them would apply one product's
// decoration to every garment in the merged line.
export function webstoreProductionKey({ sku, color, vendorId, decorations = [], personalize = {}, transferCodes = [] }) {
  const decoParts = decorations.map((d) => ({
    art_id: d?.art_id || '',
    art_url: d?.art_url || '',
    source_url: d?.source_url || '',
    placement: d?.placement || '',
    side: d?.side || '',
    color_label: d?.color_label || '',
    cw_by_color: d?.cw_by_color || null,
  })).map(stableSignature).sort();
  const production = {
    decorations: decoParts,
    takes_name: !!personalize.name,
    takes_number: !!personalize.num,
    transfer_codes: transferCodes.map(norm).filter(Boolean).sort(),
  };
  return `${webstoreSourcingKey(sku, color, vendorId)}\u00a7${stableSignature(production)}`;
}

// OMG product saves historically overlapped (insert-new, then delete-old), leaving
// several snapshots in the table. Collapse them without multiplying quantity,
// while still carrying disjoint size fragments (S on one row, M on another) into
// one sourcing line. For an overlapping size the newest row wins. The newest row
// also supplies editable metadata. Supplier remains part of the identity.
export function consolidateOmgProductRows(rows = []) {
  const groups = new Map();
  rows.forEach((row, order) => {
    if (!row) return;
    const key = webstoreSourcingKey(row.sku, row.color, row.vendor_id);
    const numericId = Number(row.id);
    const rank = Number.isFinite(numericId) && numericId > 0 ? numericId : order;
    let group = groups.get(key);
    if (!group) {
      group = { latest: row, latestRank: rank, sizes: new Map() };
      groups.set(key, group);
    } else if (rank >= group.latestRank) {
      group.latest = row;
      group.latestRank = rank;
    }
    Object.entries(row.sizes || {}).forEach(([size, qty]) => {
      const sizeKey = norm(size);
      const previous = group.sizes.get(sizeKey);
      if (!previous || rank >= previous.rank) group.sizes.set(sizeKey, { label: size, qty: Number(qty) || 0, rank });
    });
  });

  return [...groups.values()].map(({ latest, sizes: sizeRows }) => {
    const sizes = {};
    sizeRows.forEach(({ label, qty }) => { sizes[label] = qty; });
    return { ...latest, sizes };
  });
}
