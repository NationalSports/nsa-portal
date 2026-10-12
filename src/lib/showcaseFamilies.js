// Shared catalog identity: a supplier style, not a logo or color row.
const FAMILY_VERSION = 'showcase-color-design-v2';
const compact = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function baseStyle(item) {
  const sku = String(item.supplier_sku || item.sku || '').trim();
  const color = compact(item.color);
  // Strip a complete color suffix, including supplier punctuation (JET-BLACK).
  if (color) {
    for (let i = 1; i < sku.length; i++) {
      if (/[-_ ]/.test(sku[i]) && compact(sku.slice(i + 1)) === color) return compact(sku.slice(0, i));
    }
  }
  return '';
}
function familyKey(item) {
  if (item.kind === 'bundle') return `bundle:${item.webstore_product_id}`;
  const style = baseStyle(item);
  const supplier = [compact(item.vendor_id),compact(item.brand)].filter(Boolean).join(':');
  if (style && supplier) return `style:${supplier}:${style}`;
  return item.school_style_group_id ? `school:${item.school_style_group_id}`
    : item.variant_group_id ? `variant:${item.variant_group_id}` : `item:${item.webstore_product_id}`;
}
function groupShowcaseItems(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = familyKey(item);
    if (!groups.has(key)) groups.set(key, { key, name: item.name, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    colors: [...new Set(group.items.map((item) => item.color).filter(Boolean))],
    designs: [...new Set(group.items.map((item) => item.variant_group_id || JSON.stringify((item.decorations || []).map((d) => d.art_id || d.art_url))))].length,
    working: group.items.some(({ asset }) => ['queued', 'generating'].includes(asset?.status)),
    eligible: group.items.some((item) => item.kind !== 'bundle' && item.supplier_image_url),
  }));
}
function needsFamilyGeneration(group) {
  return group.eligible && !group.working && group.items.some(({ asset, decorations }) => !asset
    || asset.family_version !== FAMILY_VERSION || asset.needs_regeneration
    || (asset.qa_result?.renderer_version !== 'color-design-v1' && ((decorations || []).some(d => d.side !== 'back' && d.placement !== 'full_back') && !['original-srgb-v1','source-hue-relief-v2'].includes(asset.qa_result?.artwork_color_policy)))
    || (asset.qa_result?.renderer_version !== 'color-design-v1' && (decorations || []).filter(d => d.side !== 'back' && d.placement !== 'full_back').length > (asset.qa_result?.detail_images || []).length)
    || !['approved', 'review'].includes(asset.status) || asset.approval_status === 'rejected');
}
module.exports = { FAMILY_VERSION, baseStyle, familyKey, groupShowcaseItems, needsFamilyGeneration };
