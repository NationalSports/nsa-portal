// Shared configuration only; checkout supplies catalog-authoritative totals/counts.
const MODES = ['flat', 'free', 'order_total', 'item_count', 'ups_live'];
function shippingConfig(store) {
  return store?.shipping_settings ?? store?.all_school_settings?.shipping ?? {};
}
function shippingDefaults(store) {
  return { mode: 'flat', free_over_cents: null, tiers: [{ from: 0, amount_cents: Math.round((Number(store?.flat_shipping) || 0) * 100) }], package_weight_oz: 2, length_in: 12, width_in: 10, height_in: 3, origin_code: 'OR', service_code: 'ups_ground', ...shippingConfig(store) };
}
function validateShipping(config) {
  if (!config || !MODES.includes(config.mode)) return 'Choose a shipping price option.';
  if (config.free_over_cents != null && (!Number.isSafeInteger(config.free_over_cents) || config.free_over_cents <= 0)) return 'Enter a free-shipping threshold greater than zero.';
  if (['order_total', 'item_count'].includes(config.mode)) {
    const rows = config.tiers;
    if (!Array.isArray(rows) || !rows.length || rows.length > 50 || rows[0]?.from !== 0) return 'Shipping tiers must start at zero and contain 1–50 rows.';
    if (rows.some((r, i) => !r || !Number.isSafeInteger(r.from) || r.from < 0 || !Number.isSafeInteger(r.amount_cents) || r.amount_cents < 0 || (i > 0 && r.from <= rows[i - 1].from))) return 'Tier minimums must increase; shipping prices must be zero or greater.';
  }
  if (config.mode === 'ups_live' && (['package_weight_oz', 'length_in', 'width_in', 'height_in'].some(k => !Number.isFinite(Number(config[k])) || Number(config[k]) <= 0) || !['OR', 'warehouse'].includes(config.origin_code) || !/^ups_[a-z0-9_]+$/.test(config.service_code || ''))) return 'UPS shipping setup is incomplete. Enter package weight, dimensions, warehouse origin, and service.';
  return null;
}
function needsShippingQuote(store) {
  const c = shippingConfig(store);
  return store?.delivery_mode === 'ship_home' && ((c.mode && c.mode !== 'flat') || c.free_over_cents != null);
}
function ruleShipping(config, flat, subtotalCents, itemCount, waived) {
  let cents = Math.max(0, Math.round((Number(flat) || 0) * 100));
  if (config.mode === 'free') cents = 0;
  if (['order_total', 'item_count'].includes(config.mode)) {
    const basis = config.mode === 'order_total' ? subtotalCents : itemCount;
    cents = config.tiers.filter(t => t.from <= basis).slice(-1)[0].amount_cents;
  }
  return waived || (config.free_over_cents != null && subtotalCents >= config.free_over_cents) ? 0 : cents / 100;
}
module.exports = { shippingConfig, shippingDefaults, validateShipping, needsShippingQuote, ruleShipping };
