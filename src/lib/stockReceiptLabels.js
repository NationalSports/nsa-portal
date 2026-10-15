// Use receipt deltas, never ordered or previously received totals, on carton labels.
export function buildStockReceiptLabel(po, receivedMap, scanBase, date = new Date().toLocaleDateString()) {
  const items = [];
  let units = 0;
  Object.entries(receivedMap || {}).forEach(([idx, quantities]) => {
    const item = po?.items?.[idx];
    if (!item) return;
    const sizes = Object.entries(quantities || {}).filter(([, qty]) => Number.isFinite(qty) && qty > 0);
    const qty = sizes.reduce((sum, [, value]) => sum + value, 0);
    if (!qty) return;
    units += qty;
    items.push({title: [item.sku, item.name].filter(Boolean).join(' '),
      detail: [item.color, qty + ' units'].filter(Boolean).join(' · '),
      sizes: sizes.map(([size, value]) => size + ': ' + value).join('  ')});
  });
  if (!items.length) return null;
  const code = po.po_number || po.id;
  return {code, subtitle: code, program: 'NSA STOCK',
    qrData: scanBase + '?scan=' + encodeURIComponent(code),
    note: 'RECEIVED — ' + date, noteStyle: 'color:#166534', items,
    codeSub: units + ' units · scan to open PO'};
}

// The generic app_state saver swallows failures; labels require an explicit acknowledgement.
export async function saveStockReceiptState(client, pos) {
  if (!client) return false;
  try {
    const value = JSON.stringify(pos);
    const {data, error} = await client.from('app_state').upsert({id: 'inv_pos', value,
      updated_at: new Date().toISOString()}, {onConflict: 'id'}).select('id,value');
    return !error && data?.some(row => row.id === 'inv_pos' && row.value === value) === true;
  } catch (_) { return false; }
}
