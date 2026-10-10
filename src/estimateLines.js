// AI-extracted line items (from a customer email or an AI note) → estimate
// items. Shared by the AI inbox, AI Notes on desktop and AI Notes on the phone
// so a matched style is priced the same way everywhere.
import { auTierDisc, isAU, rQ } from './pricing';

// lines: [{ product_id?, sku_guess, brand, name, color, sizes: {S: 4}, notes }]
export function linesToEstimateItems(customer, lines, prod) {
  const mk = customer?.catalog_markup || 1.65;
  const catalog = prod || [];
  return (lines || []).map((line) => {
    const sku = String(line.sku_guess || '').trim();
    const product = line.product_id ? catalog.find((p) => p.id === line.product_id) : (sku ? catalog.find((p) => String(p.sku || '').toLowerCase() === sku.toLowerCase()) : null);
    const brand = product?.brand || line.brand || '';
    const au = isAU(brand) && !String(product?.id || '').startsWith('ssa-');
    const cost = product?.is_clearance && product?.clearance_cost != null ? product.clearance_cost : (product?.nsa_cost || 0);
    const retail = product?.retail_price || 0;
    const sell = au ? rQ(retail * (1 - auTierDisc(customer?.adidas_ua_tier || 'B', product?.pricing_group, product?.category))) : rQ(cost * mk);
    const sizes = line.sizes && Object.keys(line.sizes).length ? line.sizes : {};
    // No "CUSTOM" placeholder — an unmatched line keeps only the AI's style guess so the
    // rep has to confirm the real style number; the order editor won't save a line without one.
    return { product_id: product?.id || null, sku: product?.sku || sku, name: product?.name || line.name || '', brand, color: product?.color || line.color || '', vendor_id: product?.vendor_id || null, pricing_group: product?.pricing_group || null, nsa_cost: cost, retail_price: retail, unit_sell: sell, available_sizes: Object.keys(sizes).length ? Object.keys(sizes) : (product?.available_sizes || ['S', 'M', 'L', 'XL', '2XL']), sizes, decorations: [], is_custom: !product, notes: line.notes || '', pick_lines: [], po_lines: [] };
  });
}

// An approved AI note's garments, in the line shape above. Decoration and a
// total without a size breakdown ride on the line's note (shown on the estimate).
export function noteEstimateLines(note) {
  const f = note?.final || {};
  const src = Array.isArray(f.line_items) && f.line_items.length ? f.line_items : (note?.draft?.line_items || []);
  return src.filter((l) => l && l.name).map((l) => {
    const sizes = l.sizes && typeof l.sizes === 'object' ? l.sizes : {};
    const sized = Object.values(sizes).some((v) => Number(v) > 0);
    return {
      sku_guess: l.sku_guess || '', brand: l.brand || '', name: l.name, color: l.color || '', sizes: sized ? sizes : {},
      notes: [l.decoration || '', !sized && l.quantity ? l.quantity + ' total, sizes to confirm' : ''].filter(Boolean).join(' · '),
    };
  });
}
