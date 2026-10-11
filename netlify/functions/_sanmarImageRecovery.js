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
async function loadSupplierImages(members, fetchImage, recover) {
  const originals = new Map(), replacements = new Map(), fetched = new Map();
  const available = [], skipped = [];
  for (const member of members) {
    const url = member.supplier_image_url;
    let image, failure;
    if (!originals.has(url)) originals.set(url, (async () => {
      if (!url) throw new Error('No supplier photo added');
      return fetchImage(url);
    })());
    try { image = await originals.get(url); } catch (e) { failure = e; }
    if (!image) {
      // A shared placeholder URL is NOT a color identity. Deduplicate only
      // logo combinations of the same product, never different product colors.
      const key = JSON.stringify([member.product_id,member.color,url]);
      if (!replacements.has(key)) replacements.set(key, recover(member));
      try { image = await replacements.get(key); } catch (e) { failure = e; }
    }
    if (!image) {
      skipped.push({webstore_product_id:member.webstore_product_id,error:`Skipped ${member.color || 'image'}: supplier photo unavailable. Add or replace the supplier photo and retry. ${failure?.message || 'No matching supplier photo found'}`});
      continue;
    }
    const effectiveUrl = image.sourceUrl || url;
    fetched.set(effectiveUrl,image);
    available.push({...member,supplier_image_url:effectiveUrl});
  }
  return {members:available,fetched,skipped};
}
module.exports = { createSanMarImageRecovery, loadSupplierImages };
