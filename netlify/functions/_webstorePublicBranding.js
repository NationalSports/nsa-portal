// Current school/team branding for a public store row: the store's own logo and
// colors, falling back to the linked customer (then its parent school). Shared by
// webstore-checkout's `storefront` action and store-preview (link previews), so a
// texted store link shows the same logo/colors the storefront page does.
// Resolved on each read — never copied into store overrides, and no customer
// record is exposed: only the resulting logo URL and two hex colors.
const { effectiveWebstoreColors } = require('../../src/lib/webstoreBranding');

// `row` = the webstores base row (needs customer_id); `store` = the public copy
// to fill in. Mutates and returns `store`.
async function applyCustomerBranding(sb, row, store) {
  if (row.customer_id && (!store.logo_url || !store.primary_color || !store.accent_color)) {
    const customer = await sb.from('customers').select('logo_url,parent_id,school_colors').eq('id', row.customer_id).limit(1);
    if (customer.error) throw customer.error;
    const linked = (customer.data || [])[0];
    let parent = null;
    const needsParentLogo = !store.logo_url && !linked?.logo_url;
    const needsParentColors = (!store.primary_color || !store.accent_color)
      && (!Array.isArray(linked?.school_colors) || !linked.school_colors.length);
    if (linked?.parent_id && (needsParentLogo || needsParentColors)) {
      const parentResult = await sb.from('customers').select('logo_url,school_colors').eq('id', linked.parent_id).limit(1);
      if (parentResult.error) throw parentResult.error;
      parent = (parentResult.data || [])[0] || null;
    }
    if (!store.logo_url) store.logo_url = linked?.logo_url || parent?.logo_url || '';
    const colors = effectiveWebstoreColors(store, linked, parent);
    store.primary_color = colors.primary;
    store.accent_color = colors.accent;
  }
  return store;
}

module.exports = { applyCustomerBranding };
