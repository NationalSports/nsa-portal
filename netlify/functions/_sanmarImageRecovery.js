// Discover current supplier media only after a stored SanMar image fails.
// One lookup per style in a generation job; never guess CDN filenames or colors.
const discovery = require('./_background-workers/sanmar-flat-images-background')._internal;
function createSanMarImageRecovery(members, fetchImage, deps = discovery) {
  const styles = new Map();
  let config;
  return async function recover(member) {
    let host = '';
    try { host = new URL(member.supplier_image_url).hostname.toLowerCase(); } catch (_) {}
    if (!['cdnm.sanmar.com','cdnp.sanmar.com'].includes(host) && !(!member.supplier_image_url && member.inventory_source === 'sanmar')) return null;
    const style = String(member.supplier_sku || member.sku || '').split('-')[0];
    if (!/^[a-z0-9]+$/i.test(style)) return null;
    if (!styles.has(style)) {
      const products = [...new Map(members.filter(m=>String(m.supplier_sku || m.sku || '').split('-')[0]===style)
        .map(m=>[m.product_id,{id:m.product_id,sku:m.supplier_sku || m.sku,color:m.color}])).values()];
      config ||= deps.coveoConfig();
      styles.set(style, config.then(c=>deps.scrapeStyle(c,style,products)));
    }
    const images = await styles.get(style);
    const url = images?.[member.product_id]?.front;
    if (!url || url === member.supplier_image_url) return null;
    return fetchImage(url); // existing host, redirect, type and placeholder checks
  };
}
module.exports = { createSanMarImageRecovery };
